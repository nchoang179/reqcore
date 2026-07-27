import { eq, and } from 'drizzle-orm'
import { job } from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'
import { generateShareCopy } from '../../../utils/ai/shareCopy'
import { resolveAnalysisProvider } from '../../../utils/ai/resolveProvider'
import { assertPlatformBudget, BudgetExceededError, budgetErrorToHttp } from '../../../utils/ai/budget'
import { computeCostUsdMicros } from '../../../utils/ai/pricing'
import { captureAiGeneration } from '../../../utils/ai/observability'
import { createRateLimiter } from '../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 6,
  message: 'Too many share copy requests. Please wait before retrying.',
})

/**
 * POST /api/jobs/:id/share-copy
 * Generate per-channel social copy for a job and cache it on the job row.
 * Returns the cached copy unmodified unless `regenerate` is set, so opening
 * the Promote tab repeatedly costs nothing.
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readBody<{ regenerate?: boolean }>(event).catch((): { regenerate?: boolean } => ({}))

  const found = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: {
      id: true,
      title: true,
      description: true,
      location: true,
      remoteStatus: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryUnit: true,
      salaryNegotiable: true,
      shareCopy: true,
    },
    with: { organization: { columns: { name: true } } },
  })

  if (!found) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }

  if (found.shareCopy && !body?.regenerate) {
    return { ...found.shareCopy, source: 'cache' as const }
  }

  if (!found.description) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Add a job description first — the share posts are written from it.',
    })
  }

  const resolved = await resolveAnalysisProvider(orgId)

  if (resolved.billingMode === 'platform') {
    try {
      await assertPlatformBudget(orgId)
    } catch (err) {
      if (err instanceof BudgetExceededError) throw budgetErrorToHttp(err)
      throw createError({ statusCode: 503, statusMessage: 'AI budget check failed. Please try again later.' })
    }
  }

  // Only stated as a fact to the model when it's a figure we'd show publicly —
  // a negotiable range is hidden on the job page, so it must not leak into a
  // social post either.
  const salaryHint = !found.salaryNegotiable && (found.salaryMin || found.salaryMax)
    ? [found.salaryMin, found.salaryMax].filter(Boolean).join('–')
      + ` ${found.salaryCurrency || 'USD'} per ${(found.salaryUnit || 'YEAR').toLowerCase()}`
    : null

  const startedAt = Date.now()
  let result: Awaited<ReturnType<typeof generateShareCopy>>

  try {
    result = await generateShareCopy(resolved.providerConfig, {
      jobTitle: found.title,
      jobDescription: found.description,
      organizationName: found.organization?.name ?? null,
      location: found.location,
      remoteStatus: found.remoteStatus,
      salaryHint,
    })
  } catch {
    captureAiGeneration({
      orgId,
      userId: session.user.id,
      feature: 'job_share_copy',
      provider: resolved.provider,
      model: resolved.model,
      billingMode: resolved.billingMode,
      promptTokens: 0,
      completionTokens: 0,
      costUsdMicros: null,
      latencyMs: Date.now() - startedAt,
      status: 'failed',
    })
    throw createError({
      statusCode: 502,
      statusMessage: 'Could not write the share posts right now. Please try again.',
    })
  }

  captureAiGeneration({
    orgId,
    userId: session.user.id,
    feature: 'job_share_copy',
    provider: resolved.provider,
    model: resolved.model,
    billingMode: resolved.billingMode,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    costUsdMicros: computeCostUsdMicros(
      resolved.model, result.usage.promptTokens, result.usage.completionTokens,
    ),
    latencyMs: Date.now() - startedAt,
    status: 'completed',
  })

  const payload = {
    channels: result.copy as unknown as Record<string, string>,
    generatedAt: new Date().toISOString(),
  }

  await db.update(job)
    .set({ shareCopy: payload, updatedAt: new Date() })
    .where(and(eq(job.id, id), eq(job.organizationId, orgId)))

  return { ...payload, source: 'generated' as const }
})
