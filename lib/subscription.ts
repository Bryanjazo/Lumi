/**
 * Subscription gate for Lumi.
 *
 * Access model:
 *   - Trial: 7 days from session.user.created_at (Supabase timestamps the
 *     account on sign-up). No subscription_status change required.
 *   - Active: subscription_status === 'active'.
 *   - Anything else (past_due / cancelled / expired) → no access.
 *
 * The hook derives access locally from the synced users row + session.
 * Server-side, the `has_access(uuid)` SQL function is the authoritative
 * check — wire it into RLS policies when we start paywalling actual data
 * reads (currently we only paywall the UI).
 */
import { useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useUserStore, SubscriptionStatus } from '../store/userStore';

const TRIAL_DAYS = 7;
const DAY_MS = 86_400_000;

export interface AccessStatus {
  hasAccess: boolean;
  inTrial: boolean;
  trialDaysLeft: number; // 0 once expired
  status: SubscriptionStatus;
  hasActiveSubscription: boolean;
}

export const useAccessStatus = (
  session: Session | null,
): AccessStatus => {
  const status = useUserStore((s) => s.subscriptionStatus);
  const createdAt = session?.user.created_at ?? null;

  return useMemo(() => {
    const hasActive = status === 'active';
    if (hasActive) {
      return {
        hasAccess: true,
        inTrial: false,
        trialDaysLeft: 0,
        status,
        hasActiveSubscription: true,
      };
    }
    if (status === 'past_due' || status === 'cancelled' || status === 'expired') {
      return {
        hasAccess: false,
        inTrial: false,
        trialDaysLeft: 0,
        status,
        hasActiveSubscription: false,
      };
    }
    // status === 'trial' — derive remaining days from created_at.
    if (!createdAt) {
      // No session yet → treat as trial day 7 (still inside) by default.
      return {
        hasAccess: true,
        inTrial: true,
        trialDaysLeft: TRIAL_DAYS,
        status,
        hasActiveSubscription: false,
      };
    }
    const start = new Date(createdAt).getTime();
    const elapsed = Date.now() - start;
    const remaining = TRIAL_DAYS - Math.floor(elapsed / DAY_MS);
    const daysLeft = Math.max(0, remaining);
    return {
      hasAccess: daysLeft > 0,
      inTrial: daysLeft > 0,
      trialDaysLeft: daysLeft,
      status,
      hasActiveSubscription: false,
    };
  }, [status, createdAt]);
};
