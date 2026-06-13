import { useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<
  string,
  string | undefined
>;
const OPENAI_API_KEY =
  process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? extra.OPENAI_API_KEY ?? '';

export const isVoiceConfigured = Boolean(OPENAI_API_KEY);

export type VoiceState = 'idle' | 'recording' | 'transcribing';

interface VoiceController {
  state: VoiceState;
  error: string | null;
  /** Start recording. Resolves once recording has actually begun. */
  start: () => Promise<void>;
  /** Stop + transcribe. Resolves with the transcribed text. */
  stopAndTranscribe: () => Promise<string | null>;
  /** Cancel without transcribing. */
  cancel: () => Promise<void>;
}

/**
 * Voice recording + Whisper transcription.
 *
 * Records via expo-av, then POSTs the resulting m4a to OpenAI's
 * Whisper endpoint and returns the transcribed text. Requires
 * EXPO_PUBLIC_OPENAI_API_KEY. Microphone permission is requested on
 * first use; we surface a friendly error if the user denies.
 */
export const useVoice = (): VoiceController => {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

  // Make sure the audio session is configured so recording works on iOS.
  useEffect(() => {
    void Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    }).catch(() => {
      // ignore; we'll surface errors at start time
    });
    return () => {
      void recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
    };
  }, []);

  const start = async () => {
    setError(null);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Microphone access is off. Enable it in Settings → Lumi.');
        return;
      }
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      await rec.startAsync();
      recordingRef.current = rec;
      setState('recording');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't start recording.",
      );
      setState('idle');
    }
  };

  const stopAndTranscribe = async (): Promise<string | null> => {
    const rec = recordingRef.current;
    if (!rec) return null;
    setState('transcribing');
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recordingRef.current = null;
      if (!uri) {
        setError("Recording didn't save.");
        setState('idle');
        return null;
      }
      if (!isVoiceConfigured) {
        setError(
          'Voice needs EXPO_PUBLIC_OPENAI_API_KEY. Type the text instead, or use the keyboard mic.',
        );
        setState('idle');
        return null;
      }
      const text = await transcribeWithWhisper(uri);
      setState('idle');
      return text;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't transcribe that.",
      );
      setState('idle');
      return null;
    }
  };

  const cancel = async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setState('idle');
    setError(null);
    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
      } catch {
        // already stopped
      }
    }
  };

  return { state, error, start, stopAndTranscribe, cancel };
};

const transcribeWithWhisper = async (uri: string): Promise<string> => {
  const form = new FormData();
  // The Audio.Recording uri is a local file URL — RN handles FormData
  // file uploads via this shape.
  form.append('file', {
    uri,
    name: 'audio.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Whisper ${res.status}: ${text.slice(0, 120)}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? '').trim();
};
