import { z } from 'zod'
import { parseSafeAiBaseUrl } from '../ai/safeEndpoint'

// ─── AI Config Schemas ────────────────────────────────────────────

const safeBaseUrl = z.string().url().max(500).superRefine((url, ctx) => {
  try {
    parseSafeAiBaseUrl(url)
  }
  catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Custom AI endpoint is not allowed.',
    })
  }
})

export const createAiConfigSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  provider: z.enum(['openai', 'anthropic', 'google', 'openai_compatible', 'openrouter']),
  model: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(500),
  baseUrl: safeBaseUrl.nullish(),
  // Modern frontier models support 100K+ output tokens. Cap generously to avoid blocking power users.
  maxTokens: z.number().int().min(256).max(200000).optional().default(16384),
  inputPricePer1m: z.number().min(0).max(9999).nullish(),
  outputPricePer1m: z.number().min(0).max(9999).nullish(),
  isDefaultChatbot: z.boolean().optional().default(false),
  isDefaultAnalysis: z.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  if (value.provider === 'openai_compatible' && !value.baseUrl) {
    ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'A custom HTTPS endpoint is required.' })
  }
  if (value.provider !== 'openai_compatible' && value.baseUrl) {
    ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Only custom OpenAI-compatible providers accept a base URL.' })
  }
})

export const updateAiConfigSchema = z.object({
  name: z.string().min(1).max(80).trim().optional(),
  provider: z.enum(['openai', 'anthropic', 'google', 'openai_compatible', 'openrouter']).optional(),
  model: z.string().min(1).max(200).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  baseUrl: safeBaseUrl.nullish(),
  maxTokens: z.number().int().min(256).max(200000).optional(),
  inputPricePer1m: z.number().min(0).max(9999).nullish(),
  outputPricePer1m: z.number().min(0).max(9999).nullish(),
  // Only the platform ("company") config uses this — it is server-managed and
  // can only be enabled or disabled, never edited.
  isEnabled: z.boolean().optional(),
})

export const setAiConfigDefaultSchema = z.object({
  /** Which "purpose" slots to claim for this configuration. */
  purposes: z.array(z.enum(['chatbot', 'analysis'])).min(1),
})

// ─── Scoring Criterion Schemas ────────────────────────────────────

const criterionCategoryValues = ['technical', 'experience', 'soft_skills', 'education', 'culture', 'custom'] as const

export const createCriterionSchema = z.object({
  key: z.string()
    .trim()
    .min(1).max(100)
    .regex(/^[a-z][a-z0-9_]*$/, 'Key must be lowercase alphanumeric with underscores, starting with a letter'),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullish(),
  category: z.enum(criterionCategoryValues).optional().default('custom'),
  maxScore: z.number().int().min(1).max(100).optional().default(10),
  weight: z.number().int().min(0).max(100).optional().default(50),
  displayOrder: z.number().int().min(0).optional().default(0),
})

export const updateCriterionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullish(),
  category: z.enum(criterionCategoryValues).optional(),
  maxScore: z.number().int().min(1).max(100).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  displayOrder: z.number().int().min(0).optional(),
})

export const bulkCriteriaSchema = z.object({
  criteria: z.array(createCriterionSchema).min(1).max(20),
})

export const updateWeightsSchema = z.object({
  weights: z.array(z.object({
    key: z.string().min(1).max(100),
    weight: z.number().int().min(0).max(100),
  })).min(1).max(20),
})

// ─── Generate Criteria Schema ─────────────────────────────────────

export const generateCriteriaSchema = z.object({
  template: z.enum(['standard', 'technical', 'non_technical']).optional(),
})
