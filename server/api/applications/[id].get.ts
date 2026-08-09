import { eq, and, inArray, isNull } from 'drizzle-orm'
import { application, candidate } from '../../database/schema'
import { applicationIdParamSchema } from '../../utils/schemas/application'
import { loadPropertyEntriesForEntity } from '../../utils/properties'

/**
 * GET /api/applications/:id
 * Single application detail with related candidate, job, and question responses.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  const activeCandidateIds = db.select({ id: candidate.id }).from(candidate).where(and(
    eq(candidate.organizationId, orgId),
    isNull(candidate.quarantinedAt),
  ))

  const result = await db.query.application.findFirst({
    where: and(
      eq(application.id, id),
      eq(application.organizationId, orgId),
      inArray(application.candidateId, activeCandidateIds),
    ),
    with: {
      candidate: {
        columns: { id: true, firstName: true, lastName: true, email: true, phone: true },
        with: {
          documents: {
            columns: {
              id: true,
              type: true,
              originalFilename: true,
              mimeType: true,
              createdAt: true,
            },
            orderBy: (document, { desc }) => [desc(document.createdAt)],
          },
        },
      },
      job: {
        columns: { id: true, title: true, status: true, slug: true },
      },
      responses: {
        with: {
          question: {
            columns: { id: true, label: true, type: true, options: true },
          },
        },
        orderBy: (r, { asc }) => [asc(r.createdAt)],
      },
    },
  })

  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const properties = await loadPropertyEntriesForEntity({
    organizationId: orgId,
    entityType: 'application',
    entityId: result.id,
    jobId: result.jobId,
  })

  // Opening the detail is what "viewing an applicant" means, and every surface
  // (pipeline, table drawer, full page) goes through here — so the receipt is
  // logged once, server-side, instead of at each call site.
  await recordApplicationView({
    organizationId: orgId,
    applicationId: result.id,
    userId: session.user.id,
  })

  return { ...result, properties }
})
