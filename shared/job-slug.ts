/**
 * ─────────────────────────────────────────────
 * Job slug shape — single source of truth
 * ─────────────────────────────────────────────
 *
 * A job slug is `<base>-<8 hex>`: a readable base derived from the title (or
 * from a recruiter's custom slug), plus a short suffix that keeps the globally
 * unique `job.slug` column collision-free when the same title is posted twice.
 *
 * Both halves live here because three places have to agree on them: the server
 * that mints the slug, the create wizard that previews it, and the settings
 * form, which must show the recruiter the editable base *without* the suffix —
 * seeding that field with the full stored slug is what used to re-append the
 * suffix on every save.
 */

/** The generated half of a slug, as appended by `generateJobSlug`. */
export const JOB_SLUG_SUFFIX_PATTERN = /-[0-9a-f]{8}$/

/** Cap on the readable half. The suffix is added on top of this. */
export const JOB_SLUG_BASE_MAX_LENGTH = 60

/** Stands in when a title slugifies to nothing at all. */
export const JOB_SLUG_FALLBACK_BASE = 'job'

/**
 * Turn a title (or a custom slug) into the readable half of a job slug.
 *
 * Unicode-aware on purpose: the ASCII-only `\w` this used to filter on collapsed
 * every non-Latin title to an empty string, so `软件工程师` and `Софтуерен
 * инженер` both published at `/jobs/-3f1a2b4c` — no keyword, and a link preview
 * that reads as broken. Accented Latin fared no better (`Ingénieur` →
 * `ingnieur`). We ship vi/nb/fr/de/es locales, so this is a live path.
 */
export function slugifyJobBase(raw: string): string {
  const normalized = raw
    // NFKD splits `é` into `e` + a combining mark so the mark can be dropped and
    // the letter kept — an accent should not cost you a character.
    //
    // Only the Latin combining block is dropped, never `\p{M}` wholesale: a
    // Devanagari matra is a letter's vowel, not an accent, and stripping those
    // turns `मुख्य कार्यकारी` into the nonsense `मखय करयकर`. Recomposed
    // afterwards so scripts NFKD splits into separate letters — Hangul into
    // jamo — go back to the form a reader recognises.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks
    .normalize('NFC')
    .toLowerCase()
    // Letters and digits in *any* script survive; underscores are kept here only
    // so the next step can fold them into hyphens.
    //
    // `\p{M}` has to be in the keep-set too, or this quietly undoes the care
    // above: a Devanagari matra is a mark, not a letter, so filtering to
    // letters alone strips the vowels right back out. The Latin accents are
    // already gone by this point, so nothing re-enters here.
    .replace(/[^\p{L}\p{N}\p{M}\s_-]+/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    // Sliced before the hyphens are trimmed, not after: a cut landing on a
    // hyphen would otherwise leave `…foo--3f1a2b4c`.
    .slice(0, JOB_SLUG_BASE_MAX_LENGTH)
    .replace(/^-|-$/g, '')

  // A title of `"..."` or `"   "` has no letters to slug at all. A readable
  // fallback beats a slug that is nothing but a leading hyphen and the suffix.
  return normalized || JOB_SLUG_FALLBACK_BASE
}

/**
 * Strip the generated suffix, leaving the part a recruiter may edit.
 *
 * Returns `''` for a slug that is only a suffix — callers decide what to show
 * for that, rather than getting a fallback base they did not ask for.
 */
export function jobSlugBase(slug: string): string {
  return slug.replace(JOB_SLUG_SUFFIX_PATTERN, '')
}
