// ─────────────────────────────────────────────
// URL slug generation for public-facing job pages
// ─────────────────────────────────────────────

/**
 * Generates a URL-safe slug from a job title + job ID.
 * Format: `slugified-title-shortid` (e.g. `senior-software-engineer-a1b2c3d4`)
 *
 * The 8-char ID suffix guarantees uniqueness even for identical titles.
 * If a custom slug is provided, it is sanitised and used instead of the title.
 *
 * Called on create, and on update only for drafts or an explicit slug change —
 * a published job's slug is its public URL, and nothing redirects the old one.
 */
export function generateJobSlug(title: string, id: string, customSlug?: string): string {
  const raw = customSlug?.trim() || title
  const base = raw
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')    // strip non-word chars (except spaces/hyphens)
    .replace(/[\s_]+/g, '-')     // spaces / underscores → hyphens
    .replace(/-+/g, '-')         // collapse multiple hyphens
    .replace(/^-|-$/g, '')       // trim leading/trailing hyphens
    .slice(0, 60)                // cap base length

  const shortId = id.replace(/-/g, '').slice(0, 8)
  return `${base}-${shortId}`
}

/**
 * Decide whether a job update may move the slug, and to what.
 * Returns `undefined` when the existing slug must be kept.
 *
 * A published job's slug is its public URL — indexed by Google, reposted to job
 * boards, sitting in already-sent emails — and nothing redirects the old one, so
 * a title edit must not move it. Drafts aren't publicly resolvable yet (the
 * public endpoints only serve `open` jobs), so retitling a draft is free.
 */
export function resolveJobSlugUpdate(args: {
  id: string
  currentStatus: string
  currentTitle: string
  newTitle?: string
  customSlug?: string
}): string | undefined {
  const { id, currentStatus, currentTitle, newTitle, customSlug } = args

  // An explicit slug is the recruiter asking for the rename on purpose.
  if (customSlug?.trim()) {
    return generateJobSlug(newTitle ?? currentTitle, id, customSlug)
  }

  if (newTitle && currentStatus === 'draft') {
    return generateJobSlug(newTitle, id)
  }

  return undefined
}
