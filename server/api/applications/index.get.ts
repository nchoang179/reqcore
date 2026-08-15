import { asc, eq, and, desc, inArray, notInArray, or, ilike, gte, lt, isNull, count, sql } from 'drizzle-orm'
import { application, applicationStatusEnum, applicationView, candidate, interview, job } from '../../database/schema'
import { applicationQuerySchema } from '../../utils/schemas/application'
import { propertyFiltersArraySchema } from '../../utils/schemas/property'
import {
  entityIdsMatchingFilters,
  loadPropertyEntriesForEntities,
  type PropertyFilter,
} from '../../utils/properties'

type StatusCountRow = { status: (typeof applicationStatusEnum.enumValues)[number], count: number }

function tallyStatusCounts(rows: StatusCountRow[]) {
  const counts = { new: 0, screening: 0, interview: 0, offer: 0, hired: 0, rejected: 0 }
  for (const row of rows) {
    counts[row.status] = Number(row.count)
  }
  return counts
}

/**
 * GET /api/applications
 * List applications for the current organization.
 * Filterable by jobId, candidateId, status, and custom property filters. Paginated.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const query = await getValidatedQuery(event, applicationQuerySchema.parse)

  const offset = (query.page - 1) * query.limit
  const conditions = [
    eq(application.organizationId, orgId),
    isNull(candidate.quarantinedAt),
  ]

  if (query.jobId) {
    conditions.push(eq(application.jobId, query.jobId))
  }
  if (query.candidateId) {
    conditions.push(eq(application.candidateId, query.candidateId))
  }
  if (query.status) {
    conditions.push(eq(application.status, query.status))
  }
  if (query.search) {
    // Escape LIKE meta-characters to keep this a literal substring search.
    const escaped = query.search.replace(/[%_\\]/g, '\\$&')
    const pattern = `%${escaped}%`
    conditions.push(or(
      ilike(candidate.firstName, pattern),
      ilike(candidate.lastName, pattern),
      ilike(sql`${candidate.firstName} || ' ' || ${candidate.lastName}`, pattern),
      ilike(candidate.email, pattern),
    )!)
  }
  if (query.score) {
    switch (query.score) {
      case 'high':
        conditions.push(gte(application.score, 75))
        break
      case 'medium':
        conditions.push(and(gte(application.score, 40), lt(application.score, 75))!)
        break
      case 'low':
        conditions.push(lt(application.score, 40))
        break
      case 'none':
        conditions.push(isNull(application.score))
        break
    }
  }
  if (query.interview) {
    const interviewApplicationIds = db
      .select({ applicationId: interview.applicationId })
      .from(interview)
      .where(eq(interview.organizationId, orgId))
    conditions.push(
      query.interview === 'has-interview'
        ? inArray(application.id, interviewApplicationIds)
        : notInArray(application.id, interviewApplicationIds),
    )
  }
  if (query.viewed === 'unviewed') {
    // Reuses the dashboard's definition of unviewed (rejected excluded) so the
    // "to review" tile and the list it links to can't report different numbers.
    conditions.push(unviewedApplicationCondition({ organizationId: orgId, userId: session.user.id }))
  }
  else if (query.viewed === 'viewed') {
    conditions.push(inArray(
      application.id,
      db
        .select({ applicationId: applicationView.applicationId })
        .from(applicationView)
        .where(and(
          eq(applicationView.organizationId, orgId),
          eq(applicationView.userId, session.user.id),
        )),
    ))
  }

  // ── Custom property filters ──
  let propertyFilters: PropertyFilter[] = []
  if (query.propertyFilters) {
    let raw: unknown
    try {
      raw = JSON.parse(query.propertyFilters)
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Invalid propertyFilters' })
    }
    const result = propertyFiltersArraySchema.safeParse(raw)
    if (!result.success) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid propertyFilters' })
    }
    propertyFilters = result.data as PropertyFilter[]
  }

  // Job-wide per-status totals for the pipeline tab badges. Intentionally ignores
  // every active filter so the badges stay put as the user narrows the list.
  const statusCountsPromise: Promise<StatusCountRow[]> = query.jobId
    ? db
        .select({ status: application.status, count: count() })
        .from(application)
        .innerJoin(candidate, eq(candidate.id, application.candidateId))
        .where(and(
          eq(application.organizationId, orgId),
          eq(application.jobId, query.jobId),
          isNull(candidate.quarantinedAt),
        ))
        .groupBy(application.status)
    : Promise.resolve([])

  if (propertyFilters.length > 0) {
    // Awaited together so a failing filter query doesn't leave the counts
    // promise rejecting unobserved.
    const [matching, statusCountRows] = await Promise.all([
      entityIdsMatchingFilters({
        organizationId: orgId,
        entityType: 'application',
        filters: propertyFilters,
      }),
      statusCountsPromise,
    ])
    if (!matching || matching.size === 0) {
      return {
        data: [],
        total: 0,
        page: query.page,
        limit: query.limit,
        statusCounts: tallyStatusCounts(statusCountRows),
      }
    }
    conditions.push(inArray(application.id, [...matching]))
  }

  const where = and(...conditions)

  const orderBy = (() => {
    switch (query.sort) {
      case 'date-asc': return [asc(application.createdAt)] as const
      case 'name-asc': return [asc(candidate.firstName), asc(candidate.lastName)] as const
      case 'name-desc': return [desc(candidate.firstName), desc(candidate.lastName)] as const
      case 'score-desc': return [sql`${application.score} DESC NULLS LAST`, desc(application.createdAt)] as const
      case 'score-asc': return [sql`COALESCE(${application.score}, -1) ASC`, desc(application.createdAt)] as const
      case 'updated-desc': return [desc(application.updatedAt)] as const
      default: return [desc(application.createdAt)] as const
    }
  })()

  const [data, totalRows, statusCountRows] = await Promise.all([
    db
      .select({
        id: application.id,
        status: application.status,
        score: application.score,
        notes: application.notes,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        candidateId: application.candidateId,
        candidateFirstName: candidate.firstName,
        candidateLastName: candidate.lastName,
        candidateEmail: candidate.email,
        jobId: application.jobId,
        jobTitle: job.title,
        jobStatus: job.status,
      })
      .from(application)
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .where(where)
      .orderBy(...orderBy)
      .limit(query.limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(application)
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .where(where),
    statusCountsPromise,
  ])

  const statusCounts = tallyStatusCounts(statusCountRows)

  // Bulk-attach properties for the current page (org-global + per-job)
  const ids = data.map((a) => a.id)
  const jobIds = [...new Set(data.map((a) => a.jobId))]
  const entityJobIds = new Map(data.map((a) => [a.id, a.jobId] as const))
  const propertyMap = await loadPropertyEntriesForEntities({
    organizationId: orgId,
    entityType: 'application',
    entityIds: ids,
    jobIds,
    entityJobIds,
  })
  const interviewedApplicationIds = ids.length > 0
    ? await db
        .selectDistinct({ applicationId: interview.applicationId })
        .from(interview)
        .where(and(eq(interview.organizationId, orgId), inArray(interview.applicationId, ids)))
    : []
  const interviewedIds = new Set(interviewedApplicationIds.map(row => row.applicationId))
  // Read receipts for the signed-in user only — "viewed" is personal, so a
  // colleague's review doesn't clear the marker off your list.
  const viewedAt = await viewedAtByApplication({ userId: session.user.id, applicationIds: ids })
  const enriched = data.map((a) => ({
    ...a,
    properties: propertyMap.get(a.id) ?? [],
    hasInterview: interviewedIds.has(a.id),
    viewedAt: viewedAt.get(a.id) ?? null,
  }))

  return {
    data: enriched,
    total: Number(totalRows[0]?.count ?? 0),
    page: query.page,
    limit: query.limit,
    statusCounts,
  }
})
