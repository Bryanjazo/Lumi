-- 'clarify' AI kind — the tiny "what did you mean" repair pass.
-- Pro-only by policy: free users get the deterministic tidy (still
-- good); the LLM-powered fix is an upgrade feature. Enforced
-- server-side via a 0 weekly cap for free (has_access short-circuits
-- for premium before caps are read).

alter type public.ai_kind add value if not exists 'clarify';
