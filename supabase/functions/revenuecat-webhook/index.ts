// Lumi · revenuecat-webhook Edge Function
//
// Receives subscription lifecycle events from RevenueCat and flips
// `users.subscription_status`, `subscription_tier`, and
// `subscription_current_period_end` accordingly. The mobile client's
// `lib/revenuecat.ts` does an optimistic local mirror the moment a
// purchase completes, but THIS function is the server-side source
// of truth — it's what `has_access()` and the AI quota check read.
//
// Flow:
//   1. Validate the Authorization header against RC_WEBHOOK_AUTH
//      (a shared secret we configure in the RC dashboard).
//   2. Parse the event payload.
//   3. Look up the user by app_user_id (== Supabase user.id).
//   4. Translate the RC event type into a {status, tier, periodEnd}
//      patch.
//   5. UPDATE the users row.
//
// Deploy:  supabase functions deploy revenuecat-webhook
// Secrets:
//   supabase secrets set RC_WEBHOOK_AUTH=<long random token>
// Then in the RevenueCat dashboard set the webhook Authorization
// header to "Bearer <same token>".
//
// RC event reference:
//   https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

type Status = "trial" | "active" | "past_due" | "cancelled" | "expired";
type Tier = "monthly" | "annual" | null;

interface RCEvent {
  type: string;
  app_user_id: string;
  product_id?: string;
  expiration_at_ms?: number | null;
  // Many other fields exist (period_type, store, currency, etc.) —
  // we only read what we need.
}

interface RCPayload {
  event: RCEvent;
}

const inferTier = (productId: string | undefined): Tier => {
  if (!productId) return null;
  const lower = productId.toLowerCase();
  if (lower.includes("annual") || lower.includes("yearly")) return "annual";
  if (lower.includes("monthly")) return "monthly";
  return null;
};

const inferPeriodEnd = (ms: number | null | undefined): string | null => {
  if (!ms || ms <= 0) return null;
  return new Date(ms).toISOString();
};

interface Patch {
  subscription_status: Status;
  subscription_tier: Tier;
  subscription_current_period_end: string | null;
}

// Translate the RC event type into the state we want to land on.
// `null` means "ignore this event, no state change."
const patchForEvent = (event: RCEvent): Patch | null => {
  const tier = inferTier(event.product_id);
  const periodEnd = inferPeriodEnd(event.expiration_at_ms);

  switch (event.type) {
    // Active states — the entitlement is live.
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "PRODUCT_CHANGE":
    case "UNCANCELLATION":
      return {
        subscription_status: "active",
        subscription_tier: tier,
        subscription_current_period_end: periodEnd,
      };

    // Billing hiccup — keep entitlement live in the grace period
    // (RC will fire EXPIRATION if billing isn't recovered).
    case "BILLING_ISSUE":
      return {
        subscription_status: "past_due",
        subscription_tier: tier,
        subscription_current_period_end: periodEnd,
      };

    // User tapped cancel in the App Store. They KEEP entitlement
    // until period end — RC fires EXPIRATION then.
    case "CANCELLATION":
      return {
        subscription_status: "cancelled",
        subscription_tier: tier,
        subscription_current_period_end: periodEnd,
      };

    // Period ended without renewal. Drop to free.
    case "EXPIRATION":
      return {
        subscription_status: "expired",
        subscription_tier: null,
        subscription_current_period_end: null,
      };

    // Events we intentionally ignore (transfer, subscriber_alias,
    // non_renewing_purchase, test, etc.). Returning null prevents
    // accidentally clobbering a paid user with a no-op event.
    default:
      return null;
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  // ── Auth ──
  const expected = Deno.env.get("RC_WEBHOOK_AUTH");
  if (!expected) {
    console.error("RC_WEBHOOK_AUTH not configured");
    return json({ error: "Server misconfigured" }, 500);
  }
  const got = req.headers.get("authorization") ?? "";
  // RC sends "Authorization: Bearer <token>" if you configure it
  // that way in the dashboard. Match the whole header literally.
  const expectedHeader = expected.startsWith("Bearer ")
    ? expected
    : `Bearer ${expected}`;
  if (got !== expectedHeader) {
    return json({ error: "Unauthorized" }, 401);
  }

  // ── Parse ──
  let payload: RCPayload;
  try {
    payload = (await req.json()) as RCPayload;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const event = payload?.event;
  if (!event || typeof event.type !== "string" || !event.app_user_id) {
    return json({ error: "Malformed event" }, 400);
  }

  const patch = patchForEvent(event);
  if (!patch) {
    // Ignored event — ACK so RC doesn't retry.
    return json({ ok: true, ignored: event.type });
  }

  // ── Apply ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("Supabase env missing");
    return json({ error: "Server misconfigured" }, 500);
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { error } = await admin
    .from("users")
    .update(patch)
    .eq("id", event.app_user_id);

  if (error) {
    console.error("users update failed", {
      app_user_id: event.app_user_id,
      type: event.type,
      error: error.message,
    });
    return json({ error: "DB update failed" }, 500);
  }

  return json({ ok: true, type: event.type });
});
