// Brand My Bottle — create-checkout Edge Function
//
// Called by the browser when a bidder submits the bid form. Takes the full
// bid payload, creates a Stripe Checkout Session for the 20% deposit, and
// returns { url } for the client to redirect to. The bid row is NOT written
// here — it lands via the webhook AFTER the deposit is captured.
//
// Runtime: Supabase Edge Functions (Deno). Stripe SDK REQUIRES
// `httpClient: Stripe.createFetchHttpClient()` on this runtime, otherwise the
// SDK falls back to Node's http module and HANGS. Learned the expensive way
// in commit.cash — see src/lib/stripe.ts there.

// deno-lint-ignore-file no-explicit-any
import Stripe from "https://esm.sh/stripe@17.5.0?target=denonext";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface BidBody {
  spot_id?: number;
  amount_cents?: number;
  brand?: string;
  email?: string;
  website?: string | null;
  x_handle?: string | null;
  logo_url?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  let body: BidBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "malformed json" }, 400);
  }

  const spot_id = Number(body.spot_id);
  const amount_cents = Number(body.amount_cents);
  const brand = (body.brand ?? "").trim();
  const email = (body.email ?? "").trim();
  const website = body.website?.toString().trim() || null;
  const x_handle = body.x_handle?.toString().trim() || null;
  const logo_url = body.logo_url?.toString().trim() || null;

  if (!Number.isInteger(spot_id) || spot_id < 1 || spot_id > 11) {
    return json({ error: "spot_id must be 1..11" }, 400);
  }
  if (!Number.isInteger(amount_cents) || amount_cents < 100) {
    return json({ error: "amount_cents must be an integer >= 100" }, 400);
  }
  if (!brand || brand.length > 80) {
    return json({ error: "brand is required (max 80 chars)" }, 400);
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: "a valid email is required" }, 400);
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const site = Deno.env.get("SITE_URL") ?? "https://brand-my-bottle.pages.dev";
  if (!stripeKey) return json({ error: "server not configured" }, 500);

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2024-11-20.acacia",
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    timeout: 20_000,
  });

  // 20% deposit, rounded UP to whole cents, floor $1.
  const deposit_cents = Math.max(100, Math.ceil(amount_cents * 0.2));
  const bid_dollars = (amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  // Stripe metadata values are strings, capped at 500 chars each. Keep the
  // logo_url out of metadata if it's too long — but a Supabase storage public
  // URL for this project is ~120 chars, so it fits comfortably.
  const metadata: Record<string, string> = {
    spot_id: String(spot_id),
    amount_cents: String(amount_cents),
    brand,
    email,
    website: website ?? "",
    x_handle: x_handle ?? "",
    logo_url: logo_url ?? "",
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: deposit_cents,
            product_data: {
              name: `Brand My Bottle — Spot ${spot_id}`,
              description:
                `Holds your $${bid_dollars} bid on Spot ${spot_id}. ` +
                `If you're outbid, this deposit is refunded to your card automatically. ` +
                `If you win, the remaining balance is charged when the auction closes.`,
            },
          },
        },
      ],
      payment_intent_data: {
        capture_method: "automatic",
        statement_descriptor_suffix: "BRAND MY BOTTLE",
        metadata,
      },
      metadata,
      success_url: `${site}/?bid=success`,
      cancel_url: `${site}/?bid=cancel`,
    });

    return json({ url: session.url, id: session.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("create-checkout failed:", message);
    return json({ error: "could not start checkout", detail: message }, 502);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
