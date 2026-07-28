import { eq, and, desc } from 'drizzle-orm'
import { job } from '../../../database/schema'
import { resolveCareerPageBySlug } from '../../../utils/careerPage'
import { publicJobSlugSchema } from '../../../utils/schemas/publicApplication'

/**
 * GET /api/public/career-page/:slug
 * Public, no auth. Returns the org's branded career-page payload: identity
 * (name, logo, accent, headline, description) and its open jobs.
 *
 * The `:slug` may be a custom career-page slug or the org slug (custom wins).
 * `canonicalSlug` lets the page emit a canonical URL when both resolve.
 *
 * - Org not found → 404.
 * - Org found but page disabled → 200 with `{ offline: true }` so the
 *   page can render an "unavailable" state rather than a hard 404.
 */
export default defineEventHandler(async (event) => {
  const { slug } = await getValidatedRouterParams(event, publicJobSlugSchema.parse)

  const resolved = await resolveCareerPageBySlug(slug)
  if (!resolved) {
    throw createError({ statusCode: 404, statusMessage: 'Career page not found' })
  }
  const { org, config, canonicalSlug } = resolved

  // Cache-busting version so re-uploads bypass the browser cache. Asset URLs are
  // keyed by the canonical slug so they resolve no matter which URL was hit.
  const version = config?.updatedAt ? new Date(config.updatedAt).getTime() : 0
  const assetUrl = (kind: 'logo' | 'banner') =>
    `/api/public/career-page/${canonicalSlug}/asset?kind=${kind}&v=${version}`
  // Career-page logo overrides the org logo; banner has no org-level fallback.
  const logo = config?.logoStorageKey ? assetUrl('logo') : org.logo
  const banner = config?.bannerStorageKey ? assetUrl('banner') : null
  const bannerPosition = config?.bannerPosition ?? 50

  const enabled = config?.enabled ?? true
  if (!enabled) {
    return {
      offline: true,
      canonicalSlug,
      name: org.name,
      logo,
      banner,
      bannerPosition,
      accentColor: null,
      headline: null,
      description: null,
      jobs: [],
    }
  }

  const jobs = await db.query.job.findMany({
    // A test role stays out of the org's branded careers page too — that page
    // is shown to real candidates.
    where: and(eq(job.organizationId, org.id), eq(job.status, 'open'), eq(job.isTest, false)),
    orderBy: [desc(job.createdAt)],
    columns: {
      id: true,
      title: true,
      slug: true,
      location: true,
      type: true,
      experienceLevel: true,
      remoteStatus: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryUnit: true,
      salaryNegotiable: true,
      createdAt: true,
    },
  })

  return {
    offline: false,
    canonicalSlug,
    name: org.name,
    logo,
    banner,
    bannerPosition,
    accentColor: config?.accentColor ?? null,
    headline: config?.headline ?? null,
    description: config?.description ?? null,
    jobs,
  }
})
