// Capture transcription languages — BCP-47 tags. The voice layer
// passes the active tag to expo-speech-recognition; the LLM capture
// parser also reads it to hint output language.

export interface CaptureLang {
  /** BCP-47 tag stored in userStore.captureLang */
  tag: string;
  /** User-facing label in the Settings row + picker */
  label: string;
  /** Native-language hint, shown muted under the label */
  native: string;
}

export const CAPTURE_LANGUAGES: CaptureLang[] = [
  { tag: 'en-US', label: 'English', native: 'United States' },
  { tag: 'en-GB', label: 'English', native: 'United Kingdom' },
  { tag: 'es-ES', label: 'Spanish', native: 'Español' },
  { tag: 'es-MX', label: 'Spanish', native: 'México' },
  { tag: 'fr-FR', label: 'French', native: 'Français' },
  { tag: 'de-DE', label: 'German', native: 'Deutsch' },
  { tag: 'pt-BR', label: 'Portuguese', native: 'Brasil' },
  { tag: 'pt-PT', label: 'Portuguese', native: 'Portugal' },
  { tag: 'it-IT', label: 'Italian', native: 'Italiano' },
  { tag: 'ja-JP', label: 'Japanese', native: '日本語' },
  { tag: 'ko-KR', label: 'Korean', native: '한국어' },
  { tag: 'zh-CN', label: 'Chinese', native: '简体中文' },
];

/** "en-US" → "English (United States)". Falls back to the raw tag. */
export const languageLabel = (tag: string): string => {
  const hit = CAPTURE_LANGUAGES.find((l) => l.tag === tag);
  return hit ? `${hit.label} (${hit.native})` : tag;
};
