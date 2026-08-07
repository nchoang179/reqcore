/**
 * AI Provider Abstraction Layer
 *
 * Supports OpenAI, Anthropic, Google, and custom OpenAI-compatible endpoints.
 * Credentials are decrypted per-request from the organization's AI config.
 * Never logs or stores raw API keys — only encrypted values in the database.
 */
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import type { z } from 'zod'
import { decrypt } from '../encryption'
import { safeAiEndpointFetch } from './safeEndpoint'

export type SupportedProvider = 'openai' | 'anthropic' | 'google' | 'openai_compatible' | 'openrouter'

/** Base URL for the OpenRouter unified gateway (platform-paid runs). */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export interface ProviderConfig {
  provider: SupportedProvider
  model: string
  apiKeyEncrypted: string
  baseUrl?: string | null
  maxTokens: number
}

/** Detailed info about a single model (presentation + suggested defaults). */
export interface ModelInfo {
  /** Provider-recognised model id, e.g. `gpt-5.4-mini`. */
  id: string
  /** Human label shown in dropdowns, e.g. `GPT‑4.1 Mini`. */
  label: string
  /** One-line plain-English description for non-experts. */
  description: string
  /** Suggested USD price per 1M input tokens — used to pre-fill the form. */
  inputPricePer1m?: number
  /** Suggested USD price per 1M output tokens — used to pre-fill the form. */
  outputPricePer1m?: number
  /** Optional badge: `recommended`, `fast`, `powerful`, `cheap`. */
  badge?: 'recommended' | 'fast' | 'powerful' | 'cheap'
}

/** Well-known providers with links for obtaining API keys and curated model lists. */
export const PROVIDER_REGISTRY: Record<string, {
  name: string
  /** Short tagline describing the provider for the UI. */
  tagline: string
  modelsUrl: string
  apiKeyUrl: string
  /** Optional docs link explaining how to get started. */
  signupUrl?: string
  /** Whether a custom Base URL field should be exposed. */
  supportsBaseUrl: boolean
  defaultModel: string
  models: ModelInfo[]
}> = {
  openai: {
    name: 'OpenAI',
    tagline: 'Industry-leading GPT models. The safest default for most teams.',
    modelsUrl: 'https://platform.openai.com/docs/models',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    signupUrl: 'https://platform.openai.com/signup',
    supportsBaseUrl: false,
    defaultModel: 'gpt-5.4-mini',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5', description: 'OpenAI flagship for complex reasoning, coding, and long-context work.', inputPricePer1m: 5.0, outputPricePer1m: 30.0, badge: 'powerful' },
      { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Strong frontier model for professional workflows at a lower price than GPT-5.5.', inputPricePer1m: 2.5, outputPricePer1m: 15.0 },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Best default for most teams: fast, capable, and cost-efficient.', inputPricePer1m: 0.75, outputPricePer1m: 4.5, badge: 'recommended' },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', description: 'Lowest-cost GPT-5 option for high-volume chat and scoring.', inputPricePer1m: 0.2, outputPricePer1m: 1.25, badge: 'cheap' },
    ],
  },
  anthropic: {
    name: 'Anthropic',
    tagline: 'Claude models — strong at long-form analysis and nuanced writing.',
    modelsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    signupUrl: 'https://console.anthropic.com/',
    supportsBaseUrl: false,
    defaultModel: 'claude-sonnet-5',
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5', description: 'Anthropic\'s most capable widely released model for demanding analysis.', inputPricePer1m: 10.0, outputPricePer1m: 50.0, badge: 'powerful' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', description: 'Strongest Claude Opus model for complex agentic and enterprise work.', inputPricePer1m: 5.0, outputPricePer1m: 25.0 },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Best balance of speed and intelligence. Recommended default.', inputPricePer1m: 2.0, outputPricePer1m: 10.0, badge: 'recommended' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Fastest Claude option with near-frontier quality for chat and scoring.', inputPricePer1m: 1.0, outputPricePer1m: 5.0, badge: 'fast' },
    ],
  },
  google: {
    name: 'Google AI (Gemini)',
    tagline: 'Gemini models — generous free tier and very fast inference.',
    modelsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    signupUrl: 'https://aistudio.google.com/',
    supportsBaseUrl: false,
    defaultModel: 'gemini-3.5-flash',
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'Current stable Gemini model for frontier-quality agentic and coding tasks.', inputPricePer1m: 1.5, outputPricePer1m: 9.0, badge: 'recommended' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', description: 'Advanced preview model for complex reasoning and multimodal workflows.', inputPricePer1m: 2.0, outputPricePer1m: 12.0, badge: 'powerful' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', description: 'Fast preview model with strong multimodal understanding and tool support.', inputPricePer1m: 0.5, outputPricePer1m: 3.0, badge: 'fast' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', description: 'Cost-efficient Gemini 3 model for high-volume lightweight tasks.', inputPricePer1m: 0.25, outputPricePer1m: 1.5, badge: 'cheap' },
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    tagline: 'Unified gateway for OpenAI-compatible models with platform-managed routing.',
    modelsUrl: 'https://openrouter.ai/models',
    apiKeyUrl: 'https://openrouter.ai/keys',
    signupUrl: 'https://openrouter.ai/',
    supportsBaseUrl: false,
    defaultModel: 'openai/gpt-5.4-mini',
    models: [
      { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini via OpenRouter', description: 'Cost-efficient default for platform-paid candidate analysis.', inputPricePer1m: 0.75, outputPricePer1m: 4.5, badge: 'recommended' },
      { id: 'openai/gpt-5.4', label: 'GPT-5.4 via OpenRouter', description: 'Stronger OpenAI model routed through OpenRouter.', inputPricePer1m: 2.5, outputPricePer1m: 15.0 },
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 via OpenRouter', description: 'Balanced Claude model routed through OpenRouter.', inputPricePer1m: 2.0, outputPricePer1m: 10.0 },
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash via OpenRouter', description: 'Fast Gemini model routed through OpenRouter.', inputPricePer1m: 1.5, outputPricePer1m: 9.0, badge: 'fast' },
    ],
  },
  openai_compatible: {
    name: 'OpenAI-Compatible (Custom)',
    tagline: 'Connect any OpenAI-compatible endpoint: Ollama, LM Studio, OpenRouter, Groq, Together AI, vLLM, …',
    modelsUrl: '',
    apiKeyUrl: '',
    supportsBaseUrl: true,
    defaultModel: '',
    models: [],
  },
}

/**
 * Fetch wrapper for OpenRouter that injects `provider: { allow_fallbacks: false }`
 * into the JSON request body, pinning routing for reliable structured output.
 * Falls through untouched if the body isn't parseable JSON.
 */
const pinOpenRouterRouting: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body)
      body.provider = { allow_fallbacks: false, ...(body.provider ?? {}) }
      init = { ...init, body: JSON.stringify(body) }
    }
    catch {
      // Non-JSON body (shouldn't happen for chat completions) — leave as-is.
    }
  }
  return fetch(input, init)
}

/**
 * Create a language model instance from encrypted config.
 * Decrypts the API key just-in-time and never persists it in memory beyond the call.
 */
export function createLanguageModel(config: ProviderConfig) {
  const secret = env.BETTER_AUTH_SECRET
  const apiKey = decrypt(config.apiKeyEncrypted, secret)

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to decrypt AI API key. The key may be corrupted.',
    })
  }

  switch (config.provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey,
      })
      return openai(config.model)
    }
    case 'openai_compatible': {
      if (!config.baseUrl) {
        throw createError({ statusCode: 500, statusMessage: 'Custom AI endpoint is missing.' })
      }
      const openai = createOpenAI({
        apiKey,
        baseURL: config.baseUrl,
        fetch: safeAiEndpointFetch,
      })
      return openai(config.model)
    }
    case 'openrouter': {
      // OpenRouter is OpenAI-compatible. The `@ai-sdk/openai` provider won't
      // forward OpenRouter's top-level `provider` routing field, so we inject it
      // via a fetch wrapper: disabling fallbacks keeps structured-output
      // (generateObject) from intermittently breaking when OpenRouter would
      // otherwise route to an upstream with weaker JSON/tool-mode support.
      const openrouter = createOpenAI({
        apiKey,
        baseURL: config.baseUrl || OPENROUTER_BASE_URL,
        headers: {
          // Recommended by OpenRouter for attribution in their dashboard.
          'HTTP-Referer': 'https://reqcore.com',
          'X-Title': 'Reqcore',
        },
        fetch: pinOpenRouterRouting,
      })
      // The provider's automatic model factory selects the Responses API for
      // recent OpenAI models. OpenRouter currently loses tool-call context on
      // multi-step Responses requests, so use its stable Chat Completions
      // compatibility endpoint explicitly.
      return openrouter.chat(config.model)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey,
      })
      return anthropic(config.model)
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey,
      })
      return google(config.model)
    }
    default:
      throw createError({
        statusCode: 400,
        statusMessage: `Unsupported AI provider: ${config.provider}`,
      })
  }
}

/**
 * Generate a structured JSON response from the AI provider.
 * Uses Vercel AI SDK's `generateObject` for reliable schema-conformant output.
 */
export async function generateStructuredOutput<T>(
  config: ProviderConfig,
  options: {
    system: string
    prompt: string
    schema: z.ZodType<T>
    schemaName: string
    schemaDescription?: string
  },
): Promise<{ object: T; usage: { promptTokens: number; completionTokens: number } }> {
  const model = createLanguageModel(config)

  const result = await generateObject({
    model,
    system: options.system,
    prompt: options.prompt,
    schema: options.schema,
    schemaName: options.schemaName,
    schemaDescription: options.schemaDescription,
    maxOutputTokens: config.maxTokens,
    temperature: 0.1,
  })

  return {
    object: result.object,
    usage: {
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
    },
  }
}
