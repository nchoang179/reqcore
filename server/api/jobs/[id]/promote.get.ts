import { eq, and, desc } from 'drizzle-orm'
import { job, organization, careerPage, trackingLink, member, user } from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'
import { tierHasFeature } from '../../../../shared/billing'
import { resolveOrgPlanId } from '../../../utils/billing/plan'
import {
  checkFeedEligibility,
  feedValidThrough,
  FEED_BOARDS,
  FEED_BOARD_LABELS,
} from '../../../utils/jobFeed'

/**
 * GET /api/jobs/:id/promote
 *
 * Everything the Promote tab needs to answer "where is this job right now, and
 * what else can I do?" in one round trip: the public links, whether the job
 * qualifies for the job board feed (and why not, if it doesn't), and the
 * tracking links already created for it.
 *
 * The last part is why this endpoint exists rather than the tab rebuilding the
 * wizard's local state: links created during the wizard were previously
 * invisible the moment you navigated away.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const found = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: {
      id: true,
      title: true,
      slug: true,
      status: true,
      description: true,
      locationCountry: true,
      remoteStatus: true,
      validThrough: true,
      distributeToBoards: true,
      publishedAt: true,
      createdAt: true,
    },
  })

  if (!found) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, orgId),
    columns: { slug: true, name: true },
  })

  // Mirrors the feed's own org-level checks so the tab never claims a job is
  // live on boards when the feed would drop it.
  const isDemo = Boolean(env.DEMO_ORG_SLUG) && org?.slug === env.DEMO_ORG_SLUG
  const owner = await db.query.member.findFirst({
    where: and(eq(member.organizationId, orgId), eq(member.role, 'owner')),
    columns: { id: true },
    with: { user: { columns: { emailVerified: true } } },
  })

  const ineligible = checkFeedEligibility(found, {
    isDemo,
    ownerEmailVerified: Boolean(owner?.user?.emailVerified),
  })

  // The org's branded career page, when their plan includes it and it's on.
  let careerPageSlug: string | null = null
  const tier = await resolveOrgPlanId(orgId)
  if (tierHasFeature(tier, 'careerPage')) {
    const cp = await db.query.careerPage.findFirst({
      where: eq(careerPage.organizationId, orgId),
      columns: { slug: true, enabled: true },
    })
    if (cp?.enabled ?? true) {
      careerPageSlug = cp?.slug ?? org?.slug ?? null
    }
  }

  const links = await db.query.trackingLink.findMany({
    where: and(eq(trackingLink.organizationId, orgId), eq(trackingLink.jobId, id)),
    columns: {
      id: true,
      channel: true,
      name: true,
      code: true,
      clickCount: true,
      applicationCount: true,
      isActive: true,
    },
    orderBy: [desc(trackingLink.createdAt)],
  })

  const postedAt = found.publishedAt ?? found.createdAt

  return {
    job: {
      id: found.id,
      title: found.title,
      slug: found.slug,
      status: found.status,
      distributeToBoards: found.distributeToBoards,
      publishedAt: found.publishedAt,
    },
    organizationName: org?.name ?? null,
    careerPageSlug,
    canUseCareerPage: tierHasFeature(tier, 'careerPage'),
    feed: {
      eligible: ineligible === null,
      reason: ineligible?.reason ?? null,
      code: ineligible?.code ?? null,
      /** False for account-level blocks the recruiter can't resolve from this page. */
      fixable: ineligible?.fixable ?? true,
      expiresAt: ineligible === null ? feedValidThrough(found, postedAt) : null,
      boards: FEED_BOARDS.map(key => ({ key, label: FEED_BOARD_LABELS[key] })),
    },
    trackingLinks: links,
  }
})
