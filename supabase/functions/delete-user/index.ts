// Lumi · delete-user Edge Function
//
// Hard-deletes the authenticated user from `auth.users`. Every row in
// the data schema references `users(id) on delete cascade`, so wiping
// the auth row removes their quests, checkins, sos_events,
// achievements, brain_dumps, owned/equipped items, pet_state, and
// ai_usage in a single transaction — the privacy promise honored.
//
// Flow:
//   1. Validate the caller's Supabase JWT.
//   2. Look up the authenticated user.
//   3. Call admin.auth.deleteUser(uid).
//   4. Return ok.
//
// Deploy:  supabase functions deploy delete-user
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected
//          by the Supabase runtime — no manual config needed.
//
// Client contract (lib/auth.ts → deleteAccount):
//   POST → { ok: true } on success
//        → { error: "..." } on failure
//   HTTP 401 if JWT invalid, 500 on server error.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "Missing or malformed Authorization header" }, 401);
  }
  const jwt = auth.slice("Bearer ".length);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    console.error("Supabase env missing");
    return json({ error: "Server misconfigured" }, 500);
  }

  // Verify the JWT by calling getUser() with the anon client. This
  // confirms the caller IS who they say they are — service role would
  // happily accept any uid we passed.
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return json({ error: "Invalid session" }, 401);
  }
  const uid = userData.user.id;

  // Now use service role to actually delete. The cascade in the data
  // schema handles every user-owned row automatically.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
  if (deleteError) {
    console.error("admin.deleteUser failed", {
      uid,
      message: deleteError.message,
    });
    return json({ error: deleteError.message || "Delete failed" }, 500);
  }

  return json({ ok: true });
});
