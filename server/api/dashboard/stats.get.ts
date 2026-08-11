import { eq, and, desc, sql, count, inArray, isNull } from 'drizzle-orm'
import { application, candidate, job } from '../../database/schema'

/**
 * GET /api/dashboard/stats
 * Returns aggregated dashboard data for the current organization:
 * - Summary counts (open jobs, candidates, applications, unviewed applicants)
 * - Pipeline breakdown (application count per status)
 * - Jobs breakdown (job count per status)
 * - Recent applications (last 10 with candidate + job info)
 * - Top active jobs (open jobs sorted by application count, top 5)
 * - Unanswered candidate replies (threads where the candidate spoke last)
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'], candidate: ['read'], application: ['read'] })
  const orgId = session.session.activeOrganizationId
  const activeCandidateIds = db.select({ id: candidate.id }).from(candidate).where(and(
    eq(candidate.organizationId, orgId),
    isNull(candidate.quarantinedAt),
  ))
  const activeApplicationCondition = and(
    eq(application.organizationId, orgId),
    inArray(application.candidateId, activeCandidateIds),
  )

  // ─────────────────────────────────────────────
  // Run all queries in parallel for performance
  // ─────────────────────────────────────────────
  const [
    openJobsCount,
    totalCandidatesCount,
    totalApplicationsCount,
    unviewedApplicationsCount,
    pipelineRows,
    jobStatusRows,
    recentApplications,
    topJobs,
    unansweredReplyList,
    unansweredReplyTotal,
  ] = await Promise.all([
    // 1. Open jobs count
    db.$count(job, and(eq(job.organizationId, orgId), eq(job.status, 'open'))),

    // 2. Total candidates
    db.$count(candidate, and(eq(candidate.organizationId, orgId), isNull(candidate.quarantinedAt))),

    // 3. Total applications
    db.$count(application, activeApplicationCondition),

    // 4. Applicants this user has never opened. Read receipts, not the `new`
    //    stage: a stack of applications someone has already read through isn't a
    //    to-do, and moving a candidate along the pipeline is a separate decision
    //    from having looked at them. Matches the per-job badges on /jobs.
    unviewedApplicationCount({ organizationId: orgId, userId: session.user.id }),

    // 5. Pipeline breakdown — application count per status
    db
      .select({
        status: application.status,
        count: count().as('count'),
      })
      .from(application)
      .where(activeApplicationCondition)
      .groupBy(application.status),

    // 6. Jobs by status
    db
      .select({
        status: job.status,
        count: count().as('count'),
      })
      .from(job)
      .where(eq(job.organizationId, orgId))
      .groupBy(job.status),

    // 7. Recent applications (last 10) with candidate + job details
    db
      .select({
        id: application.id,
        status: application.status,
        createdAt: application.createdAt,
        candidateId: application.candidateId,
        candidateFirstName: candidate.firstName,
        candidateLastName: candidate.lastName,
        candidateEmail: candidate.email,
        jobId: application.jobId,
        jobTitle: job.title,
      })
      .from(application)
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .where(and(eq(application.organizationId, orgId), isNull(candidate.quarantinedAt)))
      .orderBy(desc(application.createdAt))
      .limit(10),

    // 8. Top 5 active (open) jobs by total application count + per-status breakdown
    db
      .select({
        id: job.id,
        title: job.title,
        slug: job.slug,
        status: job.status,
        createdAt: job.createdAt,
        applicationCount: count(application.id).as('application_count'),
        newCount: sql<number>`count(case when ${application.status} = 'new' then 1 end)`.as('new_count'),
        screeningCount: sql<number>`count(case when ${application.status} = 'screening' then 1 end)`.as('screening_count'),
        interviewCount: sql<number>`count(case when ${application.status} = 'interview' then 1 end)`.as('interview_count'),
        offerCount: sql<number>`count(case when ${application.status} = 'offer' then 1 end)`.as('offer_count'),
        hiredCount: sql<number>`count(case when ${application.status} = 'hired' then 1 end)`.as('hired_count'),
        rejectedCount: sql<number>`count(case when ${application.status} = 'rejected' then 1 end)`.as('rejected_count'),
      })
      .from(job)
      .leftJoin(application, and(
        eq(application.jobId, job.id),
        inArray(application.candidateId, activeCandidateIds),
      ))
      .where(and(eq(job.organizationId, orgId), eq(job.status, 'open')))
      .groupBy(job.id)
      .orderBy(sql`count(${application.id}) desc`)
      .limit(5),

    // 9. Candidate replies still owed an answer — threads whose newest message
    //    is inbound. Not `unreadCount`: nothing clears that counter, so it can
    //    only grow. See server/utils/unansweredReplies.ts.
    unansweredReplies({ organizationId: orgId, limit: 5 }),

    // 10. Total waiting threads, so the card can say "+N more" honestly.
    unansweredReplyCount({ organizationId: orgId }),
  ])

  // ─────────────────────────────────────────────
  // Transform grouped rows into keyed objects
  // ─────────────────────────────────────────────
  const pipeline: Record<string, number> = {
    new: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    hired: 0,
    rejected: 0,
  }
  for (const row of pipelineRows) {
    pipeline[row.status] = row.count
  }

  const jobsByStatus: Record<string, number> = {
    draft: 0,
    open: 0,
    closed: 0,
    archived: 0,
  }
  for (const row of jobStatusRows) {
    jobsByStatus[row.status] = row.count
  }

  return {
    counts: {
      openJobs: openJobsCount,
      totalCandidates: totalCandidatesCount,
      totalApplications: totalApplicationsCount,
      unviewedApplications: unviewedApplicationsCount,
      unansweredReplies: unansweredReplyTotal,
    },
    pipeline,
    jobsByStatus,
    recentApplications,
    topJobs,
    unansweredReplies: unansweredReplyList,
  }
})
