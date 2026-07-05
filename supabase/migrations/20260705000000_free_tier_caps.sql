-- Free-tier AI caps, round two (monetization pass).
--
-- The routing gate now keeps simple captures fully deterministic
-- (zero AI) for EVERYONE — so a free user's AI spend is only complex
-- brain-dumps + Untangle turns. With the old caps (title_clean 30/wk)
-- free AI was effectively unlimited in practice, undercutting Pro.
--
-- New free weekly caps (premium is unaffected — has_access short-
-- circuits before these numbers are read):
--   title_clean (AI capture sorting)  30 → 10   (~1-2 AI sorts/day)
--   brain_dump  (legacy bulk parse)    5 → 3
--   untangle    (conversation turns)   5 → 5    (unchanged — the taste)
--   followup    8 → 5
--   weekly_report 2 → 2               (unchanged — recap stays weekly)
--
-- The deterministic engine is DELIBERATELY not touched: it is the
-- outage fallback and the free floor's quality bar. Free stays good;
-- Pro is where the AI lives.

create or replace function public.ai_weekly_cap(k public.ai_kind)
returns int
language sql immutable
as $$
  select case k
    when 'brain_dump'    then 3
    when 'untangle'      then 5
    when 'followup'      then 5
    when 'title_clean'   then 10
    when 'weekly_report' then 2
  end
$$;
