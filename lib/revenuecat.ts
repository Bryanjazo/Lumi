/**
 * RevenueCat integration for Lumi.
 *
 * The native SDK (`react-native-purchases`) is loaded lazily so the
 * app still runs in Expo Go (which lacks native modules). Every method
 * is a no-op when the SDK isn't available — call sites stay clean and
 * don't need to branch on environment.
 *
 * Server-side truth lives in `users.subscription_status` (flipped by
 * the RC webhook in `supabase/functions/revenuecat-webhook`). The
 * client wrapper here is an OPTIMISTIC mirror — we sync the store the
 * moment a purchase or restore completes so the UI flips instantly,
 * then the webhook + sync layer reconcile within seconds.
 *
 * REQUIRES (production):
 *   - EAS dev client or standalone build (not Expo Go)
 *   - EXPO_PUBLIC_REVENUECAT_IOS_KEY   — RC iOS PUBLIC key (sk_ NOT here)
 *   - EXPO_PUBLIC_REVENUECAT_ANDROID_KEY — RC Android PUBLIC key
 *   - Entitlement called "premium" configured in the RC dashboard
 *   - Two packages on the default offering: $rc_annual and $rc_monthly
 */
import { Platform, Linking } from 'react-native';
import { useUserStore, type SubscriptionTier } from '../store/userStore';
import { supabase } from './supabase';
import { STORE_URLS } from './subscription';

// ─────────────────────────────────────────────────────────────────────
// Minimal local types for the SDK surface we use.
//
// We deliberately don't import from `react-native-purchases` here —
// that lets this file type-check before the package is `npm install`-ed
// AND after. The real SDK shape is wider; we only declare what we
// actually call. When the package is installed the require() at
// runtime resolves to the real implementation.
// ─────────────────────────────────────────────────────────────────────

interface PurchasesEntitlementInfo {
  identifier: string;
  productIdentifier: string;
  expirationDate: string | null;
  /**
   * RC period type of the CURRENTLY active period:
   *   'NORMAL' — a genuinely PAID period (money changed hands).
   *   'TRIAL' / 'INTRO' — a StoreKit intro offer that hasn't been paid
   *      for yet. An intro free-trial reports the entitlement as active
   *      too, so `status === 'active'` alone can't tell "paying" from
   *      "still tasting". We read this so a card-attached StoreKit trial
   *      isn't mistaken for a real payment (drives wasEverPaid truth).
   * Optional: older SDKs / partial payloads may omit it — treated as
   * "unknown" (see `_activePeriodIsPaid`).
   */
  periodType?: 'NORMAL' | 'INTRO' | 'TRIAL';
}

interface CustomerInfo {
  entitlements: {
    active: Record<string, PurchasesEntitlementInfo | undefined>;
  };
}

interface PurchasesStoreProduct {
  /** Localized, currency-formatted price ("$14.99", "\u00a52,200"). */
  priceString?: string;
  /** Localized intro offer (the $59.99-first-year deal), when set. */
  introPrice?: { priceString?: string } | null;
}

interface PurchasesPackage {
  identifier: string;
  product?: PurchasesStoreProduct;
}

interface PurchasesOffering {
  availablePackages: PurchasesPackage[];
}

interface Offerings {
  current: PurchasesOffering | null;
}

interface PurchasesSDK {
  configure(opts: { apiKey: string }): void;
  logIn(userId: string): Promise<{ customerInfo: CustomerInfo }>;
  logOut(): Promise<CustomerInfo>;
  getOfferings(): Promise<Offerings>;
  purchasePackage(
    pkg: PurchasesPackage,
  ): Promise<{ customerInfo: CustomerInfo }>;
  restorePurchases(): Promise<CustomerInfo>;
  addCustomerInfoUpdateListener(fn: (ci: CustomerInfo) => void): void;
  removeCustomerInfoUpdateListener(fn: (ci: CustomerInfo) => void): void;
}

// ─────────────────────────────────────────────────────────────────────
// Lazy SDK load
//
// We require() inside a try/catch so Expo Go doesn't crash on boot
// when the native module isn't bundled. Every method below
// short-circuits when the SDK isn't available.
// ─────────────────────────────────────────────────────────────────────

let _Purchases: PurchasesSDK | null = null;
let _loaded = false;

const loadSDK = (): PurchasesSDK | null => {
  if (_loaded) return _Purchases;
  _loaded = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    _Purchases = (mod.default ?? mod) as PurchasesSDK;
  } catch {
    // Native module not bundled (Expo Go) or package not installed.
  }
  return _Purchases;
};

// ─────────────────────────────────────────────────────────────────────
// Identifiers — tweak here if the RC dashboard uses different names.
// ─────────────────────────────────────────────────────────────────────

/** Entitlement ID configured in RevenueCat. */
const ENTITLEMENT_ID = 'premium';

/** Package identifiers within the default offering. */
const PKG_ANNUAL = '$rc_annual';
const PKG_MONTHLY = '$rc_monthly';

// ─────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────

let _configured = false;

/**
 * Initialize the RC SDK with the platform's public API key. Idempotent —
 * safe to call multiple times.
 */
export const configureRevenueCat = (): boolean => {
  if (_configured) return true;
  const P = loadSDK();
  if (!P) return false;

  const key =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
      : Platform.OS === 'android'
        ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
        : null;

  if (!key) {
    // Missing key in env — log loudly but don't crash. The app still
    // works; purchases simply won't.
    if (__DEV__) {
      console.warn(
        '[revenuecat] No API key in env. Set ' +
          (Platform.OS === 'ios'
            ? 'EXPO_PUBLIC_REVENUECAT_IOS_KEY'
            : 'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY') +
          ' to enable purchases.',
      );
    }
    return false;
  }

  P.configure({ apiKey: key });
  _configured = true;
  return true;
};

/**
 * Tie the device's purchase history to a Supabase user.id. Call this
 * every time the session changes (sign-in OR sign-out → use logOut).
 * Idempotent.
 */
export const identifyUser = async (userId: string): Promise<void> => {
  const P = loadSDK();
  if (!P) return;
  // Defensive: if the effect order in _layout.tsx hasn't run
  // configureRevenueCat() yet (or it failed silently), retry now so
  // identify doesn't no-op for a real user.
  if (!_configured) configureRevenueCat();
  if (!_configured) return;
  try {
    const { customerInfo } = await P.logIn(userId);
    syncFromCustomerInfo(customerInfo);
  } catch (e) {
    console.warn('[revenuecat] logIn failed', e);
  }
};

export const logOutUser = async (): Promise<void> => {
  const P = loadSDK();
  if (!P || !_configured) return;
  try {
    await P.logOut();
  } catch {
    // logOut throws if already anonymous — that's fine.
  }
};

// ─────────────────────────────────────────────────────────────────────
// Offerings + purchase
// ─────────────────────────────────────────────────────────────────────

export const getCurrentOffering = async (): Promise<
  PurchasesOffering | null
> => {
  const P = loadSDK();
  if (!P || !_configured) return null;
  try {
    const offerings = await P.getOfferings();
    return offerings.current ?? null;
  } catch (e) {
    if (__DEV__) console.warn('[revenuecat] getOfferings failed', e);
    return null;
  }
};

export const getPackageForTier = async (
  tier: 'annual' | 'monthly',
): Promise<PurchasesPackage | null> => {
  const offering = await getCurrentOffering();
  if (!offering) return null;
  const wantId = tier === 'annual' ? PKG_ANNUAL : PKG_MONTHLY;
  return offering.availablePackages.find((p) => p.identifier === wantId) ?? null;
};

// Why a purchase couldn't be attempted. The paywall maps each reason
// to user-facing copy so the alert tells the user what's actually
// wrong instead of a generic "couldn't reach the store."
export type PurchaseUnavailableReason =
  | 'no-sdk'        // Expo Go or react-native-purchases not bundled.
  | 'no-config'     // SDK loaded but configureRevenueCat() failed
                    //   (almost always: missing EXPO_PUBLIC_REVENUECAT_IOS_KEY)
  | 'no-offering'   // RC dashboard has no current offering — products
                    //   not yet wired in RC or App Store
  | 'no-package';   // Offering exists but doesn't contain the requested
                    //   tier package ($rc_annual or $rc_monthly)

export type PurchaseOutcome =
  | { kind: 'success'; tier: SubscriptionTier }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; reason: PurchaseUnavailableReason }
  | { kind: 'error'; message: string };

/**
 * Trigger a real IAP purchase for the chosen tier. On success the
 * store is updated optimistically and the RC webhook will reconcile
 * the server side within seconds.
 *
 * The unavailable outcomes carry a `reason` so the caller can show
 * a useful diagnostic instead of a generic "couldn't reach store."
 */
export const purchaseTier = async (
  tier: 'annual' | 'monthly',
): Promise<PurchaseOutcome> => {
  const P = loadSDK();
  if (!P) {
    console.warn('[revenuecat] purchaseTier: SDK not loaded (Expo Go?)');
    return { kind: 'unavailable', reason: 'no-sdk' };
  }
  // Auto-retry configure if a previous boot call didn't have the
  // key yet — covers the case where env vars are present but
  // configure() somehow lost its flag.
  if (!_configured) configureRevenueCat();
  if (!_configured) {
    console.warn(
      '[revenuecat] purchaseTier: SDK not configured. Check ' +
        (Platform.OS === 'ios'
          ? 'EXPO_PUBLIC_REVENUECAT_IOS_KEY'
          : 'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY') +
        ' is set in eas.json.',
    );
    return { kind: 'unavailable', reason: 'no-config' };
  }
  const offering = await getCurrentOffering();
  if (!offering) {
    console.warn(
      '[revenuecat] purchaseTier: no current offering. Verify the RC ' +
        'dashboard has a "current" offering with the App Store products ' +
        'wired up. (Products take ~10 min to propagate after creation.)',
    );
    return { kind: 'unavailable', reason: 'no-offering' };
  }
  const wantId = tier === 'annual' ? PKG_ANNUAL : PKG_MONTHLY;
  const pkg = offering.availablePackages.find((p) => p.identifier === wantId);
  if (!pkg) {
    console.warn(
      `[revenuecat] purchaseTier: package ${wantId} not in offering ` +
        `${offering.availablePackages.map((p) => p.identifier).join(', ') || '(empty)'}.`,
    );
    return { kind: 'unavailable', reason: 'no-package' };
  }
  try {
    const { customerInfo } = await P.purchasePackage(pkg);
    const inferredTier = syncFromCustomerInfo(customerInfo);
    return { kind: 'success', tier: inferredTier ?? tier };
  } catch (raw) {
    const e = raw as { userCancelled?: boolean; message?: string };
    if (e.userCancelled) return { kind: 'cancelled' };
    const message = e.message ?? 'Purchase failed';
    console.warn('[revenuecat] purchasePackage threw:', message);
    return { kind: 'error', message };
  }
};

export type RestoreOutcome =
  | { kind: 'restored'; tier: SubscriptionTier }
  | { kind: 'nothing' }
  | { kind: 'unavailable'; reason: 'no-sdk' | 'no-config' }
  | { kind: 'error'; message: string };

export const restorePurchases = async (): Promise<RestoreOutcome> => {
  const P = loadSDK();
  if (!P) return { kind: 'unavailable', reason: 'no-sdk' };
  if (!_configured) configureRevenueCat();
  if (!_configured) return { kind: 'unavailable', reason: 'no-config' };
  try {
    const customerInfo = await P.restorePurchases();
    const tier = syncFromCustomerInfo(customerInfo);
    return tier ? { kind: 'restored', tier } : { kind: 'nothing' };
  } catch (raw) {
    const e = raw as { message?: string };
    const message = e.message ?? 'Restore failed';
    console.warn('[revenuecat] restorePurchases threw:', message);
    return { kind: 'error', message };
  }
};

// ─────────────────────────────────────────────────────────────────────
// Customer info → store mapping
// ─────────────────────────────────────────────────────────────────────

/**
 * Whether the RC entitlement that's CURRENTLY active is a genuinely
 * PAID period.
 *   true  — active + periodType 'NORMAL' (real payment).
 *   false — active but periodType 'TRIAL'/'INTRO' (StoreKit intro
 *           offer, not yet paid).
 *   null  — RC has no active entitlement, or didn't report a
 *           periodType (unknown). Callers treat null as "don't know" —
 *           the subscription hook then trusts the SERVER's 'active'
 *           (webhook-authoritative) rather than denying paid history.
 *
 * The subscription hook reads this via `activeEntitlementIsPaid()` to
 * keep wasEverPaid honest: a StoreKit intro trial makes the entitlement
 * active, but the user hasn't paid, so the win-back sheet must not later
 * claim they were a subscriber. Module-scoped (not a store field) — it's
 * a transient RC-layer signal, refreshed on every customer-info sync.
 */
let _activePeriodIsPaid: boolean | null = null;

/** Read the last-synced paid-period signal (see `_activePeriodIsPaid`). */
export const activeEntitlementIsPaid = (): boolean | null => _activePeriodIsPaid;

/**
 * Map a RevenueCat CustomerInfo payload into our local subscription
 * fields. Returns the inferred tier when active, null otherwise.
 *
 * IMPORTANT — never DOWNGRADE the local trial: if the user has an
 * active local soft-trial AND no entitlement on RC, leave the store
 * alone. The soft-trial is a card-less promo we honor regardless of
 * what RC reports.
 */
export const syncFromCustomerInfo = (
  customerInfo: CustomerInfo,
): SubscriptionTier => {
  const ent = customerInfo.entitlements.active[ENTITLEMENT_ID];
  const set = useUserStore.getState().setSubscription;

  if (!ent) {
    // RC reports no active entitlement → no paid-period claim to make.
    _activePeriodIsPaid = null;
    // Don't clobber a local trial. Server-side webhook handles the
    // free downgrade on EXPIRATION events.
    const s = useUserStore.getState();
    if (s.subscriptionStatus === 'active') {
      // RC reports no entitlement, but RC's cold-start cache can be
      // stale while the SERVER row (webhook-authoritative) still
      // says active — instant downgrade here made Pro features blink
      // off at launch for a paying user, then flip back when the
      // server sync ran. Downgrade only when the server AGREES;
      // otherwise keep access and let the EXPIRATION webhook +
      // server sync settle it.
      void (async () => {
        try {
          const uid = (await supabase.auth.getUser()).data.user?.id;
          if (!uid) return;
          const { data } = await supabase
            .from('users')
            .select('subscription_status')
            .eq('id', uid)
            .maybeSingle();
          if (
            data &&
            data.subscription_status !== 'active' &&
            useUserStore.getState().subscriptionStatus === 'active'
          ) {
            set({ status: 'free', tier: null, currentPeriodEnd: null });
          }
        } catch {
          // Offline — keep current access; next server sync settles it.
        }
      })();
    }
    return null;
  }

  // Paid-period truth: 'NORMAL' = paid, 'TRIAL'/'INTRO' = not yet paid.
  // A missing periodType is left as null ("unknown") so we don't wrongly
  // DENY a real payer their paid-history flag — the hook falls back to
  // trusting the server's 'active' in that case.
  _activePeriodIsPaid =
    ent.periodType == null ? null : ent.periodType === 'NORMAL';

  const tier: SubscriptionTier = ent.productIdentifier
    .toLowerCase()
    .includes('annual')
    ? 'annual'
    : 'monthly';

  set({
    status: 'active',
    tier,
    currentPeriodEnd: ent.expirationDate ?? null,
  });
  return tier;
};

/**
 * Subscribe to customer-info updates so renewals, cancellations,
 * and cross-device purchases reflect in the local store without a
 * full app restart. Returns an unsubscribe fn.
 */
export const onCustomerInfoUpdate = (): (() => void) => {
  const P = loadSDK();
  if (!P || !_configured) return () => {};
  const handler = (ci: CustomerInfo) => syncFromCustomerInfo(ci);
  P.addCustomerInfoUpdateListener(handler);
  return () => {
    try {
      P.removeCustomerInfoUpdateListener(handler);
    } catch {
      // listener API was no-op'd — ignore.
    }
  };
};

// ─────────────────────────────────────────────────────────────────────
// Manage subscription deep-link
//
// Apple + Google both expose a system-level subscription manager.
// We never ship an in-app cancel button — store policy requires the
// user to cancel through the platform's own UI.
// ─────────────────────────────────────────────────────────────────────

export const openManageSubscription = async (): Promise<void> => {
  if (Platform.OS === 'ios') {
    await Linking.openURL(STORE_URLS.appleSubscriptions);
    return;
  }
  if (Platform.OS === 'android') {
    await Linking.openURL(
      STORE_URLS.googleSubscriptions,
    );
    return;
  }
};
