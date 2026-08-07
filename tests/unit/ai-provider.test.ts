import { afterEach, describe, expect, it, vi } from 'vitest'
import { encrypt } from '../../server/utils/encryption'
import { createLanguageModel } from '../../server/utils/ai/provider'

const secret = 'test-secret-that-is-long-enough'

describe('createLanguageModel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses Chat Completions for OpenRouter tool-call compatibility', () => {
    vi.stubGlobal('env', { BETTER_AUTH_SECRET: secret })

    const model = createLanguageModel({
      provider: 'openrouter',
      model: 'openai/gpt-5.4-mini',
      apiKeyEncrypted: encrypt('sk-or-test', secret),
      baseUrl: 'https://openrouter.ai/api/v1',
      maxTokens: 4096,
    })

    expect(model.provider).toBe('openai.chat')
    expect(model.modelId).toBe('openai/gpt-5.4-mini')
  })
})
