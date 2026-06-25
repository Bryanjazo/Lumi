// Lumi · anthropic-proxy Edge Function
//
// Server-side proxy for Anthropic. The API key lives ONLY here as a
// Deno env secret (`ANTHROPIC_API_KEY`); the mobile client never sees
// it, so it can't be extracted from the bundle.
//
// Flow:
//   1. Validate the caller's Supabase JWT (Authorization: Bearer ...).
//   2. Look up has_ai_quota(user_id, kind) — premium users are
//      unlimited, free users get N per kind per 7-day rolling window.
//   3. Call Anthropic with the validated body.
//   4. Log a row to ai_usage so the quota check sees this call next
//      time.
//
// Deploy:  supabase functions deploy anthropic-proxy
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Client contract (lib/anthropic.ts):
//   POST { kind, system, messages, max_tokens, model? }
//   → { text: string }                  on success
//   → { error: { code, message } }      on failure
// HTTP 429 when quota is exhausted (client falls back to offline).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type AiKind =
  | "brain_dump"
  | "untangle"
  | "followup"
  | "title_clean"
  | "weekly_report";

const ALLOWED_KINDS: AiKind[] = [
  "brain_dump",
  "untangle",
  "followup",
  "title_clean",
  "weekly_report",
];

const DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Hard cap so a malicious client can't run up bills by asking for
// huge completions. Each call kind picks its own sensible default
// below this in lib/anthropic.ts.
const MAX_TOKENS_HARD_LIMIT = 1500;

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

interface CallBody {
  kind: AiKind;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  max_tokens?: number;
  model?: string;
}

const validateBody = (raw: unknown): CallBody | { error: string } => {
  if (!raw || typeof raw !== "object") return { error: "Body must be JSON" };
  const b = raw as Record<string, unknown>;
  if (!ALLOWED_KINDS.includes(b.kind as AiKind)) {
    return { error: "Invalid kind" };
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { error: "messages is required and must be a non-empty array" };
  }
  for (const m of b.messages) {
    if (
      !m ||
      typeof m !== "object" ||
      ((m as any).role !== "user" && (m as any).role !== "assistant") ||
      typeof (m as any).content !== "string"
    ) {
      return { error: "Each message needs {role, content}" };
    }
  }
  if (b.system != null && typeof b.system !== "string") {
    return { error: "system must be a string" };
  }
  const max =
    typeof b.max_tokens === "number" && b.max_tokens > 0
      ? Math.min(b.max_tokens, MAX_TOKENS_HARD_LIMIT)
      : 600;
  return {
    kind: b.kind as AiKind,
    system: (b.system as string | undefined) ?? "",
    messages: b.messages as CallBody["messages"],
    max_tokens: max,
    model: typeof b.model === "string" ? b.model : DEFAULT_MODEL,
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ error: { code: "method", message: "POST only" } }, 405);
  }

  // ── 1. Auth ─────────────────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) {
    return json(
      { error: { code: "auth", message: "Missing bearer token" } },
      401,
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_KEY) {
    return json(
      {
        error: {
          code: "config",
          message: "Server is missing ANTHROPIC_API_KEY",
        },
      },
      500,
    );
  }

  // Validate JWT by asking Supabase who owns it (cheaper than
  // verifying the signature locally and rotation-safe).
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: u, error: uErr } = await userClient.auth.getUser(jwt);
  if (uErr || !u?.user) {
    return json(
      { error: { code: "auth", message: "Invalid token" } },
      401,
    );
  }
  const userId = u.user.id;

  // ── 2. Body + quota ────────────────────────────────────────────
  let parsed: CallBody | { error: string };
  try {
    parsed = validateBody(await req.json());
  } catch (_e) {
    return json(
      { error: { code: "body", message: "Body must be valid JSON" } },
      400,
    );
  }
  if ("error" in parsed) {
    return json({ error: { code: "body", message: parsed.error } }, 400);
  }
  const body = parsed;

  // Service-role client for the quota check + usage insert. We can't
  // use the user-scoped client because RLS hides other users' rows
  // from has_ai_quota's count() — but the SQL function is SECURITY
  // DEFINER (it reads ai_usage directly), so service role is fine.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { data: quota, error: qErr } = await adminClient.rpc("has_ai_quota", {
    u: userId,
    k: body.kind,
  });
  if (qErr) {
    return json(
      {
        error: {
          code: "quota_check",
          message: qErr.message,
        },
      },
      500,
    );
  }
  if (quota === false) {
    // Distinguish premium ceiling vs free cap so the client can
    // choose calmer wording for premium hits ("let's keep it quick
    // for now") vs the free-tier conversion prompt. Both still
    // return 429 → the client falls back to deterministic silently.
    const { data: access } = await adminClient.rpc("has_access", {
      u: userId,
    });
    const isPremium = access === true;
    return json(
      {
        error: {
          code: isPremium ? "premium_daily" : "quota",
          message: isPremium
            ? "Let's keep it quick for now — try again in a bit."
            : "Free tier weekly cap reached for this AI feature. Upgrade for unlimited.",
        },
      },
      429,
    );
  }

  // ── 3. Anthropic call ──────────────────────────────────────────
  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: body.model,
        max_tokens: body.max_tokens,
        ...(body.system ? { system: body.system } : {}),
        messages: body.messages,
      }),
    });
  } catch (e) {
    return json(
      {
        error: {
          code: "upstream",
          message: e instanceof Error ? e.message : "Anthropic fetch failed",
        },
      },
      502,
    );
  }

  if (!upstream.ok) {
    const txt = await upstream.text();
    return json(
      {
        error: {
          code: "upstream",
          message: `Anthropic ${upstream.status}: ${txt.slice(0, 400)}`,
        },
      },
      502,
    );
  }

  const out = (await upstream.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { type: string; message: string };
  };
  if (out.error) {
    return json(
      { error: { code: "upstream", message: out.error.message } },
      502,
    );
  }
  const text = (out.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");

  // ── 4. Log usage (best-effort — don't block the response if it
  //      fails; the user still gets their answer). ───────────────
  void adminClient.from("ai_usage").insert({
    user_id: userId,
    kind: body.kind,
    tokens_in: out.usage?.input_tokens ?? null,
    tokens_out: out.usage?.output_tokens ?? null,
  });

  return json({ text });
});
