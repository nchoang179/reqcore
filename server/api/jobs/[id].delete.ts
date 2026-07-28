import { eq, and, sql, inArray } from 'drizzle-orm'
import { job, candidate, application } from '../../database/schema'
import { idParamSchema } from '../../utils/schemas/job'
import { SAMPLE_APPLICANTS } from '../../../shared/sample-job'
import { eraseCandidates } from '../../utils/erasure'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['delete'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const [deleted] = await db.delete(job)
    .where(and(eq(job.id, id), eq(job.organizationId, orgId)))
    .returning({ id: job.id, isTest: job.isTest })

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // Applications cascade with the job, but candidates deliberately do not — a
  // real applicant belongs to the workspace, not to one role, and outliving a
  // closed job is the point. The walkthrough's fictional applicants are the one
  // case where that rule reads as a bug: deleting the test job left eight
  // @example.com people sitting in the candidates list forever.
  if (deleted.isTest) {
    await removeOrphanedSampleCandidates(orgId, session.user.id)
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'deleted',
    resourceType: 'job',
    resourceId: id,
  })

  setResponseStatus(event, 204)
  return null
})

/**
 * Erase the walkthrough's sample applicants once nothing points at them anymore.
 *
 * Two guards keep this off real data. The email allowlist comes from the fixture
 * itself, so only the people this codebase invented are eligible — an imported
 * candidate can never match. And the zero-application check means a sample
 * candidate the recruiter went on to attach to a real job stays put: they made
 * that record theirs.
 *
 * Cleanup failure is not worth failing the delete over. The job is already gone
 * and the request cannot be retried against it; leftover fixture rows are a
 * cosmetic problem, and the recruiter can still delete them by hand.
 */
async function removeOrphanedSampleCandidates(orgId: string, actorId: string) {
  const emails = SAMPLE_APPLICANTS.map(a => a.email)
  if (!emails.length) return

  try {
    const orphaned = await db
      .select({ id: candidate.id })
      .from(candidate)
      .leftJoin(application, eq(application.candidateId, candidate.id))
      .where(and(
        eq(candidate.organizationId, orgId),
        inArray(candidate.email, emails),
      ))
      .groupBy(candidate.id)
      .having(sql`count(${application.id}) = 0`)

    if (!orphaned.length) return

    // The shared erasure path rather than a bare delete: it takes the S3 objects
    // and the polymorphic rows (properties, comments) that a foreign key cannot.
    await eraseCandidates(orgId, orphaned.map(c => c.id), {
      actorId,
      auditMetadata: { source: 'test_job_deleted' },
    })
  } catch (err) {
    logError('sample_job.candidate_cleanup_failed', {
      org_id: orgId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
