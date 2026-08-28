// Brand My Bottle — Stripe webhook Edge Function
//
// The ONLY writer of `public.bmb_bids`. Rules:
//   1. Verify Stripe's signature against the raw body BEFORE parsing.
//   2. Idempotency via `stripe_session_id` UNIQUE — Stripe redelivers.
//   3. Runs with the service_role key; anon can no longer insert.
//
// Runtime: Supabase Edge Functions (Deno). Same Stripe HTTP-client caveat as
// the create-checkout function.

// deno-lint-ignore-file no-explicit-any
import Stripe from "https://esm.sh/stripe@17.5.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const whSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const sbUrl = Deno.env.get("SUPABASE_URL");
  const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!signature || !whSecret || !stripeKey || !sbUrl || !sbKey) {
    return new Response("missing config", { status: 400 });
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2024-11-20.acacia",
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    timeout: 20_000,
  });

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    // Deno needs the async variant — the sync one uses Node crypto.
    event = await stripe.webhooks.constructEventAsync(raw, signature, whSecret);
  } catch (err) {
    console.error("signature verification failed:", err instanceof Error ? err.message : err);
    return new Response("invalid signature", { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    // Endpoint is registered for `checkout.session.completed` only, but a
    // dashboard change could add others — ack them and move on.
    return json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Paranoia: only act on paid sessions. Stripe fires this event only when
  // payment_status is "paid" or "no_payment_required" for payment mode, but
  // treat anything else as a no-op rather than dropping a row.
  if (session.payment_status !== "paid") {
    return json({ received: true, unpaid: session.payment_status });
  }

  const md = session.metadata ?? {};
  const spot_id = Number(md.spot_id);
  const amount_cents = Number(md.amount_cents);
  const brand = (md.brand ?? "").toString();
  const emailFromMd = (md.email ?? "").toString();
  const email = emailFromMd || session.customer_details?.email || "";
  const website = md.website ? md.website.toString() : null;
  const x_handle = md.x_handle ? md.x_handle.toString() : null;
  const logo_url = md.logo_url ? md.logo_url.toString() : null;

  if (!spot_id || !amount_cents || !brand || !email) {
    console.error(`session ${session.id} missing required metadata`, md);
    return new Response("missing metadata", { status: 400 });
  }

  const db = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

  const { data, error } = await db
    .from("bmb_bids")
    .insert({
      spot_id,
      amount_cents,
      brand,
      email,
      website: website || null,
      x_handle: x_handle || null,
      logo_url: logo_url || null,
      stripe_session_id: session.id,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation on stripe_session_id → we've seen this session
    // before. That's the whole point of the idempotency key — success, no-op.
    if ((error as any).code === "23505") {
      return json({ received: true, duplicate: true });
    }
    console.error("bid insert failed:", error.message);
    // Return 500 so Stripe retries — losing a captured deposit is worse than
    // a duplicate attempt (which the UNIQUE guard would swallow anyway).
    return new Response(`insert failed: ${error.message}`, { status: 500 });
  }

  console.log(`bmb_bids inserted id=${data?.id} spot=${spot_id} cents=${amount_cents} session=${session.id}`);
  return json({ received: true, bid_id: data?.id });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
