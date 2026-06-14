import { useEffect, useState } from 'react';
import {
  useAudioRecorder,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from 'expo-audio';
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
  start: () => Promise<void>;
  stopAndTranscribe: () => Promise<string | null>;
  cancel: () => Promise<void>;
}

/**
 * Voice recording + Whisper transcription.
 *
 * Uses expo-audio (the modern replacement for expo-av's Audio.Recording).
 * Records to a local m4a, then POSTs it to OpenAI's Whisper endpoint and
 * returns the transcribed text. Requires EXPO_PUBLIC_OPENAI_API_KEY.
 * Microphone permission is requested on first use; we surface a friendly
 * error if the user denies.
 */
export const useVoice = (): VoiceController => {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Configure the audio session so recording works in silent mode on iOS.
  useEffect(() => {
    void setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    }).catch(() => {
      // ignore; we'll surface errors at start time
    });
  }, []);

  const start = async () => {
    setError(null);
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone access is off. Enable it in Settings → Lumi.');
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState('recording');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't start recording.",
      );
      setState('idle');
    }
  };

  const stopAndTranscribe = async (): Promise<string | null> => {
    if (state !== 'recording') return null;
    setState('transcribing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
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
    setError(null);
    if (state === 'recording') {
      try {
        await recorder.stop();
      } catch {
        // already stopped
      }
    }
    setState('idle');
  };

  return { state, error, start, stopAndTranscribe, cancel };
};

const transcribeWithWhisper = async (uri: string): Promise<string> => {
  const form = new FormData();
  // The recorder uri is a local file URL — RN handles FormData file
  // uploads via this { uri, name, type } shape.
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
