/**
 * Subscription gate for Lumi (free-first model — per
 * lumi-monetization-model-spec-2.md).
 *
 * Access model:
 *   - Free: the baseline for every signed-in account. Full daily
 *     loop + the deterministic features + AI capped by the proxy.
 *     The app never locks — this is the floor forever.
 *   - Trial: 7 days from the moment the user OPTS IN
 *     (trialStartedAt is set). One taste per account. Trial lapses
 *     back to free, never to a locked state.
 *   - Active: subscription_status === 'active' (RevenueCat
 *     webhook flips it).
 *
 * The hook derives access locally from the userStore. Server-side
 * AI usage is still gated by has_access / has_ai_quota — keep those
 * authoritative for the actual cost ceiling.
 */
import { useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useUserStore, SubscriptionStatus } from '../store/userStore';

const TRIAL_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * Pricing — exported so paywall + onboarding + any future surface
 * read from one source. Update here, all surfaces follow.
 *
 * Positioning: Lumi sits in the AI-productivity tier alongside Motion,
 * Sunsama, and Reclaim. Monthly $14.99 undercuts Tiimo ($16.99,
 * non-AI) and clears AI cost + Apple's 15% SBP cut. Annual matches
 * Tiimo's $59.99 promo on first sign-up (head-to-head comparability)
 * and recovers margin at renewal ($89.99 ≈ $7.50/mo equivalent).
 *
 * ASC mirror: base annual price = $89.99 with an Introductory Offer
 * of "1 year at $59.99 — first-time subscribers only".
 */
export const PRICING = {
  trialDays: TRIAL_DAYS,
  annual: {
    firstYearLabel: '$59.99',
    firstYearAmountUSD: 59.99,
    renewalLabel: '$89.99',
    renewalAmountUSD: 89.99,
  },
  monthly: {
    label: '$14.99',
    amountUSD: 14.99,
  },
} as const;

/** One source for every outward URL — the manage-subscription screen
 *  shipped pointing terms/privacy at lumi.app (a domain we don't
 *  own) while the paywall used lumitasks.app. Never again. */
export const LEGAL_URLS = {
  terms: 'https://lumitasks.app/terms',
  privacy: 'https://lumitasks.app/privacy',
} as const;

export const STORE_URLS = {
  appleSubscriptions: 'https://apps.apple.com/account/subscriptions',
  googleSubscriptions: 'https://play.google.com/store/account/subscriptions',
} as const;

/** The free-vs-pro comparison table — ONE copy. It had already
 *  drifted: paywall gained the Hey Lumi row, manage-subscription
 *  didn't. Free values must describe what the server actually
 *  enforces (weekly AI caps), not aspirational limits. */
export const COMPARE_ROWS = [
  { label: 'AI-sorted captures', free: '10 / week', pro: 'Unlimited' },
  { label: 'AI sorting & re-plan', free: 'Basic', pro: 'Smart' },
  { label: '“Did you mean?” fixes', free: 'Rules', pro: 'AI-powered' },
  { label: '“Hey Lumi” hands-free', free: '—', pro: 'Wake word' },
  { label: 'Weekly reflection', free: 'Snippet', pro: 'Full story' },
  { label: 'Calendar sync', free: '1 calendar', pro: 'Multi-cal' },
  { label: "Luna's worlds & skins", free: 'Starter', pro: 'All' },
] as const;

export interface AccessStatus {
  /**
   * True when the user has unlocked premium *extras* (active
   * subscription OR inside an opt-in 7-day trial). Gate ONLY
   * premium extras on this — never gate the core loop. Free
   * users have full app access.
   */
  hasPremium: boolean;
  /** True when the user is currently inside an active opt-in trial. */
  inTrial: boolean;
  /** Days remaining in the opt-in trial (0 when not in trial). */
  trialDaysLeft: number;
  status: SubscriptionStatus;
  /** True only when status === 'active' (paid). */
  hasActiveSubscription: boolean;
  /**
   * True for a user who is currently on the free tier (i.e. not
   * on an active sub and not inside an active trial). The post-
   * onboarding trial-choice screen and cap-hit prompts use this
   * to decide whether to offer the 7-day taste.
   */
  isFree: boolean;
  /**
   * True if this account has already consumed its one-shot 7-day
   * trial (regardless of whether it's currently active or lapsed).
   * Once true, "Try free for 7 days" prompts should switch to a
   * direct "Subscribe" CTA.
   */
  trialAlreadyUsed: boolean;

  /**
   * @deprecated Legacy alias for `hasPremium` — kept so older
   *   call sites that haven't been renamed yet don't crash. New
   *   code should use `hasPremium`.
   */
  hasAccess: boolean;
}

/**
 * True while the subscription is PAID — 'active', or 'cancelled' /
 * 'past_due' with time left on the period the user already paid for.
 * RC's CANCELLATION event only means auto-renew is off; access runs
 * until EXPIRATION. Mirrors the server's has_access() exactly —
 * keep the two in sync.
 */
export const isPaidThrough = (
  status: SubscriptionStatus,
  currentPeriodEnd: string | null,
): boolean =>
  status === 'active' ||
  ((status === 'cancelled' || status === 'past_due') &&
    currentPeriodEnd != null &&
    new Date(currentPeriodEnd).getTime() > Date.now());

export const useAccessStatus = (
  // `session` kept in the signature so callers don't have to change
  // their call shape during the migration. It's no longer used to
  // derive a trial (trialStartedAt does that now).
  _session: Session | null,
): AccessStatus => {
  const status = useUserStore((s) => s.subscriptionStatus);
  const trialStartedAt = useUserStore((s) => s.trialStartedAt);
  const periodEnd = useUserStore((s) => s.subscriptionCurrentPeriodEnd);

  return useMemo(() => {
    const hasActive = isPaidThrough(status, periodEnd);
    const trialAlreadyUsed = trialStartedAt != null;

    // Trial math — derived from trialStartedAt, NOT created_at.
    let inTrial = false;
    let trialDaysLeft = 0;
    if (status === 'trial' && trialStartedAt) {
      const start = new Date(trialStartedAt).getTime();
      const elapsed = Date.now() - start;
      const remaining = TRIAL_DAYS - Math.floor(elapsed / DAY_MS);
      trialDaysLeft = Math.max(0, remaining);
      inTrial = trialDaysLeft > 0;
    }

    const hasPremium = hasActive || inTrial;
    const isFree = !hasPremium;

    return {
      hasPremium,
      inTrial,
      trialDaysLeft,
      status,
      hasActiveSubscription: status === 'active',
      isFree,
      trialAlreadyUsed,
      // Legacy alias — keep until every caller is renamed.
      hasAccess: hasPremium,
    };
  }, [status, trialStartedAt, periodEnd]);
};
