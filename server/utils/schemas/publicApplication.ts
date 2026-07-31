import { createError } from 'h3'
import { z } from 'zod'

// ─────────────────────────────────────────────
// Public application submission schemas
// ─────────────────────────────────────────────

/**
 * Attribution values come from URLs nobody here controls: ad platforms mint
 * long `utm_content`/`utm_term` strings, and job boards re-append params so the
 * same key can arrive twice (`?ref=a&ref=b`, which arrives as an array).
 *
 * Losing an application over a tracking parameter is never the right trade, so
 * these are clamped — first usable value, truncated to the column budget — and
 * dropped when unusable, instead of failing validation.
 */
function attributionField(maxLength: number) {
  return z.preprocess((value) => {
    const raw = Array.isArray(value)
      ? value.find((v) => typeof v === 'string' && v.trim().length > 0)
      : value

    if (typeof raw !== 'string') return undefined

    const clamped = raw.trim().slice(0, maxLength)
    return clamped.length > 0 ? clamped : undefined
  }, z.string().optional())
}

/** Schema for a single question response in a public application */
const questionResponseSchema = z.object({
  questionId: z.string().min(1),
  value: z.union([
    z.string(),
    z.array(z.string()),
    z.number(),
    z.boolean(),
  ]),
})

/** Schema for public application submission on an open job */
export const publicApplicationSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100, 'Must be 100 characters or fewer'),
  lastName: z.string().min(1, 'Last name is required').max(100, 'Must be 100 characters or fewer'),
  email: z.string().email('Invalid email address').max(254, 'Must be 254 characters or fewer'),
  phone: z.string().max(50, 'Must be 50 characters or fewer').optional(),
  responses: z.array(questionResponseSchema).default([]),
  /** Optional cover letter text submitted by the candidate */
  coverLetterText: z.string().max(10000, 'Must be 10000 characters or fewer').optional(),
  /** Honeypot field — bots fill it, humans don't see it. Validated at runtime in the handler. */
  website: z.string().optional(),
  /** Source attribution — captured from URL query parameters on the apply page. Clamped, never rejected. */
  ref: attributionField(100),
  utmSource: attributionField(200),
  utmMedium: attributionField(200),
  utmCampaign: attributionField(200),
  utmTerm: attributionField(200),
  utmContent: attributionField(200),
})

/** Human-readable field names for validation errors shown to the candidate. */
const FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email address',
  phone: 'Phone number',
  coverLetterText: 'Cover letter',
  responses: 'Answers',
}

/**
 * Validate a public application submission, failing with a 400 the candidate can
 * act on.
 *
 * Both submission paths go through this. The multipart path used to call
 * `.parse()` directly, so a ZodError escaped as an unhandled error and the
 * applicant got "Internal Server Error" with no hint about which field was at
 * fault; the JSON path produced a bare "Validation Error", which is no better.
 */
export function parsePublicApplication(input: unknown) {
  const result = publicApplicationSchema.safeParse(input)
  if (result.success) return result.data

  const issue = result.error.issues[0]
  const field = typeof issue?.path?.[0] === 'string' ? issue.path[0] : undefined
  const label = field ? FIELD_LABELS[field] : undefined
  const detail = issue?.message ?? 'Invalid application data'

  throw createError({
    statusCode: 400,
    statusMessage: label ? `${label}: ${detail}` : detail,
    data: {
      field,
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
  })
}

/** Route param for public job slug */
export const publicJobSlugSchema = z.object({
  slug: z.string().min(1),
})

/** Route param for public job ID (legacy, used internally) */
export const publicJobIdSchema = z.object({
  id: z.string().min(1),
})

// ─────────────────────────────────────────────
// Public job board query schemas
// ─────────────────────────────────────────────

/** Schema for public job listing query params */
export const publicJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().min(1).max(200).optional(),
  type: z.enum(['full_time', 'part_time', 'contract', 'internship']).optional(),
  location: z.string().min(1).max(200).optional(),
})
