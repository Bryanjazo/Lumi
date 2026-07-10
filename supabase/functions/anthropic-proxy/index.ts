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
import { SYSTEM_PROMPTS, KIND_MAX_TOKENS } from "./prompts.ts";

type AiKind =
  | "brain_dump"
  | "untangle"
  | "followup"
  | "title_clean"
  | "clarify"
  | "weekly_report";

// Only kinds with a LIVE client caller are accepted. Dead kinds
// (brain_dump / followup / weekly_report) were removed with their
// dead client functions — fewer doors, less to audit.
const ALLOWED_KINDS: AiKind[] = [
  "untangle",
  "title_clean",
  "clarify",
];

const DEFAULT_MODEL = "claude-sonnet-4-6";
// Per-kind model pick — server-side so a modified client can't
// route a heavy kind to itself. clarify is a ~40-token spelling
// repair: Haiku is ~4× cheaper and, more importantly, noticeably
// faster (the "did you mean" suggestion appears sooner).
const KIND_MODEL: Partial<Record<AiKind, string>> = {
  clarify: "claude-haiku-4-5-20251001",
};

// Per-kind temperature — extraction wants near-deterministic output
// (consistent JSON shape run to run); untangle is a conversation and
// keeps some warmth. Default was 1.0 (the API default) for BOTH,
// which is maximum randomness for a JSON extractor.
const KIND_TEMPERATURE: Record<string, number> = {
  title_clean: 0.2,
  clarify: 0.1,
  untangle: 0.7,
};
// Model allowlist (security audit §3) — the client may only pick from
// models we've priced for. Anything else silently falls back to the
// default instead of being passed through to Anthropic.
const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
]);
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Hard cap so a malicious client can't run up bills by asking for
// huge completions. Each call kind picks its own sensible default
// below this in lib/anthropic.ts.
//
// Raised 1500 → 3200: llmUnderstand legitimately needs ~3000 for a
// long brain-dump (12+ tasks × ~130 tokens of JSON each). At 1500
// the response truncated mid-object, the client's JSON parse failed
// silently, and every big dump fell back to the deterministic
// parser — the exact input the LLM exists for.
const MAX_TOKENS_HARD_LIMIT = 3200;

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
  // SECURITY (audit round 2): the system prompt is SERVER-pinned per
  // kind — client-supplied `system` is ignored, so our quota can't be
  // repurposed as a generic Claude API by a modified client. Old app
  // builds still send `system`; ignoring (not rejecting) keeps them
  // working.
  const kind = b.kind as AiKind;
  const kindCeiling = KIND_MAX_TOKENS[kind] ?? 600;
  const max =
    typeof b.max_tokens === "number" && b.max_tokens > 0
      ? Math.min(b.max_tokens, kindCeiling, MAX_TOKENS_HARD_LIMIT)
      : Math.min(600, kindCeiling);
  return {
    kind,
    system: SYSTEM_PROMPTS[kind] ?? "",
    messages: b.messages as CallBody["messages"],
    max_tokens: max,
    model:
      KIND_MODEL[kind] ??
      (typeof b.model === "string" && ALLOWED_MODELS.has(b.model)
        ? b.model
        : DEFAULT_MODEL),
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
  if (quota !== true) {
    // FAIL-CLOSED (audit): null/undefined from the RPC used to slip
    // through a `=== false` check — anything but an explicit true is
    // a denial now.
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
        temperature: KIND_TEMPERATURE[body.kind] ?? 0.5,
        // PROMPT CACHING: the system prompt is server-pinned and
        // byte-identical for every call of a kind, so it's a perfect
        // cache prefix — reads bill at 10% of input price (writes
        // +25%, 5-min TTL refreshed on every hit, shared across all
        // users since the prefix is org-scoped). understand's ~5.4k-
        // token prompt is the whole cost line; this halves it at any
        // real traffic. Prompts under the 1024-token cache minimum
        // (clarify) are silently not cached — no error, no downside.
        ...(body.system
          ? {
              system: [
                {
                  type: "text",
                  text: body.system,
                  cache_control: { type: "ephemeral" },
                },
              ],
            }
          : {}),
        // Untangle's first message is the stable pile+profile head —
        // byte-identical between turns (client keeps the volatile
        // clock line in a separate message). Caching it makes turns
        // 2+ read ~1.3k tokens at 10% price. Heads under the 1024-
        // token cache minimum are silently not cached — no downside.
        messages:
          body.kind === "untangle" && body.messages.length > 1
            ? [
                {
                  role: body.messages[0].role,
                  content: [
                    {
                      type: "text",
                      text: body.messages[0].content,
                      cache_control: { type: "ephemeral" },
                    },
                  ],
                },
                ...body.messages.slice(1),
              ]
            : body.messages,
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
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    error?: { type: string; message: string };
  };
  // Cost telemetry — cache_read > 0 means the prompt cache is doing
  // its job (visible via `supabase functions logs anthropic-proxy`).
  console.log(
    `[proxy] ${body.kind} in=${out.usage?.input_tokens ?? 0} out=${
      out.usage?.output_tokens ?? 0
    } cache_write=${out.usage?.cache_creation_input_tokens ?? 0} cache_read=${
      out.usage?.cache_read_input_tokens ?? 0
    }`,
  );
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

  // ── 4. Log usage. AWAITED on purpose: supabase-js builders are
  //      lazy — the old `void client.insert(...)` never executed, so
  //      ai_usage stayed empty and has_ai_quota counted 0 forever
  //      (free caps were silently unenforced). The insert costs a
  //      few ms; correctness of the quota system is worth it.
  const { error: logErr } = await adminClient.from("ai_usage").insert({
    user_id: userId,
    kind: body.kind,
    tokens_in: out.usage?.input_tokens ?? null,
    tokens_out: out.usage?.output_tokens ?? null,
  });
  if (logErr) console.error("[proxy] ai_usage insert failed:", logErr.message);

  return json({ text });
});
