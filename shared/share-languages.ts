/**
 * Languages the Promote tab can write share posts in.
 *
 * Deliberately wider than the UI locales: the person writing the post and the
 * people who should read it are rarely in the same language. An agency running
 * its dashboard in English still recruits in Hindi, and a Norwegian shop still
 * hires in Norwegian. The default stays `auto` — the job description's own
 * language — so nobody has to pick before they can share.
 *
 * A closed list rather than a free-text field: the value goes straight into the
 * model's system prompt, so it has to be something the server chose.
 */
export interface ShareLanguage {
  /** Stored on the job with the cached copy. */
  code: string
  /** Shown in the picker, in the language itself where that's the norm. */
  label: string
  /** Named to the model in English — the reliable way to ask for a language. */
  promptName: string
}

export const SHARE_LANGUAGE_AUTO = 'auto'

export const SHARE_LANGUAGES: ShareLanguage[] = [
  { code: SHARE_LANGUAGE_AUTO, label: 'Same as job description', promptName: '' },
  { code: 'en', label: 'English', promptName: 'English' },
  { code: 'es', label: 'Español', promptName: 'Spanish' },
  { code: 'pt', label: 'Português', promptName: 'Portuguese' },
  { code: 'fr', label: 'Français', promptName: 'French' },
  { code: 'de', label: 'Deutsch', promptName: 'German' },
  { code: 'nl', label: 'Nederlands', promptName: 'Dutch' },
  { code: 'it', label: 'Italiano', promptName: 'Italian' },
  { code: 'pl', label: 'Polski', promptName: 'Polish' },
  { code: 'nb', label: 'Norsk bokmål', promptName: 'Norwegian Bokmål' },
  { code: 'sv', label: 'Svenska', promptName: 'Swedish' },
  { code: 'da', label: 'Dansk', promptName: 'Danish' },
  { code: 'fi', label: 'Suomi', promptName: 'Finnish' },
  { code: 'tr', label: 'Türkçe', promptName: 'Turkish' },
  { code: 'ar', label: 'العربية', promptName: 'Arabic' },
  { code: 'hi', label: 'हिन्दी', promptName: 'Hindi' },
  { code: 'ta', label: 'தமிழ்', promptName: 'Tamil' },
  { code: 'id', label: 'Bahasa Indonesia', promptName: 'Indonesian' },
  { code: 'vi', label: 'Tiếng Việt', promptName: 'Vietnamese' },
  { code: 'th', label: 'ไทย', promptName: 'Thai' },
  { code: 'ja', label: '日本語', promptName: 'Japanese' },
  { code: 'ko', label: '한국어', promptName: 'Korean' },
  { code: 'zh', label: '中文 (简体)', promptName: 'Simplified Chinese' },
]

export const SHARE_LANGUAGE_CODES = SHARE_LANGUAGES.map(l => l.code)

/** Falls back to `auto` so a code retired from the list still resolves. */
export function shareLanguage(code: string | null | undefined): ShareLanguage {
  return SHARE_LANGUAGES.find(l => l.code === code) ?? SHARE_LANGUAGES[0]!
}
