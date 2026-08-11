import { and, eq, inArray, isNull, ne, notInArray, count, sql } from 'drizzle-orm'
import { application, applicationView, candidate } from '../database/schema'
import { isDemoOrgId } from './demoOrg'

/**
 * Log that a member opened an application. Idempotent per (application, user):
 * the first open inserts, later ones bump `viewedAt`.
 *
 * Fire-and-forget like recordActivity — a read receipt must never be the reason
 * a recruiter can't open a candidate.
 *
 * Skipped entirely for the demo org. The receipt is written from a GET, so
 * `demo-guard` (which only inspects write verbs) never sees it — without this
 * the read-only demo would still accumulate rows. Skipping also keeps the
 * feature demonstrable: every visitor shares `demo@reqcore.com`, so a stored
 * receipt would mark a candidate read for everyone who came after. Returning
 * silently is deliberate — the demo must not surface a read-only error for
 * something the visitor didn't ask for.
 */
export async function recordApplicationView(params: {
  organizationId: string
  applicationId: string
  userId: string
}): Promise<void> {
  // A failed demo lookup must not disable receipts for real orgs, so an error
  // here falls through to recording as normal.
  let isDemo = false
  try {
    isDemo = await isDemoOrgId(params.organizationId)
  }
  catch {
    isDemo = false
  }
  if (isDemo) return

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
 * The applications that still count as unviewed work for `userId`.
 *
 * Rejected applications are excluded: they've been decided on, so they aren't
 * work waiting for anyone — counting them would leave a permanent badge on
 * every job with a rejection. Quarantined candidates are excluded for the same
 * reason the pipeline counts exclude them (they aren't shown anywhere).
 *
 * Shared by the per-job badges and the dashboard total so the two can never
 * disagree about what "unviewed" means.
 */
export function unviewedApplicationCondition(params: {
  organizationId: string
  userId: string
}) {
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

  return and(
    eq(application.organizationId, params.organizationId),
    inArray(application.candidateId, activeCandidateIds),
    ne(application.status, 'rejected'),
    notInArray(application.id, viewedApplicationIds),
  )!
}

/**
 * Per-job count of applications this user has never opened.
 *
 * Jobs with nothing unviewed are absent from the map.
 */
export async function unviewedCountsByJob(params: {
  organizationId: string
  userId: string
  jobIds: string[]
}): Promise<Map<string, number>> {
  if (params.jobIds.length === 0) return new Map()

  const rows = await db
    .select({ jobId: application.jobId, count: count() })
    .from(application)
    .where(and(
      unviewedApplicationCondition(params),
      inArray(application.jobId, params.jobIds),
    ))
    .groupBy(application.jobId)

  return new Map(rows.map(row => [row.jobId, Number(row.count)]))
}

/**
 * Org-wide count of applications this user has never opened — the dashboard's
 * "to review" number.
 *
 * Deliberately not scoped to open jobs: an applicant nobody has looked at is
 * still waiting on you even if the job was since closed, and hiding them behind
 * a job-status filter is how people go unanswered.
 */
export async function unviewedApplicationCount(params: {
  organizationId: string
  userId: string
}): Promise<number> {
  return db.$count(application, unviewedApplicationCondition(params))
}
