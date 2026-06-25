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
// - `interimResults: false` so only the finalized transcript is
//   delivered (cheaper and avoids partial flicker — the existing
//   UI was built for "speak, then submit," not live transcription).
// - The library uses a single shared recognizer; only one mic
//   should be active at a time, which matches how the UI works.

import { useEffect, useRef, useState } from 'react';

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
    const text = transcriptRef.current.trim();
    setState('idle');
    settle(text.length > 0 ? text : null);
  });

  useSpeechRecognitionEvent('error', (event) => {
    // Common error codes from expo-speech-recognition:
    //   "no-speech"      — they didn't say anything
    //   "audio-capture"  — mic permission issue
    //   "not-allowed"    — speech recognition permission denied
    //   "network"        — Android: cloud fallback needed but offline
    //   "aborted"        — we cancelled
    const code = event.error ?? 'unknown';
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
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        // Stream partials so Capture can show what the user is
        // saying as they speak (live transcription in the field).
        interimResults: true,
        continuous: false,
        // Prefer on-device when the platform supports it (iOS 13+).
        // Android typically routes through Google's free recognizer.
        requiresOnDeviceRecognition: false,
      });
      setPartial('');
      setState('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start recording.");
      setState('idle');
    }
  };

  const stopAndTranscribe = (): Promise<string | null> => {
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
