import { job, jobQuestion, scoringCriterion } from '../../database/schema'
import { createJobWizardSchema } from '../../utils/schemas/job'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createJobWizardSchema.parse)

  // Opening a role counts against the plan's active-role limit.
  if (body.status === 'open') {
    await assertActiveRoleLimit(orgId)
  }

  // Generate a deterministic ID upfront so we can build the slug
  const jobId = crypto.randomUUID()
  const slug = generateJobSlug(body.title, jobId, body.slug)

  const created = await db.transaction(async (tx) => {
    const [createdJob] = await tx.insert(job).values({
      id: jobId,
      organizationId: orgId,
      title: body.title,
      slug,
      description: body.description,
      location: body.location,
      type: body.type,
      status: body.status,
      salaryMin: body.salaryMin,
      salaryMax: body.salaryMax,
      salaryCurrency: body.salaryCurrency,
      salaryUnit: body.salaryUnit,
      salaryNegotiable: body.salaryNegotiable,
      remoteStatus: body.remoteStatus,
      validThrough: body.validThrough,
      phoneRequirement: body.phoneRequirement,
      requireResume: body.requireResume,
      requireCoverLetter: body.requireCoverLetter,
      autoScoreOnApply: body.autoScoreOnApply,
      experienceLevel: body.experienceLevel,
      locationCity: body.locationCity,
      locationRegion: body.locationRegion,
      locationCountry: body.locationCountry,
      department: body.department,
      distributeToBoards: body.distributeToBoards,
      // Created straight into `open` — this is the moment it goes public.
      publishedAt: body.status === 'open' ? new Date() : null,
    }).returning({
      id: job.id,
      title: job.title,
      slug: job.slug,
      description: job.description,
      location: job.location,
      type: job.type,
      status: job.status,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryCurrency: job.salaryCurrency,
      salaryUnit: job.salaryUnit,
      salaryNegotiable: job.salaryNegotiable,
      remoteStatus: job.remoteStatus,
      validThrough: job.validThrough,
      phoneRequirement: job.phoneRequirement,
      requireResume: job.requireResume,
      requireCoverLetter: job.requireCoverLetter,
      autoScoreOnApply: job.autoScoreOnApply,
      experienceLevel: job.experienceLevel,
      locationCity: job.locationCity,
      locationRegion: job.locationRegion,
      locationCountry: job.locationCountry,
      department: job.department,
      distributeToBoards: job.distributeToBoards,
      publishedAt: job.publishedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })

    if (!createdJob) {
      throw createError({ statusCode: 500, statusMessage: 'Failed to create job' })
    }

    if (body.questions.length) {
      await tx.insert(jobQuestion).values(body.questions.map((question, index) => ({
        organizationId: orgId,
        jobId,
        type: question.type,
        label: question.label,
        description: question.description,
        required: question.required,
        options: question.options,
        displayOrder: index,
      })))
    }

    if (body.criteria.length) {
      await tx.insert(scoringCriterion).values(body.criteria.map((criterion, index) => ({
        organizationId: orgId,
        jobId,
        key: criterion.key,
        name: criterion.name,
        description: criterion.description ?? null,
        category: criterion.category,
        maxScore: criterion.maxScore,
        weight: criterion.weight,
        displayOrder: index,
      })))
    }

    return createdJob
  })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to create job' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'job',
    resourceId: created.id,
    metadata: { title: created.title },
  })

  trackEvent(event, session, 'job created', {
    job_id: created.id,
    job_type: created.type,
    has_salary: !!(created.salaryMin || created.salaryMax),
    require_resume: created.requireResume,
    auto_score: created.autoScoreOnApply,
  })

  logApiRequest(event, session, 'job.created', {
    job_id: created.id,
    job_type: created.type,
    has_salary: !!(created.salaryMin || created.salaryMax),
    require_resume: created.requireResume,
    auto_score: created.autoScoreOnApply,
  })

  setResponseStatus(event, 201)
  return created
})
