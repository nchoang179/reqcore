import { fileTypeFromBuffer } from 'file-type'
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '../../utils/schemas/document'
import { parseDocument } from '../../utils/resume-parser'
import { resolveAnalysisProvider } from '../../utils/ai/resolveProvider'
import { assertPlatformBudget, BudgetExceededError, budgetErrorToHttp } from '../../utils/ai/budget'
import { computeCostUsdMicros } from '../../utils/ai/pricing'
import { captureAiGeneration } from '../../utils/ai/observability'
import { extractCandidateFromCv } from '../../utils/ai/cvExtraction'
import { createRateLimiter } from '../../utils/rateLimit'

/**
 * POST /api/candidates/extract-cv
 *
 * Read a CV (PDF, DOC, DOCX) and return the contact details it contains, so
 * the add-candidate form can be pre-filled instead of retyped. Works with any
 * CV, including LinkedIn's own "Save to PDF" profile export.
 *
 * Nothing is written: no candidate, no document, no S3 object. The client
 * holds the file and uploads it against the candidate once the recruiter has
 * confirmed the details. That keeps a bad extraction from leaving debris
 * behind, and keeps this endpoint safe to call repeatedly.
 *
 * Security:
 *   - Auth required; gated on `candidate: ['create']` since this exists only to
 *     feed candidate creation
 *   - MIME type validated from magic bytes, not the Content-Type header
 *   - Rate limited — every call costs an LLM run
 */
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Too many CV extractions. Please wait a moment.',
})

/** Below this, the parse produced nothing worth paying a model to read. */
const MIN_TEXT_LENGTH = 40

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  // ─────────────────────────────────────────────
  // 1. Read and validate the file
  // ─────────────────────────────────────────────

  const formData = await readMultipartFormData(event)
  const filePart = formData?.find(part => part.name === 'file')

  if (!filePart?.data || !filePart.filename) {
    throw createError({ statusCode: 400, statusMessage: 'No file provided' })
  }

  const fileBuffer = filePart.data
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw createError({
      statusCode: 413,
      statusMessage: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB`,
    })
  }

  const detectedType = await fileTypeFromBuffer(fileBuffer)
  let mimeType = detectedType?.mime

  // file-type can't detect legacy .doc (OLE2 compound documents) — check magic bytes.
  if (!mimeType) {
    const OLE2_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
    if (fileBuffer.length >= 8 && Buffer.compare(fileBuffer.subarray(0, 8), OLE2_MAGIC) === 0) {
      mimeType = 'application/msword'
    }
  }

  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType as typeof ALLOWED_MIME_TYPES[number])) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file type. Allowed: PDF, DOC, DOCX' })
  }

  // ─────────────────────────────────────────────
  // 2. Extract text
  // ─────────────────────────────────────────────

  const parsed = await parseDocument(fileBuffer, mimeType)
  const text = parsed?.text?.trim() ?? ''

  if (text.length < MIN_TEXT_LENGTH) {
    throw createError({
      statusCode: 422,
      statusMessage: 'No readable text in this file. Scanned or image-only documents can\'t be read.',
    })
  }

  // ─────────────────────────────────────────────
  // 3. Resolve provider and check the budget gate
  // ─────────────────────────────────────────────

  const resolved = await resolveAnalysisProvider(orgId)

  if (resolved.billingMode === 'platform') {
    try {
      await assertPlatformBudget(orgId)
    } catch (err) {
      if (err instanceof BudgetExceededError) throw budgetErrorToHttp(err)
      throw createError({ statusCode: 503, statusMessage: 'AI budget check failed. Please try again later.' })
    }
  }

  // ─────────────────────────────────────────────
  // 4. Extract contact details
  // ─────────────────────────────────────────────

  const startedAt = Date.now()
  let result: Awaited<ReturnType<typeof extractCandidateFromCv>>

  try {
    result = await extractCandidateFromCv(resolved.providerConfig, text)
  } catch {
    captureAiGeneration({
      orgId,
      userId: session.user.id,
      feature: 'cv_contact_extraction',
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
      statusMessage: 'Could not read this CV right now. Please try again, or fill the form in manually.',
    })
  }

  captureAiGeneration({
    orgId,
    userId: session.user.id,
    feature: 'cv_contact_extraction',
    provider: resolved.provider,
    model: resolved.model,
    billingMode: resolved.billingMode,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    costUsdMicros: computeCostUsdMicros(
      resolved.model,
      result.usage.promptTokens,
      result.usage.completionTokens,
    ),
    latencyMs: Date.now() - startedAt,
    status: 'completed',
  })

  return {
    firstName: result.extraction.firstName,
    lastName: result.extraction.lastName,
    email: result.extraction.email,
    phone: result.extraction.phone,
  }
})
