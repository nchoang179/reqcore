import { eq, and, desc, isNotNull, max } from 'drizzle-orm'
import { job, organization, careerPage, trackingLink, member, user, feedFetch } from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'
import { tierHasFeature } from '../../../../shared/billing'
import { resolveOrgPlanId } from '../../../utils/billing/plan'
import {
  checkFeedEligibility,
  feedValidThrough,
  boardDeliveryState,
  isFeedBoard,
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
      isTest: true,
      publishedAt: true,
      createdAt: true,
      lastIncludedInFeedAt: true,
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

  // ── Per-board delivery ──
  //
  // Newest tagged fetch per board: seven rows at most, and the composite index
  // on (board, fetched_at desc) answers it without touching the history.
  //
  // Only computed for a job the feed would actually carry. When it wouldn't,
  // `feed.reason` is the whole answer, and listing boards underneath it would
  // invite reading delivery history as a claim about a job going nowhere.
  const deliveries: Array<{
    board: string
    label: string
    state: string
    lastFetchedAt: Date | null
  }> = []

  if (ineligible === null) {
    const rows = await db
      .select({ board: feedFetch.board, lastFetchedAt: max(feedFetch.fetchedAt) })
      .from(feedFetch)
      .where(isNotNull(feedFetch.board))
      .groupBy(feedFetch.board)

    const lastFetchByBoard = new Map<string, Date>()
    for (const row of rows) {
      // A `board` value that is no longer a known feed board — a renamed or
      // dropped aggregator still in someone's crawler config — has no row to
      // attach to and is left out rather than shown as an unlabelled channel.
      if (row.board && row.lastFetchedAt && isFeedBoard(row.board)) {
        lastFetchByBoard.set(row.board, row.lastFetchedAt)
      }
    }

    for (const board of FEED_BOARDS) {
      const lastFetchedAt = lastFetchByBoard.get(board) ?? null
      deliveries.push({
        board,
        label: FEED_BOARD_LABELS[board],
        state: boardDeliveryState({
          lastFetchedAt,
          lastIncludedInFeedAt: found.lastIncludedInFeedAt,
          eligibleSince: postedAt,
        }),
        lastFetchedAt,
      })
    }
  }

  return {
    job: {
      id: found.id,
      title: found.title,
      slug: found.slug,
      status: found.status,
      distributeToBoards: found.distributeToBoards,
      /** Drives whether the syndication toggle is offered — see `test_job` below. */
      isTest: found.isTest,
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
      /** Empty when the job is ineligible — see the note above. */
      deliveries,
      /** Null until a board has pulled a feed carrying this job. */
      lastIncludedInFeedAt: found.lastIncludedInFeedAt,
    },
    trackingLinks: links,
  }
})
