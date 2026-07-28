import { eq, and, inArray, isNull } from 'drizzle-orm'
import { application, candidate, job } from '../../database/schema'
import { idParamSchema } from '../../utils/schemas/job'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const activeCandidateIds = db.select({ id: candidate.id }).from(candidate).where(and(
    eq(candidate.organizationId, orgId),
    isNull(candidate.quarantinedAt),
  ))

  const result = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: {
      id: true,
      title: true,
      slug: true,
      description: true,
      location: true,
      type: true,
      status: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryUnit: true,
      salaryNegotiable: true,
      remoteStatus: true,
      validThrough: true,
      phoneRequirement: true,
      requireResume: true,
      requireCoverLetter: true,
      autoScoreOnApply: true,
      analysisContext: true,
      experienceLevel: true,
      locationCity: true,
      locationRegion: true,
      locationCountry: true,
      locationPostalCode: true,
      department: true,
      distributeToBoards: true,
      createdAt: true,
      updatedAt: true,
    },
    with: {
      applications: {
        columns: { id: true, candidateId: true, status: true, createdAt: true },
        where: inArray(application.candidateId, activeCandidateIds),
        limit: 100,
      },
    },
  })

  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  return result
})
