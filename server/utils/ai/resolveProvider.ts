/**
 * Resolve which AI provider + key an AI call should use, and who pays.
 *
 * Two entry points — `resolveAnalysisProvider` for scoring runs and
 * `resolveChatbotProvider` for assistant turns. They share the same rules and
 * return the same shape; they differ only in which "default" column they honour.
 *
 *   1. The org has its own AI config  → BYOK. Their key, their bill. Not capped.
 *   2. No org config, platform key set → route through OpenRouter on our key.
 *      `billingMode: 'platform'` — subject to the budget gate (budget.ts).
 *   3. Neither                         → 422, same as before.
 *
 * The platform key is encrypted here with the same secret the provider layer
 * decrypts with, so it travels the identical `apiKeyEncrypted` path — the raw
 * key never sits in a plaintext field on the config object.
 */
import { encrypt } from '../encryption'
import { loadAiConfig } from './loadConfig'
import { OPENROUTER_BASE_URL, type ProviderConfig } from './provider'
import {
  canUsePlatformAi,
  getPlatformAiOverride,
  PLATFORM_AI_CONFIG_ID,
  platformOverrideEnabled,
  resolvePlatformAiProviderConfig,
} from './platformConfig'

export interface ResolvedProvider {
  providerConfig: ProviderConfig
  /** Stored on the analysisRun row; drives budget enforcement. */
  billingMode: 'platform' | 'byok'
  /** Provider + model strings for the audit trail. */
  provider: string
  model: string
}

export async function resolveAnalysisProvider(
  orgId: string,
  opts: { preferId?: string | null } = {},
): Promise<ResolvedProvider> {
  if (opts.preferId === PLATFORM_AI_CONFIG_ID) {
    const platform = await resolvePlatformAiProviderConfig(orgId)
    return {
      ...platform,
      billingMode: 'platform',
    }
  }

  if (!opts.preferId) {
    const platformOverride = await getPlatformAiOverride(orgId)
    // The plan check comes first: an override row on a BYOK-only plan holds the
    // analysis slot but may not spend the platform key, and taking this branch
    // would 422 inside `resolvePlatformAiProviderConfig` instead of falling
    // through to the org's own config below.
    if (platformOverride?.isEnabled && platformOverride.isDefaultAnalysis && await canUsePlatformAi(orgId)) {
      const platform = await resolvePlatformAiProviderConfig(orgId)
      return {
        ...platform,
        billingMode: 'platform',
      }
    }
  }

  // 1 + 3: org's own config (or 422 if none AND no platform fallback below).
  try {
    const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: opts.preferId })
    return {
      providerConfig: {
        provider: config.provider as ProviderConfig['provider'],
        model: config.model,
        apiKeyEncrypted: config.apiKeyEncrypted,
        baseUrl: config.baseUrl,
        maxTokens: config.maxTokens,
      },
      billingMode: 'byok',
      provider: config.provider,
      model: config.model,
    }
  }
  catch (err) {
    // Grandfathered hosted orgs are free because they pay the LLM provider
    // directly. If their BYOK config is missing, do not spend the platform key —
    // unless the workspace carries an explicit `planExempt` grant, which is what
    // `canUsePlatformAi` weighs.
    if (!await canUsePlatformAi(orgId)) throw err

    // 2: no org config — fall back to the platform key if one is configured.
    const platformKey = env.OPENROUTER_API_KEY
    if (!platformKey) throw err
    const platformOverride = await getPlatformAiOverride(orgId)
    if (!platformOverrideEnabled(platformOverride)) throw err

    if (platformOverride) {
      const platform = await resolvePlatformAiProviderConfig(orgId)
      return {
        ...platform,
        billingMode: 'platform',
      }
    }

    const model = env.OPENROUTER_MODEL
    return {
      providerConfig: {
        provider: 'openrouter',
        model,
        apiKeyEncrypted: encrypt(platformKey, env.BETTER_AUTH_SECRET),
        baseUrl: OPENROUTER_BASE_URL,
        maxTokens: 4096,
      },
      billingMode: 'platform',
      provider: 'openrouter',
      model,
    }
  }
}

/**
 * Resolve the provider for one assistant turn.
 *
 * Resolution order:
 *   1. `preferId === '__platform__'`  → the platform engine, explicitly picked.
 *   2. `preferId` (a real config id)  → that BYOK config.
 *   3. No preference, and the platform engine holds the chatbot-default slot
 *      → platform.
 *   4. Otherwise the org's BYOK chatbot default (or any config it has).
 *   5. No BYOK config at all → fall back to the platform engine, so a Solo org
 *      that never opened Settings → AI still gets a working assistant.
 *   6. Nothing available → the 422 from loadAiConfig, pointing at Settings → AI.
 *
 * Grandfathered orgs are excluded from every platform path by `canUsePlatformAi`
 * (their free tier is explicitly BYOK-only, since they pay their LLM provider
 * directly) — so for them steps 3 and 5 are unavailable and a missing BYOK
 * config surfaces as the 422 rather than silently spending the platform key.
 * A per-org `platformAiConfig.planExempt` grant lifts that exclusion for one
 * workspace, restoring steps 3 and 5 for it alone.
 *
 * `model` is the composer's model picker and applies to the platform paths only.
 * A BYOK config carries its own model id — the org's key may not even be able to
 * reach the picked one — so the pin is ignored on those paths rather than
 * forced onto a provider that would reject it.
 */
export async function resolveChatbotProvider(
  orgId: string,
  opts: { preferId?: string | null, model?: string | null } = {},
): Promise<ResolvedProvider> {
  if (opts.preferId === PLATFORM_AI_CONFIG_ID) {
    const platform = await resolvePlatformAiProviderConfig(orgId, { modelOverride: opts.model })
    return { ...platform, billingMode: 'platform' }
  }

  if (!opts.preferId) {
    const platformOverride = await getPlatformAiOverride(orgId)
    if (
      platformOverride?.isEnabled
      && platformOverride.isDefaultChatbot
      && await canUsePlatformAi(orgId)
    ) {
      const platform = await resolvePlatformAiProviderConfig(orgId, { modelOverride: opts.model })
      return { ...platform, billingMode: 'platform' }
    }
  }

  try {
    const config = await loadAiConfig(orgId, { purpose: 'chatbot', preferId: opts.preferId })
    return {
      providerConfig: {
        provider: config.provider as ProviderConfig['provider'],
        model: config.model,
        apiKeyEncrypted: config.apiKeyEncrypted,
        baseUrl: config.baseUrl,
        maxTokens: config.maxTokens,
      },
      billingMode: 'byok',
      provider: config.provider,
      model: config.model,
    }
  }
  catch (err) {
    // No BYOK config. Fall back to the platform engine unless it's unavailable
    // (grandfathered org, no server key, or the org switched it off).
    if (!await canUsePlatformAi(orgId)) throw err
    const platformOverride = await getPlatformAiOverride(orgId)
    if (!platformOverrideEnabled(platformOverride)) throw err

    const platform = await resolvePlatformAiProviderConfig(orgId, { modelOverride: opts.model })
    return { ...platform, billingMode: 'platform' }
  }
}
