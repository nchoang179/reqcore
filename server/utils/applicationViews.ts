import { and, eq, inArray, isNull, ne, notInArray, count, sql } from 'drizzle-orm'
import { application, applicationView, candidate } from '../database/schema'

/**
 * Log that a member opened an application. Idempotent per (application, user):
 * the first open inserts, later ones bump `viewedAt`.
 *
 * Fire-and-forget like recordActivity — a read receipt must never be the reason
 * a recruiter can't open a candidate.
 */
export async function recordApplicationView(params: {
  organizationId: string
  applicationId: string
  userId: string
}): Promise<void> {
  try {
    await db
      .insert(applicationView)
      .values({
        organizationId: params.organizationId,
        applicationId: params.applicationId,
        userId: params.userId,
      })
      .onConflictDoUpdate({
        target: [applicationView.applicationId, applicationView.userId],
        // Database clock, matching the `defaultNow()` used on insert — a JS
        // `Date` here would make re-opens land in a different time zone than
        // first opens.
        set: { viewedAt: sql`now()` },
      })
  }
  catch (err) {
    logWarn('application_view.record_failed', {
      org_id: params.organizationId,
      application_id: params.applicationId,
      error_message: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * When each of `applicationIds` was last opened by `userId`. Ids the user has
 * never opened are absent from the map.
 */
export async function viewedAtByApplication(params: {
  userId: string
  applicationIds: string[]
}): Promise<Map<string, Date>> {
  if (params.applicationIds.length === 0) return new Map()
  const rows = await db
    .select({ applicationId: applicationView.applicationId, viewedAt: applicationView.viewedAt })
    .from(applicationView)
    .where(and(
      eq(applicationView.userId, params.userId),
      inArray(applicationView.applicationId, params.applicationIds),
    ))
  return new Map(rows.map(row => [row.applicationId, row.viewedAt]))
}

/**
 * Per-job count of applications this user has never opened.
 *
 * Rejected applications are excluded: they've been decided on, so they aren't
 * work waiting for anyone — counting them would leave a permanent badge on
 * every job with a rejection. Quarantined candidates are excluded for the same
 * reason the pipeline counts exclude them (they aren't shown anywhere).
 *
 * Jobs with nothing unviewed are absent from the map.
 */
export async function unviewedCountsByJob(params: {
  organizationId: string
  userId: string
  jobIds: string[]
}): Promise<Map<string, number>> {
  if (params.jobIds.length === 0) return new Map()

  const viewedApplicationIds = db
    .select({ applicationId: applicationView.applicationId })
    .from(applicationView)
    .where(and(
      eq(applicationView.organizationId, params.organizationId),
      eq(applicationView.userId, params.userId),
    ))

  const activeCandidateIds = db
    .select({ id: candidate.id })
    .from(candidate)
    .where(and(
      eq(candidate.organizationId, params.organizationId),
      isNull(candidate.quarantinedAt),
    ))

  const rows = await db
    .select({ jobId: application.jobId, count: count() })
    .from(application)
    .where(and(
      eq(application.organizationId, params.organizationId),
      inArray(application.jobId, params.jobIds),
      inArray(application.candidateId, activeCandidateIds),
      ne(application.status, 'rejected'),
      notInArray(application.id, viewedApplicationIds),
    ))
    .groupBy(application.jobId)

  return new Map(rows.map(row => [row.jobId, Number(row.count)]))
}
