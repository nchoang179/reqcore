/**
 * The assistant is available on every plan and runs on either the org's own key
 * (BYOK, Solo and up) or the platform OpenRouter key. These tests pin both
 * halves: who is entitled to it, and which engine a turn resolves to. The Free
 * tier's lifetime turn cap is a spend-time gate, covered in
 * tests/unit/ai-budget-ledgers.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tierHasFeature, FEATURE_MIN_TIER, type BillingTier } from '../../shared/billing'

const state = vi.hoisted(() => ({
  plan: 'solo' as string,
  platformOverride: null as null | {
    isEnabled: boolean
    isDefaultAnalysis: boolean
    isDefaultChatbot: boolean
  },
  byokConfig: null as null | { id: string, provider: string, model: string },
  /** Whether the server has a platform OpenRouter key — the only thing
   *  `canUsePlatformAi` weighs now that no tier is excluded from it. */
  platformKey: true,
}))

vi.mock('../../server/utils/ai/loadConfig', () => ({
  loadAiConfig: vi.fn(async () => {
    if (!state.byokConfig) throw new Error('No AI config')
    return {
      ...state.byokConfig,
      apiKeyEncrypted: 'encrypted-org-key',
      baseUrl: null,
      maxTokens: 4096,
    }
  }),
}))

vi.mock('../../server/utils/billing/plan', () => ({
  resolveOrgPlanId: vi.fn(async () => state.plan),
}))

vi.mock('../../server/utils/ai/platformConfig', () => ({
  PLATFORM_AI_CONFIG_ID: '__platform__',
  canUsePlatformAi: vi.fn(async () => state.platformKey),
  getPlatformAiOverride: vi.fn(async () => state.platformOverride),
  platformOverrideEnabled: vi.fn((row: null | { isEnabled: boolean }) => row?.isEnabled ?? true),
  resolvePlatformAiProviderConfig: vi.fn(async () => ({
    providerConfig: {
      provider: 'openrouter',
      model: 'openai/gpt-5.4-mini',
      apiKeyEncrypted: 'encrypted-platform-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      maxTokens: 4096,
    },
    provider: 'openrouter',
    model: 'openai/gpt-5.4-mini',
  })),
}))

import { resolveChatbotProvider } from '../../server/utils/ai/resolveProvider'

describe('chatbot plan entitlement', () => {
  it('is available on every tier — Free is capped by turn count, not entitlement', () => {
    expect(FEATURE_MIN_TIER.chatbot).toBe('free')
  })

  it('keeps BYOK a paid capability, so a free org cannot escape the turn cap', () => {
    expect(FEATURE_MIN_TIER.byok).toBe('solo')
    expect(tierHasFeature('free', 'byok')).toBe(false)
  })

  it.each<[BillingTier, boolean]>([
    ['free', true],
    ['solo', true],
    ['team', true],
    ['grandfathered', true],
    ['scale', true],
    ['agency', true],
  ])('tier %s entitled: %s', (tier, expected) => {
    expect(tierHasFeature(tier, 'chatbot')).toBe(expected)
  })
})

describe('resolveChatbotProvider', () => {
  beforeEach(() => {
    state.plan = 'solo'
    state.platformOverride = null
    state.byokConfig = null
    state.platformKey = true
    vi.stubGlobal('env', {
      OPENROUTER_API_KEY: 'sk-platform-test',
      OPENROUTER_MODEL: 'openai/gpt-5.4-mini',
      BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough',
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('uses the platform engine when the org has no AI config of its own', async () => {
    const resolved = await resolveChatbotProvider('org-1')
    expect(resolved.billingMode).toBe('platform')
    expect(resolved.provider).toBe('openrouter')
  })

  it('uses the org BYOK config when it has one', async () => {
    state.byokConfig = { id: 'cfg-1', provider: 'anthropic', model: 'claude-opus-5' }
    const resolved = await resolveChatbotProvider('org-1')
    expect(resolved.billingMode).toBe('byok')
    expect(resolved.model).toBe('claude-opus-5')
  })

  it('honours an explicit platform pick even when a BYOK config exists', async () => {
    state.byokConfig = { id: 'cfg-1', provider: 'anthropic', model: 'claude-opus-5' }
    const resolved = await resolveChatbotProvider('org-1', { preferId: '__platform__' })
    expect(resolved.billingMode).toBe('platform')
  })

  it('prefers the platform engine when it holds the chatbot-default slot', async () => {
    state.byokConfig = { id: 'cfg-1', provider: 'anthropic', model: 'claude-opus-5' }
    state.platformOverride = { isEnabled: true, isDefaultAnalysis: false, isDefaultChatbot: true }
    const resolved = await resolveChatbotProvider('org-1')
    expect(resolved.billingMode).toBe('platform')
  })

  it('falls back to BYOK when the org switched the platform engine off', async () => {
    state.byokConfig = { id: 'cfg-1', provider: 'anthropic', model: 'claude-opus-5' }
    state.platformOverride = { isEnabled: false, isDefaultAnalysis: false, isDefaultChatbot: true }
    const resolved = await resolveChatbotProvider('org-1')
    expect(resolved.billingMode).toBe('byok')
  })

  it('serves a grandfathered org from the platform key when it has no config', async () => {
    // The tier was BYOK-only, which left the orgs that never configured a key
    // with no assistant at all. It now resolves like any other tier; what bounds
    // it is the Free prompt allowance in budget.ts, not this resolution order.
    state.plan = 'grandfathered'
    const resolved = await resolveChatbotProvider('org-1')
    expect(resolved.billingMode).toBe('platform')
  })

  it('surfaces the config error when the server has no platform key', async () => {
    state.platformKey = false
    await expect(resolveChatbotProvider('org-1')).rejects.toThrow('No AI config')
  })

  it('still honours a grandfathered org that switched the platform engine off', async () => {
    state.plan = 'grandfathered'
    state.platformOverride = { isEnabled: false, isDefaultAnalysis: false, isDefaultChatbot: true }
    await expect(resolveChatbotProvider('org-1')).rejects.toThrow('No AI config')
  })

  it('still serves a grandfathered org from its own key', async () => {
    state.plan = 'grandfathered'
    state.byokConfig = { id: 'cfg-1', provider: 'anthropic', model: 'claude-opus-5' }
    const resolved = await resolveChatbotProvider('org-1')
    expect(resolved.billingMode).toBe('byok')
  })
})
