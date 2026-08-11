import { job, jobQuestion, scoringCriterion } from '../../database/schema'
import { formatJobLocation } from '../../../shared/job-location'
import { createJobWizardSchema } from '../../utils/schemas/job'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createJobWizardSchema.parse)

  // Opening a role counts against the plan's active-role limit, and puts it in
  // front of the job boards — so it has to be complete enough for them.
  //
  // Neither applies to a test role. It never reaches a board, so the feed's
  // completeness rules are meaningless for it, and charging it against the
  // active-role cap would mean a free workspace spends its only slot on the
  // walkthrough — turning "try it out" into a paywall.
  //
  // `isTest` is client-controlled, so the exemption is capped at one test role
  // per org — otherwise it is just a way to open unlimited free roles.
  if (body.isTest) {
    await assertTestRoleLimit(orgId)
  }
  else if (body.status === 'open') {
    await assertActiveRoleLimit(orgId)
    assertPublishable(body)
  }

  // The display string is always derived from the structured parts, so a direct
  // API caller cannot desync the two. Anything they sent as `location` is only
  // kept when there is nothing structured to derive from.
  const location = body.locationCountry
    ? formatJobLocation({ city: body.locationCity, region: body.locationRegion, country: body.locationCountry })
    : body.location

  // Generate a deterministic ID upfront so we can build the slug
  const jobId = crypto.randomUUID()

  const insertJob = (slug: string) => db.transaction(async (tx) => {
    const [createdJob] = await tx.insert(job).values({
      id: jobId,
      organizationId: orgId,
      title: body.title,
      slug,
      description: body.description,
      location,
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
      // Dropped without a country: a bare postal code is unplaceable, and
      // sending one to a board only mis-pins the listing.
      locationPostalCode: body.locationCountry ? body.locationPostalCode : null,
      department: body.department,
      distributeToBoards: body.distributeToBoards,
      isTest: body.isTest,
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
      locationPostalCode: job.locationPostalCode,
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

  const created = await insertJob(generateJobSlug(body.title, jobId, body.slug)).catch(async (error) => {
    // `job.slug` is unique across every org and the suffix is only 32 bits of
    // the id, so two orgs reposting the same title can draw the same one. A
    // second attempt with a fresh suffix beats a bare 500 on job creation — the
    // job id itself is untouched, only the slug's random half is redrawn.
    if (isDuplicateJobSlugError(error)) {
      return insertJob(generateJobSlug(body.title, crypto.randomUUID(), body.slug))
    }
    // Lost a race with a concurrent create: the one-test-role-per-org index
    // refused this one. Re-running the check gives the loser the same 409 the
    // first caller's pre-check would have, rather than a 500.
    if (isDuplicateTestRoleError(error)) await assertTestRoleLimit(orgId)
    throw error
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

  // Ends the "signed up, never opened a role" wait in Resend. `isTest` rides
  // along rather than gating the emit: a test role is a real step forward and
  // should stop the generic nudge, but it is not the same as opening a live
  // role, and which of those two the automation treats as activation is a copy
  // decision — so it belongs in the automation's condition, not in this file.
  emitLifecycleEventInBackground({
    event: LIFECYCLE_EVENTS.jobPosted,
    email: session.user.email,
    organizationId: orgId,
    payload: {
      jobId: created.id,
      jobTitle: created.title,
      isTest: body.isTest,
      status: created.status,
      firstName: session.user.name?.split(' ')[0] ?? null,
    },
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
