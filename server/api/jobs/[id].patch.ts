import { eq, and } from 'drizzle-orm'
import { job } from '../../database/schema'
import { resolveDerivedLocation } from '../../../shared/job-location'
import { missingPublishRequirements } from '../../../shared/job-publish'
import { idParamSchema, updateJobSchema, JOB_STATUS_TRANSITIONS } from '../../utils/schemas/job'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, updateJobSchema.parse)

  // Fetch existing job — needed for the status transition check, slug
  // regeneration, and the publish guard. The description and location columns
  // are read because a PATCH that only flips status has to be judged against
  // stored values.
  const existing = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: {
      status: true,
      title: true,
      slug: true,
      publishedAt: true,
      description: true,
      locationCity: true,
      locationRegion: true,
      locationCountry: true,
      remoteStatus: true,
      validThrough: true,
      isTest: true,
    },
  })

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // Validate status transition if status is being changed
  if (body.status) {
    const allowed = JOB_STATUS_TRANSITIONS[existing.status] ?? []
    if (!allowed.includes(body.status)) {
      throw createError({
        statusCode: 422,
        statusMessage: `Cannot transition from '${existing.status}' to '${body.status}'`,
      })
    }

    // Re-opening a role counts against the plan's active-role limit — except a
    // test role, which is exempt on create for the same reason and is capped at
    // one per org, so re-opening it cannot be used to dodge the cap.
    if (body.status === 'open' && existing.status !== 'open' && !existing.isTest) {
      await assertActiveRoleLimit(orgId)
    }
  }

  // Merge the patch over stored values before judging the result: a PATCH that
  // only sets `status: 'open'` still has to be checked against the location
  // already on the record.
  const merged = {
    description: body.description === undefined ? existing.description : body.description,
    locationCity: body.locationCity === undefined ? existing.locationCity : body.locationCity,
    locationRegion: body.locationRegion === undefined ? existing.locationRegion : body.locationRegion,
    locationCountry: body.locationCountry === undefined ? existing.locationCountry : body.locationCountry,
    remoteStatus: body.remoteStatus === undefined ? existing.remoteStatus : body.remoteStatus,
    validThrough: body.validThrough === undefined ? existing.validThrough : body.validThrough,
  }

  // A role going live has to meet every board requirement. One already live is
  // only held to the ones this edit touches: roles opened before these rules
  // existed must stay editable, but an edit may not make a live role worse.
  //
  // A test role is held to none of them — it never reaches a board, so the
  // feed's completeness rules are meaningless for it, exactly as on create.
  if ((body.status ?? existing.status) === 'open' && !existing.isTest) {
    const isOpening = body.status === 'open' && existing.status !== 'open'
    const changed = {
      // Trimmed, so re-saving an untrimmed legacy description is not read as an
      // edit and does not block a save that changed nothing.
      description: (merged.description ?? '').trim() !== (existing.description ?? '').trim(),
      locationCountry: merged.locationCountry !== existing.locationCountry
        || merged.remoteStatus !== existing.remoteStatus,
      validThrough: merged.validThrough?.getTime() !== existing.validThrough?.getTime(),
    }
    const blocking = missingPublishRequirements(merged)
      .filter(requirement => isOpening || changed[requirement.field])

    if (blocking[0]) {
      throw createError({
        statusCode: 422,
        statusMessage: blocking[0].reason,
        data: { code: blocking[0].code, field: blocking[0].field },
      })
    }
  }

  const updates: Record<string, unknown> = { ...body, updatedAt: new Date() }
  delete (updates as any).slug // remove raw slug from spread — we set it explicitly below

  // Keep the free-text display string derived from the structured parts
  // whenever either side is touched, so the two can never drift apart. Writes
  // nothing for a job that has no structured place and isn't being given one —
  // see `resolveDerivedLocation` for why that case has to be left alone.
  Object.assign(updates, resolveDerivedLocation(existing, body))

  // Slug changes are deliberate only — a title edit on a published job must not
  // move its public URL, because every indexed, reposted and emailed link to it
  // would hard-404 (there is no slug history to redirect from).
  const nextSlug = resolveJobSlugUpdate({
    id,
    publishedAt: existing.publishedAt,
    currentTitle: existing.title,
    newTitle: body.title,
    customSlug: body.slug,
  })

  // Stamp the first time this role goes public. Guarded on `publishedAt` being
  // null rather than on the previous status, so closing and re-opening a role
  // keeps its original posting age instead of presenting it to boards as new.
  if (body.status === 'open' && !existing.publishedAt) {
    updates.publishedAt = new Date()
  }

  const applyUpdate = async (slug: string | undefined) => {
    const [row] = await db.update(job)
      .set(slug ? { ...updates, slug } : updates)
      .where(and(eq(job.id, id), eq(job.organizationId, orgId)))
      .returning({
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
        analysisContext: job.analysisContext,
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
    return row
  }

  // `job.slug` is unique across every org, and the suffix is only 32 bits — a
  // rename can land on one already taken. Retry once with a fresh suffix rather
  // than failing the whole save with a bare 500.
  const updated = await applyUpdate(nextSlug).catch((error) => {
    if (nextSlug && isDuplicateJobSlugError(error)) {
      return applyUpdate(generateJobSlug(body.title ?? existing.title, crypto.randomUUID(), body.slug))
    }
    throw error
  })

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: body.status && body.status !== existing.status ? 'status_changed' : 'updated',
    resourceType: 'job',
    resourceId: id,
    metadata: body.status && body.status !== existing.status
      ? { from: existing.status, to: body.status }
      : { title: updated.title },
  })

  if (body.status && body.status !== existing.status) {
    trackEvent(event, session, 'job status_changed', {
      job_id: id,
      from_status: existing.status,
      to_status: body.status,
    })

    logApiRequest(event, session, 'job.status_changed', {
      job_id: id,
      from_status: existing.status,
      to_status: body.status,
    })
  }

  return updated
})
