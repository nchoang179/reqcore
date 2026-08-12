import { eq } from 'drizzle-orm'
import { platformAiConfig } from '../../database/schema'
import { encrypt } from '../encryption'
import { OPENROUTER_BASE_URL, type ProviderConfig } from './provider'
import { isChatbotCatalogueModel } from '../../../shared/chatbot-models'
import { PLATFORM_ENGINE_ID } from '../../../shared/chatbot'

export const PLATFORM_AI_CONFIG_ID = PLATFORM_ENGINE_ID
export const PLATFORM_AI_PROVIDER = 'openrouter'
export const DEFAULT_PLATFORM_AI_NAME = 'Reqcore AI'
export const DEFAULT_PLATFORM_MAX_TOKENS = 4096

type PlatformAiOverride = typeof platformAiConfig.$inferSelect

export interface PlatformAiConfigListRow {
  id: typeof PLATFORM_AI_CONFIG_ID
  name: string
  provider: typeof PLATFORM_AI_PROVIDER
  model: string
  baseUrl: null
  maxTokens: number
  inputPricePer1m: number | null
  outputPricePer1m: number | null
  isDefaultChatbot: boolean
  isDefaultAnalysis: boolean
  isEnabled: boolean
  hasApiKey: boolean
  source: 'platform'
  createdAt: Date
  updatedAt: Date
}

export async function getPlatformAiOverride(orgId: string): Promise<PlatformAiOverride | null> {
  return await db.query.platformAiConfig.findFirst({
    where: eq(platformAiConfig.organizationId, orgId),
  }) ?? null
}

/**
 * Whether this org may route AI through the platform key at all.
 *
 * Every tier may, including `grandfathered`: that tier was BYOK-only until its
 * allowances were aligned with Free (`tierUsesFreeAllowances`), which bounds what
 * it can spend. Before that it was the one tier whose members could not run AI at
 * all without bringing a key, which is exactly what most of them never did.
 */
export async function canUsePlatformAi(_orgId: string): Promise<boolean> {
  return Boolean(env.OPENROUTER_API_KEY)
}

// The platform ("company") AI is server-managed: its model, display name and
// token cap always come from the environment, never from per-org edits. The
// only per-org state we honour is whether it is enabled and whether it holds
// the analysis- and chatbot-default slots.
function platformModel(): string {
  return env.OPENROUTER_MODEL
}

export function platformOverrideEnabled(row: PlatformAiOverride | null): boolean {
  return row?.isEnabled ?? true
}

export function toPlatformAiConfigListRow(
  row: PlatformAiOverride | null,
  opts: { isDefaultAnalysisFallback?: boolean, isDefaultChatbotFallback?: boolean } = {},
): PlatformAiConfigListRow {
  const isEnabled = platformOverrideEnabled(row)
  const isDefaultAnalysis = isEnabled
    ? (row?.isDefaultAnalysis ?? opts.isDefaultAnalysisFallback ?? true)
    : false
  // Mirrors the analysis slot: the platform engine holds the chatbot default
  // unless a BYOK config has claimed it (the caller passes that as the fallback).
  const isDefaultChatbot = isEnabled
    ? (row?.isDefaultChatbot ?? opts.isDefaultChatbotFallback ?? true)
    : false
  return {
    id: PLATFORM_AI_CONFIG_ID,
    name: DEFAULT_PLATFORM_AI_NAME,
    provider: PLATFORM_AI_PROVIDER,
    model: platformModel(),
    baseUrl: null,
    maxTokens: DEFAULT_PLATFORM_MAX_TOKENS,
    inputPricePer1m: row?.inputPricePer1m != null ? Number(row.inputPricePer1m) : null,
    outputPricePer1m: row?.outputPricePer1m != null ? Number(row.outputPricePer1m) : null,
    isDefaultChatbot,
    isDefaultAnalysis,
    isEnabled,
    hasApiKey: Boolean(env.OPENROUTER_API_KEY),
    source: 'platform',
    createdAt: row?.createdAt ?? new Date(0),
    updatedAt: row?.updatedAt ?? new Date(0),
  }
}

/**
 * Resolve the platform engine's provider config.
 *
 * `modelOverride` is the assistant's model picker. It is honoured *only* when
 * the id is in the vetted catalogue (`shared/chatbot-models.ts`): the value
 * arrives from a request body, and an arbitrary string here would route
 * platform-paid traffic to any model on OpenRouter — including ones with no
 * price on file, which spend money no budget gate can see. Anything unrecognised
 * silently falls back to the env default rather than erroring, so a stale pin on
 * an old conversation still answers.
 */
export async function resolvePlatformAiProviderConfig(
  orgId: string,
  opts: { requireEnabled?: boolean, modelOverride?: string | null } = {},
): Promise<{ providerConfig: ProviderConfig, provider: typeof PLATFORM_AI_PROVIDER, model: string }> {
  if (!await canUsePlatformAi(orgId)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Platform OpenRouter AI is not available for this workspace.',
    })
  }

  const row = await getPlatformAiOverride(orgId)
  if (opts.requireEnabled !== false && !platformOverrideEnabled(row)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Platform OpenRouter AI has been removed for this workspace.',
    })
  }

  const apiKey = env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Platform OpenRouter AI is not configured on this server.',
    })
  }

  const model = isChatbotCatalogueModel(opts.modelOverride)
    ? opts.modelOverride!
    : platformModel()
  return {
    providerConfig: {
      provider: PLATFORM_AI_PROVIDER,
      model,
      apiKeyEncrypted: encrypt(apiKey, env.BETTER_AUTH_SECRET),
      baseUrl: OPENROUTER_BASE_URL,
      maxTokens: DEFAULT_PLATFORM_MAX_TOKENS,
    },
    provider: PLATFORM_AI_PROVIDER,
    model,
  }
}
