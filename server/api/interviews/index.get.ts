import { and, asc, count, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { interview, application, candidate, job } from '../../database/schema'
import { interviewQuerySchema } from '../../utils/schemas/interview'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { interview: ['read'] })
  const orgId = session.session.activeOrganizationId

  const query = await getValidatedQuery(event, interviewQuerySchema.parse)

  const conditions = [
    eq(interview.organizationId, orgId),
    isNull(candidate.quarantinedAt),
  ]

  if (query.applicationId) {
    conditions.push(eq(interview.applicationId, query.applicationId))
  }
  if (query.jobId) {
    conditions.push(eq(application.jobId, query.jobId))
  }
  if (query.status) {
    conditions.push(eq(interview.status, query.status))
  }
  if (query.from) {
    conditions.push(gte(interview.scheduledAt, new Date(query.from)))
  }
  if (query.to) {
    conditions.push(lte(interview.scheduledAt, new Date(query.to)))
  }

  const whereClause = and(...conditions)
  const orderBy = query.order === 'scheduled_first'
    ? [
        sql`CASE WHEN ${interview.status} = 'scheduled' THEN 0 ELSE 1 END`,
        sql`CASE WHEN ${interview.status} = 'scheduled' THEN ${interview.scheduledAt} END ASC`,
        sql`CASE WHEN ${interview.status} <> 'scheduled' THEN ${interview.scheduledAt} END DESC`,
      ]
    : [query.order === 'asc' ? asc(interview.scheduledAt) : desc(interview.scheduledAt)]

  const [data, total] = await Promise.all([
    db
      .select({
        id: interview.id,
        title: interview.title,
        type: interview.type,
        status: interview.status,
        scheduledAt: interview.scheduledAt,
        duration: interview.duration,
        location: interview.location,
        notes: interview.notes,
        personalNote: interview.personalNote,
        interviewers: interview.interviewers,
        invitationSentAt: interview.invitationSentAt,
        candidateResponse: interview.candidateResponse,
        candidateRespondedAt: interview.candidateRespondedAt,
        googleCalendarEventId: interview.googleCalendarEventId,
        googleCalendarEventLink: interview.googleCalendarEventLink,
        timezone: interview.timezone,
        createdAt: interview.createdAt,
        updatedAt: interview.updatedAt,
        applicationId: interview.applicationId,
        candidateFirstName: candidate.firstName,
        candidateLastName: candidate.lastName,
        candidateEmail: candidate.email,
        jobId: application.jobId,
        jobTitle: job.title,
      })
      .from(interview)
      .innerJoin(application, eq(application.id, interview.applicationId))
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
    db
      .select({ count: count() })
      .from(interview)
      .innerJoin(application, eq(application.id, interview.applicationId))
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .where(whereClause)
      .then(rows => rows[0]?.count ?? 0),
  ])

  return { data, total, page: query.page, limit: query.limit }
})
