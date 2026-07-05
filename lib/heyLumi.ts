// Lumi · "Hey Lumi" — hands-free wake-word capture (Pro only)
//
// Mock: lumi-hey-lumi.jsx. Say "hey Lumi" (or just "Lumi") while the
// app is open on Home and a bottom sheet slides up, streams what you
// say, runs it through the SAME capture pipeline as the pill
// (tidy → routing gate → deterministic or LLM understand), reads the
// result back, and AUTO-KEEPS in 5s — hands-free must never end in a
// tapping session.
//
// Explicit product decisions (owner's spec):
//   - Triggers ONLY on the spoken phrase. There is NO ambient
//     "sleeping Luna" affordance — the mock's corner cat was cut.
//   - Pro-only. The client gates on access.hasPremium; the LLM leg
//     already goes through the server proxy's per-kind quotas.
//
// iOS reality: third-party apps can't register background wake words
// — "Hey Lumi" works while the app is FOREGROUNDED (Home focused).
// The recognizer runs on device (SFSpeechRecognizer); no audio leaves
// the phone during wake listening, and the transcript is discarded
// after sorting.
//
// One recognizer, two users: expo-speech-recognition is a global
// singleton with GLOBAL events, shared with useVoice (the pill mic).
// Coordination contract:
//   - While a Hey-Lumi session is live, setForeignVoiceSession(true)
//     makes useVoice's handlers ignore our events (no phantom
//     "I didn't catch that" toasts from wake-session no-speech).
//   - Home suspends the wake loop (enabled=false) whenever the pill
//     mic records, the dump modal is open, or the tab blurs — the
//     two never overlap. Teardown drains: ownership is released only
//     when OUR terminal `end` event lands (1s fallback), so late
//     stragglers can't kill a just-started pill session.
//
// Zero-gap capture: the mock pauses 800ms between wake and listen.
// A real recognizer would drop words spoken during that pause
// ("hey lumi remind me to—"), so we keep ONE continuous session hot
// and split its cumulative transcript at the LAST wake-phrase
// occurrence. The 800ms "mm?" beat is pure UI.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { setForeignVoiceSession } from './voice';
import { matchWake } from './heyLumiWake';
import type { SmartTask } from './capture';

// Same lazy-require dance as lib/voice.ts — Expo Go has no native
// module; there the hook stays inert (Home also gates the feature UI
// on isVoiceConfigured).
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
    handler: (e: {
      results?: { transcript?: string }[];
      error?: string;
      message?: string;
    }) => void,
  ) => void;
}

let _speech: SpeechModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _speech = require('expo-speech-recognition') as SpeechModule;
} catch {
  // Expo Go — stay null.
}
const noopHook: SpeechModule['useSpeechRecognitionEvent'] = () => {};
const ExpoSpeechRecognitionModule = _speech?.ExpoSpeechRecognitionModule;
const useSpeechRecognitionEvent =
  _speech?.useSpeechRecognitionEvent ?? noopHook;

/** Profile toggle calls this when the user flips Hey Lumi ON so the
 *  permission prompt happens at an explainable moment, not at some
 *  random later render. Already-granted resolves silently. */
export const requestHeyLumiPermission = async (): Promise<boolean> => {
  if (!ExpoSpeechRecognitionModule) return false;
  try {
    const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return p.granted;
  } catch {
    return false;
  }
};

export type HeyLumiPhase =
  | 'idle' // wake loop listening quietly (or feature suspended)
  | 'wake' // phrase heard — "mm?" pill, mic stays hot
  | 'listening' // sheet up, transcript streaming
  | 'sorting' // parse (deterministic or LLM) running
  | 'sorted' // read-back + auto-keep countdown
  | 'kept'; // toast beat, then back to idle

export const AUTOKEEP_SECONDS = 5;

// End-of-command voice controls (mock: '"that's all" ends listening,
// "scratch that" undoes').
const DONE_RE =
  /[\s,]*\b(that'?s (?:all|it|everything)|that is (?:all|it)|i'?m done|send it|keep (?:it|that|them|both|all))[\s,.!?]*$/i;
const CANCEL_RE =
  /\b(never ?mind|scratch that|cancel that|forget (?:it|that))[\s,.!?]*$/i;

// Command finalizes after this much silence (mock spec: 2s).
const SILENCE_MS = 2200;
// Woke up but nothing was said — stand back down.
const EMPTY_WAKE_TIMEOUT_MS = 9000;
// A command session shouldn't run forever even if the recognizer
// keeps emitting noise revisions.
const MAX_COMMAND_MS = 45000;

export interface HeyLumiController {
  phase: HeyLumiPhase;
  /** Live command transcript (what comes AFTER the wake phrase). */
  transcript: string;
  /** Parsed result shown in the sorted read-back. */
  tasks: SmartTask[];
  /** Seconds left on the auto-keep countdown (sorted phase). */
  countdown: number;
  /** False when the sorted sheet waits for a tap (45s-cap finalize). */
  autoKeep: boolean;
  keep: () => void;
  fixUp: () => void;
  cancel: () => void;
}

interface HeyLumiOpts {
  /** Master gate — Pro + pref + Home focused + pill mic idle. */
  enabled: boolean;
  /** The SAME pipeline the pill uses (tidy → gate → det/LLM). */
  parse: (raw: string) => Promise<SmartTask[]>;
  /** Commit the kept tasks (Home's commitTask + toast). */
  onCommit: (tasks: SmartTask[]) => void;
  /**
   * "Fix up" — hand control back to the tap flow. `parsed` is the
   * sorted result when we have one (Home opens the normal preview
   * cards for editing); empty when parsing failed (Home parks the
   * raw text in the capture pill instead).
   */
  onFixUp: (raw: string, parsed: SmartTask[]) => void;
  /** Mic/speech permission is off — Home flips the pref back. */
  onMicProblem: () => void;
}

export const useHeyLumi = (opts: HeyLumiOpts): HeyLumiController => {
  const [phase, setPhase] = useState<HeyLumiPhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [tasks, setTasks] = useState<SmartTask[]>([]);
  const [countdown, setCountdown] = useState(AUTOKEEP_SECONDS);
  // False when the 45s command cap forced the finalize (ambient
  // TV/radio babble shape) — the sorted sheet then WAITS for a tap
  // instead of auto-keeping, so a noisy room can't loop-commit
  // garbage tasks unattended.
  const autoKeepRef = useRef(true);
  const [autoKeep, setAutoKeep] = useState(true);
  const [appActive, setAppActive] = useState(
    AppState.currentState === 'active',
  );

  // Everything below lives in refs — the recognizer events are
  // global callbacks and must never read stale closures.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // 'off' | 'wake' | 'command' | 'drain' — which session (if any) is
  // ours. 'drain' = we aborted and are waiting for the terminal
  // `end` before releasing mic ownership back to useVoice.
  const modeRef = useRef<'off' | 'wake' | 'command' | 'drain'>('off');
  const cmdTextRef = useRef('');
  // Prefix carried across command-session restarts (iOS caps
  // continuous sessions around a minute).
  const sessionBaseRef = useRef('');
  const lastGrowthRef = useRef(0);
  const wakeAtRef = useRef(0);
  const tasksRef = useRef<SmartTask[]>([]);
  const rawRef = useRef('');
  const restartDelayRef = useRef(400);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const silenceIvRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIvRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const permOkRef = useRef<boolean | null>(null);

  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (silenceIvRef.current) {
      clearInterval(silenceIvRef.current);
      silenceIvRef.current = null;
    }
    if (countdownIvRef.current) {
      clearInterval(countdownIvRef.current);
      countdownIvRef.current = null;
    }
  };

  const releaseMic = () => {
    if (drainTimerRef.current) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    if (modeRef.current === 'drain') {
      modeRef.current = 'off';
      setForeignVoiceSession(false);
    }
  };

  // The drain fallback lives OUTSIDE timersRef on purpose: reset()
  // calls clearTimers() and then endSession() — if the fallback were
  // a normal timer, that ordering could strand modeRef in 'drain'
  // with the foreign flag stuck true (pill mic deaf app-wide) when
  // the native terminal `end` never fires.
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armDrainFallback = () => {
    if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
    drainTimerRef.current = setTimeout(() => {
      drainTimerRef.current = null;
      releaseMic();
    }, 1000);
  };

  /** Abort whatever session is live and drain ownership. */
  const endSession = () => {
    if (modeRef.current === 'off') return;
    if (modeRef.current === 'drain') {
      armDrainFallback(); // re-arm — a clearTimers() may have run
      return;
    }
    modeRef.current = 'drain';
    try {
      ExpoSpeechRecognitionModule?.abort();
    } catch {
      // already stopped — release immediately
      modeRef.current = 'off';
      setForeignVoiceSession(false);
      return;
    }
    // Terminal `end` releases; this is the just-in-case fallback.
    armDrainFallback();
  };

  const beginSession = (mode: 'wake' | 'command') => {
    if (!ExpoSpeechRecognitionModule) return;
    // Re-entrancy: a session is already ours (double effect kick).
    if (modeRef.current === 'wake' || modeRef.current === 'command') return;
    // Staleness: the world moved on while this call sat in a timer.
    if (
      mode === 'wake' &&
      (!optsRef.current.enabled || phaseRef.current !== 'idle')
    ) {
      return;
    }
    if (
      mode === 'command' &&
      phaseRef.current !== 'wake' &&
      phaseRef.current !== 'listening'
    ) {
      return;
    }
    if (modeRef.current === 'drain') {
      // Still draining the previous abort — try again shortly.
      later(() => beginSession(mode), 250);
      return;
    }
    try {
      setForeignVoiceSession(true);
      modeRef.current = mode;
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: false,
      });
    } catch {
      // Recognizer busy (phone call, another session winding down) —
      // retry shortly; the staleness guards above make this safe.
      modeRef.current = 'off';
      setForeignVoiceSession(false);
      later(() => beginSession(mode), 1000);
    }
  };

  /** Full stand-down: back to idle. The enabled-effect restarts the
   *  wake loop from there. */
  const reset = useCallback(() => {
    clearTimers();
    endSession();
    cmdTextRef.current = '';
    sessionBaseRef.current = '';
    setTranscript('');
    setTasks([]);
    tasksRef.current = [];
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalize = () => {
    if (phaseRef.current !== 'listening' && phaseRef.current !== 'wake') {
      return;
    }
    clearTimers();
    endSession();
    const raw = cmdTextRef.current.replace(DONE_RE, '').trim();
    if (!raw) {
      reset();
      return;
    }
    rawRef.current = raw;
    setPhase('sorting');
    void optsRef.current
      .parse(raw)
      .then((parsed) => {
        if (phaseRef.current !== 'sorting') return; // cancelled meanwhile
        if (!parsed || parsed.length === 0) {
          // Nothing task-shaped — hand the text to the pill instead
          // of silently eating it.
          optsRef.current.onFixUp(raw, []);
          reset();
          return;
        }
        tasksRef.current = parsed;
        setTasks(parsed);
        setPhase('sorted');
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
      })
      .catch(() => {
        if (phaseRef.current !== 'sorting') return;
        optsRef.current.onFixUp(raw, []);
        reset();
      });
  };

  const wakeUp = (tail: string) => {
    // Same session keeps running — we only switch what we do with
    // its transcript. No audio gap.
    modeRef.current = 'command';
    autoKeepRef.current = true;
    setAutoKeep(true);
    cmdTextRef.current = tail;
    sessionBaseRef.current = '';
    lastGrowthRef.current = Date.now();
    wakeAtRef.current = Date.now();
    setTranscript(tail);
    setPhase('wake');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
      () => {},
    );
    // The mock's 800ms beat — trimmed a touch since the mic never
    // actually pauses.
    later(() => {
      if (phaseRef.current === 'wake') setPhase('listening');
    }, 650);
    // Silence watchdog — finalizes 2.2s after the transcript stops
    // growing, stands down if the wake was an accident.
    silenceIvRef.current = setInterval(() => {
      const txt = cmdTextRef.current.trim();
      const now = Date.now();
      if (txt && now - lastGrowthRef.current > SILENCE_MS) finalize();
      else if (!txt && now - wakeAtRef.current > EMPTY_WAKE_TIMEOUT_MS) {
        reset();
      } else if (now - wakeAtRef.current > MAX_COMMAND_MS) {
        autoKeepRef.current = false;
        setAutoKeep(false);
        finalize();
      }
    }, 400);
  };

  useSpeechRecognitionEvent('result', (event) => {
    const mode = modeRef.current;
    if (mode !== 'wake' && mode !== 'command') return; // not our session
    const t = event.results?.[0]?.transcript;
    if (typeof t !== 'string') return;
    restartDelayRef.current = 400; // recognizer is healthy again

    if (mode === 'wake') {
      const hit = matchWake(t);
      if (hit) wakeUp(hit.tail);
      return;
    }

    // command — re-derive the tail from the cumulative transcript so
    // recognizer revisions of earlier words stay consistent. FIRST
    // occurrence: the wake already fired; last-occurrence here would
    // wipe the command when the user says the name mid-sentence
    // ("remind me to ask Lumi about the invoice").
    const hit = matchWake(t, 'first');
    const tail = (
      sessionBaseRef.current + (hit ? hit.tail : t)
    ).replace(/\s+/g, ' ');
    if (tail !== cmdTextRef.current) {
      cmdTextRef.current = tail;
      lastGrowthRef.current = Date.now();
      setTranscript(tail.trim());
    }
    if (CANCEL_RE.test(tail)) {
      reset();
      return;
    }
    if (DONE_RE.test(tail) && tail.replace(DONE_RE, '').trim()) finalize();
  });

  useSpeechRecognitionEvent('end', () => {
    const mode = modeRef.current;
    if (mode === 'off') return; // pill's session — not ours
    if (mode === 'drain') {
      releaseMic();
      // Nothing re-triggers the enabled-effect here (phase/enabled
      // unchanged since the abort) — without this, cancelling a live
      // sheet left the wake loop dead until the tab refocused.
      later(() => {
        if (
          optsRef.current.enabled &&
          phaseRef.current === 'idle' &&
          modeRef.current === 'off' &&
          AppState.currentState === 'active'
        ) {
          beginSession('wake');
        }
      }, 300);
      return;
    }
    // The OS ended our continuous session (time cap / route change).
    modeRef.current = 'off';
    setForeignVoiceSession(false);
    if (mode === 'command') {
      if (cmdTextRef.current.trim()) {
        // Mid-dictation death = the silence probably already passed.
        finalize();
      } else if (Date.now() - wakeAtRef.current < EMPTY_WAKE_TIMEOUT_MS) {
        sessionBaseRef.current = cmdTextRef.current.trim()
          ? cmdTextRef.current.trim() + ' '
          : '';
        beginSession('command');
      } else {
        reset();
      }
      return;
    }
    // wake loop — restart with gentle backoff (reset on any result).
    const delay = restartDelayRef.current;
    restartDelayRef.current = Math.min(delay * 2, 15000);
    later(() => {
      if (
        optsRef.current.enabled &&
        phaseRef.current === 'idle' &&
        modeRef.current === 'off' &&
        AppState.currentState === 'active'
      ) {
        beginSession('wake');
      }
    }, delay);
  });

  useSpeechRecognitionEvent('error', (event) => {
    const mode = modeRef.current;
    if (mode === 'off') return;
    const code = event.error ?? 'unknown';
    if (code === 'aborted') {
      // Our own abort — `end` follows and handles release.
      return;
    }
    if (
      code === 'not-allowed' ||
      code === 'audio-capture' ||
      code === 'service-not-allowed'
    ) {
      permOkRef.current = false;
      reset();
      optsRef.current.onMicProblem();
      return;
    }
    // no-speech / network / everything else: let the matching `end`
    // event drive the restart path — just make sure a dead wake
    // session doesn't restart hot-loop (backoff already applied).
  });

  // ── lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setAppActive(s === 'active');
      if (s !== 'active') {
        // Backgrounding kills the mic anyway — stand down cleanly so
        // we don't fight iOS over a dead session.
        reset();
      }
    });
    return () => sub.remove();
  }, [reset]);

  useEffect(() => {
    let alive = true;
    if (
      opts.enabled &&
      appActive &&
      phase === 'idle' &&
      modeRef.current === 'off' &&
      ExpoSpeechRecognitionModule
    ) {
      const kick = async () => {
        // Anything but a confirmed grant re-asks — a one-time denial
        // must not poison the loop after the user re-grants in
        // Settings and flips the pref back on (already-granted
        // resolves silently, and a denial disables the pref, so this
        // can't prompt-loop).
        if (permOkRef.current !== true) {
          permOkRef.current = await requestHeyLumiPermission();
          if (!permOkRef.current) optsRef.current.onMicProblem();
        }
        if (!alive || !permOkRef.current) return;
        if (
          optsRef.current.enabled &&
          phaseRef.current === 'idle' &&
          modeRef.current === 'off'
        ) {
          beginSession('wake');
        }
      };
      void kick();
    }
    if (!opts.enabled && modeRef.current !== 'off') {
      // Suspended (pill mic starting, tab blurred, pref off). Only
      // kill the wake loop — an in-flight command/sheet finishes.
      if (phaseRef.current === 'idle') {
        clearTimers();
        endSession();
      }
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, appActive, phase]);

  // Unmount: full teardown.
  useEffect(
    () => () => {
      clearTimers();
      if (drainTimerRef.current) {
        clearTimeout(drainTimerRef.current);
        drainTimerRef.current = null;
      }
      if (modeRef.current !== 'off' && modeRef.current !== 'drain') {
        try {
          ExpoSpeechRecognitionModule?.abort();
        } catch {
          // already stopped
        }
      }
      modeRef.current = 'off';
      setForeignVoiceSession(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── auto-keep countdown (sorted phase) ───────────────────────────
  // The updater stays PURE (only decrements); keep() fires from the
  // zero-effect below. Side effects inside setState updaters can be
  // re-invoked by React — that path double-committed tasks.
  useEffect(() => {
    if (phase !== 'sorted' || !autoKeepRef.current) return;
    setCountdown(AUTOKEEP_SECONDS);
    countdownIvRef.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => {
      if (countdownIvRef.current) {
        clearInterval(countdownIvRef.current);
        countdownIvRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === 'sorted' && countdown === 0 && autoKeepRef.current) {
      keepRef.current();
    }
  }, [phase, countdown]);

  const keep = useCallback(() => {
    if (phaseRef.current !== 'sorted') return;
    clearTimers();
    optsRef.current.onCommit(tasksRef.current);
    setPhase('kept');
    later(() => {
      if (phaseRef.current === 'kept') reset();
    }, 1700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reset]);
  const keepRef = useRef(keep);
  keepRef.current = keep;

  const fixUp = useCallback(() => {
    if (phaseRef.current !== 'sorted' && phaseRef.current !== 'sorting') {
      return;
    }
    clearTimers();
    optsRef.current.onFixUp(rawRef.current, tasksRef.current);
    reset();
  }, [reset]);

  const cancel = useCallback(() => {
    reset();
  }, [reset]);

  return { phase, transcript, tasks, countdown, autoKeep, keep, fixUp, cancel };
};
