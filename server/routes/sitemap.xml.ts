import { and, eq } from 'drizzle-orm'
import { job, careerPage } from '../database/schema'

/**
 * GET /sitemap.xml
 * Public XML sitemap of the indexable surfaces served from this app: the jobs
 * board, every open job, and every live branded career page.
 *
 * URLs are emitted for the default locale (unprefixed) and self-referential to
 * the request origin, so the file is correct on whichever host serves it.
 * Localized alternates are discovered via the per-page hreflang <link> tags that
 * @nuxtjs/i18n injects, so they are intentionally not duplicated here.
 */

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export default defineEventHandler(async (event) => {
  const origin = getRequestURL(event).origin

  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${origin}/jobs` },
  ]

  // Open jobs — each has its own indexable /jobs/:slug page (JobPosting markup).
  const jobs = await db.query.job.findMany({
    // Test roles are reachable by direct link so their creator can walk the
    // apply flow, but they are never submitted to search engines.
    where: and(eq(job.status, 'open'), eq(job.isTest, false)),
    columns: { slug: true, updatedAt: true },
  })
  for (const j of jobs) {
    urls.push({ loc: `${origin}/jobs/${j.slug}`, lastmod: j.updatedAt.toISOString() })
  }

  // Live career pages — orgs that have customized their page (a row exists) and
  // left it enabled. Orgs that never touched their page (no row) still have a
  // default page but are omitted here; they remain crawlable when linked.
  const pages = await db.query.careerPage.findMany({
    where: eq(careerPage.enabled, true),
    columns: { slug: true, organizationId: true, updatedAt: true },
    with: { organization: { columns: { slug: true } } },
  })
  for (const p of pages) {
    const canonicalSlug = p.slug ?? p.organization.slug
    urls.push({ loc: `${origin}/career/${canonicalSlug}`, lastmod: p.updatedAt.toISOString() })
  }

  const body
    = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + urls
        .map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
        .join('\n')
      + '\n</urlset>\n'

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
  return body
})
