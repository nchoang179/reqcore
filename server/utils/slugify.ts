// ─────────────────────────────────────────────
// URL slug generation for public-facing job pages
// ─────────────────────────────────────────────

import { JOB_SLUG_FALLBACK_BASE, jobSlugBase, slugifyJobBase } from '../../shared/job-slug'

/**
 * Generates a URL-safe slug from a job title + job ID.
 * Format: `slugified-title-shortid` (e.g. `senior-software-engineer-a1b2c3d4`)
 *
 * The 8-char ID suffix guarantees uniqueness even for identical titles.
 * If a custom slug is provided, it is sanitised and used instead of the title.
 *
 * Idempotent: feeding a slug this function produced back in as `customSlug`
 * returns it unchanged. Callers have round-tripped stored slugs through here
 * before, and without the strip every save appended another suffix — moving the
 * public URL five times over before the 60-char cap finally absorbed the growth.
 *
 * Called on create, and on update only for never-published jobs or an explicit
 * slug change — a published job's slug is its public URL, and nothing redirects
 * the old one.
 */
export function generateJobSlug(title: string, id: string, customSlug?: string): string {
  const raw = customSlug?.trim() || title
  // Slugified first so a suffix is in its canonical `-a1b2c3d4` form however it
  // arrived, then stripped so it is never appended twice.
  const base = jobSlugBase(slugifyJobBase(raw)) || JOB_SLUG_FALLBACK_BASE

  const shortId = id.replace(/-/g, '').slice(0, 8)
  return `${base}-${shortId}`
}

/**
 * Decide whether a job update may move the slug, and to what.
 * Returns `undefined` when the existing slug must be kept.
 *
 * A published job's slug is its public URL — indexed by Google, reposted to job
 * boards, sitting in already-sent emails — and nothing redirects the old one, so
 * a title edit must not move it. A job that has never been published isn't
 * publicly resolvable yet, so retitling it is free.
 *
 * Keyed on `publishedAt` rather than on the current status, because status comes
 * back: `open → archived → draft` is an allowed transition, so a status check
 * let anyone park a live role, send it back to draft, retitle it, and take every
 * published link down with it.
 */
export function resolveJobSlugUpdate(args: {
  id: string
  publishedAt: Date | null
  currentTitle: string
  newTitle?: string
  customSlug?: string
}): string | undefined {
  const { id, publishedAt, currentTitle, newTitle, customSlug } = args

  // An explicit slug is the recruiter asking for the rename on purpose. Callers
  // must only send one the recruiter actually changed — sending back whatever
  // was loaded into the field reads as a deliberate rename on every save.
  if (customSlug?.trim()) {
    return generateJobSlug(newTitle ?? currentTitle, id, customSlug)
  }

  if (newTitle && publishedAt === null) {
    return generateJobSlug(newTitle, id)
  }

  return undefined
}

/** The global unique constraint on `job.slug`. */
const JOB_SLUG_UNIQUE_CONSTRAINT = 'job_slug_unique'

/**
 * Whether a failed write was Postgres refusing a duplicate `job.slug`.
 *
 * The suffix is only 32 bits, so two jobs collide only on an identical base
 * *and* an identical 8-hex draw — but staffing agencies repost the same titles
 * endlessly, and within a group sharing a base the birthday odds reach a few
 * percent at scale. Callers retry with a fresh suffix; without that the
 * recruiter gets a bare "Internal Server Error" on job creation.
 */
export function isDuplicateJobSlugError(error: unknown): boolean {
  const pgError = error as { code?: string, constraint_name?: string } | null
  return pgError?.code === '23505' && pgError.constraint_name === JOB_SLUG_UNIQUE_CONSTRAINT
}
