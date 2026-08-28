// Brand My Bottle — bmb-beat Edge Function
//
// Heartbeat endpoint for the "X visiting now / Y visitors so far" badges. The
// browser POSTs { token: "<uuid v4>" } every ~30s from every open tab. We
// UPSERT `bmb_visitors` keyed on that token (setting last_seen = now()), then
// re-read the aggregate view `bmb_stats` and return both numbers so the client
// updates in a single round trip.
//
// No PII: the token is generated in the browser (crypto.randomUUID()) and
// persisted in localStorage. We never see IPs, user agents, or any identity.
// Raw `bmb_visitors` is service_role-only; anon only sees the aggregate view.
//
// Runtime: Supabase Edge Functions (Deno). verify_jwt = false — the browser
// still passes the anon key as Bearer for CORS, but the function does its own
// body validation (v4 UUID). Same pattern as bmb-create-checkout.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4?target=denonext";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// RFC 4122 v4 UUID: 8-4-4-4-12 hex, version nibble = 4, variant nibble ∈ [8,9,a,b].
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface BeatBody {
  token?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  let body: BeatBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "malformed json" }, 400);
  }

  const token = (body.token ?? "").toString().trim().toLowerCase();
  if (!UUID_V4_RE.test(token)) {
    return json({ error: "token must be a v4 uuid" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "server not configured" }, 500);

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // UPSERT: new tokens get first_seen = last_seen = now() (defaults). Existing
  // tokens have last_seen bumped. We set last_seen explicitly on the client
  // side of the upsert so the ON CONFLICT path updates it.
  const nowIso = new Date().toISOString();
  const { error: upsertErr } = await sb
    .from("bmb_visitors")
    .upsert({ token, last_seen: nowIso }, { onConflict: "token" });

  if (upsertErr) {
    console.error("bmb-beat upsert failed:", upsertErr.message);
    return json({ error: "could not record heartbeat", detail: upsertErr.message }, 502);
  }

  const { data: stats, error: statsErr } = await sb
    .from("bmb_stats")
    .select("visiting_now, total_visitors")
    .single();

  if (statsErr || !stats) {
    console.error("bmb-beat stats read failed:", statsErr?.message);
    return json({ error: "could not read stats", detail: statsErr?.message }, 502);
  }

  return json({
    ok: true,
    visiting_now: stats.visiting_now,
    total_visitors: stats.total_visitors,
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
