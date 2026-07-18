// Lumi · client crash/error telemetry
//
// Production crashes used to vanish into console.warn — invisible
// once the app shipped. This reports them to the write-only
// client_errors table so real-world breakage is diagnosable without
// a third-party SDK (no native module → ships via OTA, works in the
// current builds).
//
// Scope discipline:
//   - Message + trimmed stack only. No user content, no device IDs.
//   - Session cap + dedupe — a render-loop crash can't flood the
//     table (or the user's battery).
//   - Fire-and-forget with its own try/catch: the reporter must
//     NEVER be a second crash.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase, isSupabaseConfigured } from './supabase';

const MAX_PER_SESSION = 5;
let sent = 0;
const seen = new Set<string>();

export const reportError = (
  error: unknown,
  source: 'boundary' | 'global' | 'promise' | `tab:${string}`,
  fatal = false,
): void => {
  try {
    if (!isSupabaseConfigured || sent >= MAX_PER_SESSION) return;
    const err = error instanceof Error ? error : new Error(String(error));
    const message = (err.message || 'unknown').slice(0, 400);
    const key = `${source}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    const stack = (err.stack ?? '').slice(0, 1800);
    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        await supabase.from('client_errors').insert({
          user_id: auth?.user?.id ?? null,
          message,
          stack,
          source,
          fatal,
          app_version: Constants.expoConfig?.version ?? null,
          platform: Platform.OS,
        });
      } catch {
        // Reporting failed — nothing else to do, never rethrow.
      }
    })();
  } catch {
    // Absolute floor: telemetry can never crash the app.
  }
};

/**
 * Install the global JS handlers once (called from _layout). Chains
 * the previous handler so RN's redbox/dev behavior is untouched.
 */
let installed = false;
export const installErrorReporting = (): void => {
  if (installed) return;
  installed = true;

  // Uncaught JS exceptions.
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler(): (e: unknown, fatal?: boolean) => void;
      setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void;
    };
  };
  const prev = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    reportError(e, 'global', !!fatal);
    prev?.(e, fatal);
  });

  // Unhandled promise rejections (Hermes exposes this hook).
  const h = globalThis as unknown as {
    HermesInternal?: {
      enablePromiseRejectionTracker?: (opts: {
        allRejections: boolean;
        onUnhandled: (id: number, e: unknown) => void;
      }) => void;
    };
  };
  try {
    h.HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, e) => reportError(e, 'promise', false),
    });
  } catch {
    // Older engine — skip silently.
  }
};
