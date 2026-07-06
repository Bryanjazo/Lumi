// Lumi · voice recording + on-device transcription
//
// Uses expo-speech-recognition, which wraps the OS-native speech
// recognizers: iOS SFSpeechRecognizer + Android SpeechRecognizer.
// Both run ON DEVICE (no audio leaves the phone), are free, and
// don't require any third-party API key — so the OpenAI dependency
// is gone entirely.
//
// The public API (`useVoice()` returning {state, error, start,
// stopAndTranscribe, cancel}) is unchanged so the 4 mic-button
// callsites (Home, Capture, Untangle, Onboarding) don't need any
// edits.
//
// Implementation notes:
// - The recognizer is event-driven (result / end / error). We wrap
//   it into the existing promise-returning `stopAndTranscribe`
//   shape by storing a resolver ref and finishing the promise on
//   the `end` event.
// - `interimResults: true` — partials stream so capture surfaces
//   delivered (cheaper and avoids partial flicker — the existing
//   UI was built for "speak, then submit," not live transcription).
// - The library uses a single shared recognizer; only one mic
//   should be active at a time, which matches how the UI works.

import { useEffect, useRef, useState } from 'react';
import { useUserStore } from '../store/userStore';

// Lazy load expo-speech-recognition so the app still boots in Expo
// Go (where the native module isn't bundled). On a dev client /
// standalone build the require resolves normally and voice works.
// In Expo Go, every method becomes a no-op and the mic UI gates
// off via `isVoiceConfigured = false`.
//
// `useSpeechRecognitionEvent` is a React hook — we can't conditionally
// skip calling it, so we stub it with a no-op when the module is
// missing. Stubbed hook honors the rules-of-hooks contract.
interface SpeechModule {
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync(): Promise<{ granted: boolean }>;
    start(opts: {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      requiresOnDeviceRecognition: boolean;
    }): void;
    stop(): void;
    abort(): void;
  };
  useSpeechRecognitionEvent: (
    event: string,
    handler: (e: { results?: { transcript?: string }[]; error?: string; message?: string }) => void,
  ) => void;
}

let _speech: SpeechModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _speech = require('expo-speech-recognition') as SpeechModule;
} catch {
  // Native module unavailable (Expo Go). Stay null.
}

const noopHook: SpeechModule['useSpeechRecognitionEvent'] = () => {};
const ExpoSpeechRecognitionModule = _speech?.ExpoSpeechRecognitionModule;
const useSpeechRecognitionEvent =
  _speech?.useSpeechRecognitionEvent ?? noopHook;

// Voice is "configured" only when the native module is present —
// false in Expo Go, true on a dev/standalone build. Callsites that
// gate UI on it (Capture's mic disable) check this flag.
export const isVoiceConfigured = _speech != null;

// ── Foreign-session ownership (Hey Lumi) ──────────────────────────
// expo-speech-recognition has ONE global recognizer and GLOBAL
// events. The "Hey Lumi" wake engine (lib/heyLumi.ts) runs its own
// continuous sessions; while it owns the mic, useVoice's handlers
// must ignore events entirely — otherwise a wake-session "no-speech"
// error toasts "I didn't catch that" out of nowhere, and a wake
// session's `end` could settle a pill promise. Sessions themselves
// never overlap (Home suspends the wake loop before starting the
// pill mic); this flag covers the async event stragglers.
let _foreignSession = false;
export const setForeignVoiceSession = (v: boolean): void => {
  _foreignSession = v;
};
export const isForeignVoiceSession = (): boolean => _foreignSession;

export type VoiceState = 'idle' | 'recording' | 'transcribing';

interface VoiceController {
  state: VoiceState;
  error: string | null;
  /**
   * Live partial transcript that streams while the user is speaking.
   * Empty string when idle. Use this to show the user what they're
   * saying in real time (Capture's TextInput renders it).
   */
  partial: string;
  start: () => Promise<void>;
  stopAndTranscribe: () => Promise<string | null>;
  cancel: () => Promise<void>;
}

export const useVoice = (): VoiceController => {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  // Streamed partial — updated on every `result` event while
  // interimResults is true. Cleared on start/cancel.
  const [partial, setPartial] = useState('');

  // Latest finalized transcript captured by the `result` event.
  const transcriptRef = useRef<string>('');
  // When stopAndTranscribe is awaited, we resolve this once the
  // `end` event arrives so the caller receives the *finalized*
  // text (Android may keep adjusting up to that point).
  const resolverRef = useRef<((text: string | null) => void) | null>(null);
  // Safety: if the platform never fires `end`, settle the promise
  // after a short fallback so the UI doesn't hang.
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cold-start bounce guard: iOS sometimes fires an immediate `end`
  // (or no-speech error) right after the FIRST start of a session —
  // the audio pipeline wasn't warm yet. If that happens within the
  // window, with nothing transcribed and no stop requested, restart
  // once silently instead of flipping the button back to idle and
  // making the user press twice.
  const startedAtRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const autoRetriedRef = useRef(false);

  const settle = (text: string | null) => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (resolverRef.current) {
      resolverRef.current(text);
      resolverRef.current = null;
    }
  };

  useSpeechRecognitionEvent('result', (event) => {
    if (isForeignVoiceSession()) return; // Hey Lumi owns the mic
    // With interimResults: true the library fires this repeatedly as
    // the recognizer's hypothesis evolves. Update both the rolling
    // ref (used to settle the promise on `end`) and the partial
    // state (drives the live UI).
    const t = event.results?.[0]?.transcript;
    if (typeof t === 'string') {
      const cleaned = t.trim();
      transcriptRef.current = cleaned;
      setPartial(cleaned);
    }
  });

  useSpeechRecognitionEvent('end', () => {
    if (isForeignVoiceSession()) return; // Hey Lumi owns the mic
    if (bounceRetry()) return; // cold-start blip — session restarted
    const text = transcriptRef.current.trim();
    setState('idle');
    settle(text.length > 0 ? text : null);
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (isForeignVoiceSession()) return; // Hey Lumi owns the mic
    // Common error codes from expo-speech-recognition:
    //   "no-speech"      — they didn't say anything
    //   "audio-capture"  — mic permission issue
    //   "not-allowed"    — speech recognition permission denied
    //   "network"        — Android: cloud fallback needed but offline
    //   "aborted"        — we cancelled
    const code = event.error ?? 'unknown';
    if (code === 'no-speech' && bounceRetry()) return;
    if (code === 'aborted') {
      // Silent — user cancelled.
      setState('idle');
      settle(null);
      return;
    }
    const friendly =
      code === 'no-speech'
        ? "I didn't catch that — give it another try?"
        : code === 'not-allowed' || code === 'audio-capture'
          ? 'Microphone or speech access is off. Enable it in Settings → Lumi.'
          : code === 'network'
            ? "Speech needs a connection right now — type instead."
            : event.message ?? "Couldn't hear that.";
    setError(friendly);
    setState('idle');
    settle(null);
  });

  // Make sure any in-flight promise resolves if the hook unmounts
  // mid-recording (avoids leaks in tests / fast-route changes).
  useEffect(
    () => () => {
      if (resolverRef.current) settle(null);
    },
    [],
  );

  const nativeStart = () => {
    ExpoSpeechRecognitionModule!.start({
      // The Settings → "Capture language" pick — was hardcoded to
      // en-US, which made the setting decorative. iOS/Android both
      // transcribe all listed locales on device.
      lang: useUserStore.getState().captureLang || 'en-US',
      // Stream partials so Capture can show what the user is
      // saying as they speak (live transcription in the field).
      interimResults: true,
      continuous: false,
      // Prefer on-device when the platform supports it (iOS 13+).
      // Android typically routes through Google's free recognizer.
      requiresOnDeviceRecognition: false,
    });
  };

  const bounceRetry = (): boolean => {
    const bounced =
      !stopRequestedRef.current &&
      !autoRetriedRef.current &&
      transcriptRef.current.trim().length === 0 &&
      Date.now() - startedAtRef.current < 900;
    if (!bounced || !ExpoSpeechRecognitionModule) return false;
    autoRetriedRef.current = true;
    try {
      nativeStart();
      startedAtRef.current = Date.now();
      return true; // still recording — swallow the bounce
    } catch {
      return false;
    }
  };

  const start = async () => {
    setError(null);
    transcriptRef.current = '';
    if (!ExpoSpeechRecognitionModule) {
      setError('Voice needs the dev build — try typing instead.');
      return;
    }
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setError(
          'Microphone or speech access is off. Enable it in Settings → Lumi.',
        );
        return;
      }
      nativeStart();
      startedAtRef.current = Date.now();
      stopRequestedRef.current = false;
      autoRetriedRef.current = false;
      setPartial('');
      setState('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start recording.");
      setState('idle');
    }
  };

  const markStopRequested = () => {
    stopRequestedRef.current = true;
  };

  const stopAndTranscribe = (): Promise<string | null> => {
    markStopRequested();
    if (state !== 'recording') return Promise.resolve(null);
    if (!ExpoSpeechRecognitionModule) return Promise.resolve(null);
    setState('transcribing');
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // Recognizer already stopped — settle with whatever we have.
        resolverRef.current = null;
        resolve(transcriptRef.current.trim() || null);
        setState('idle');
        return;
      }
      // Fallback: if `end` never fires (rare), settle after 4s.
      fallbackTimerRef.current = setTimeout(() => {
        if (resolverRef.current === resolve) {
          resolverRef.current = null;
          resolve(transcriptRef.current.trim() || null);
          setState('idle');
        }
      }, 4000);
    });
  };

  const cancel = async () => {
    markStopRequested();
    setError(null);
    if (
      ExpoSpeechRecognitionModule &&
      (state === 'recording' || state === 'transcribing')
    ) {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // already stopped
      }
    }
    transcriptRef.current = '';
    setPartial('');
    settle(null);
    setState('idle');
  };

  return { state, error, partial, start, stopAndTranscribe, cancel };
};
