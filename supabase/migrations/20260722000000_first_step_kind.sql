-- New AI kind: first_step — the hero card's "break off the first
-- step" helper (onboarding promise: "one small first step, never the
-- whole mountain"). Gets its OWN kind because the proxy pins system
-- prompts per kind server-side; borrowing clarify's bucket made the
-- pinned spelling-repair prompt fight the request.
--
-- Same two-file dance as clarify (20260705010000/010001): ALTER TYPE
-- ... ADD VALUE must commit before the new label is usable in
-- function bodies, so caps live in the next migration.

alter type public.ai_kind add value if not exists 'first_step';
