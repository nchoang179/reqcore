/**
 * Central AI price table — the single source of truth for what a token costs us.
 *
 * Cost is always computed at *write time* from this table and frozen onto the
 * `analysisRun` row (see `costUsdMicros`). We never recompute historical cost
 * from mutable per-org `aiConfig` pricing — model prices change, and BYOK orgs
 * carry their own numbers. This table is what reconciles against the OpenRouter
 * invoice for platform-paid runs.
 *
 * Prices are USD per 1,000,000 tokens. Keep in sync with the model lists in
 * `PROVIDER_REGISTRY` (provider.ts) when adding models.
 *
 * The assistant's selectable models are the exception: they are declared once in
 * `shared/chatbot-models.ts` and folded in below. That file owns their prices
 * because the credit multiplier shown in the picker is derived from the same
 * numbers — two tables would let the quoted multiplier drift from the charge.
 */
import { CHATBOT_MODELS } from '../../../shared/chatbot-models'

export interface ModelPrice {
  /** USD per 1M input (prompt) tokens. */
  inputPer1m: number
  /** USD per 1M output (completion) tokens. */
  outputPer1m: number
}

/**
 * Keyed by bare model id. We match on model id alone (not provider) because the
 * same model reached via OpenRouter, the native API, or a BYOK key costs us the
 * same per-token rate — only the billing *payer* differs (see `billingMode`).
 *
 * OpenRouter-style prefixed ids (e.g. `openai/gpt-5.4-mini`) are normalised to
 * the bare id before lookup, so both forms resolve here.
 */
const BASE_MODEL_PRICING: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-5.5': { inputPer1m: 5.0, outputPer1m: 30.0 },
  'gpt-5.4': { inputPer1m: 2.5, outputPer1m: 15.0 },
  'gpt-5.4-mini': { inputPer1m: 0.75, outputPer1m: 4.5 },
  'gpt-5.4-nano': { inputPer1m: 0.2, outputPer1m: 1.25 },
  'gpt-4.1': { inputPer1m: 2.0, outputPer1m: 8.0 },
  'gpt-4.1-mini': { inputPer1m: 0.4, outputPer1m: 1.6 },
  'gpt-4.1-nano': { inputPer1m: 0.1, outputPer1m: 0.4 },
  'gpt-4o': { inputPer1m: 2.5, outputPer1m: 10.0 },
  'gpt-4o-mini': { inputPer1m: 0.15, outputPer1m: 0.6 },
  'o3': { inputPer1m: 2.0, outputPer1m: 8.0 },
  'o4-mini': { inputPer1m: 1.1, outputPer1m: 4.4 },
  // Anthropic
  'claude-fable-5': { inputPer1m: 10.0, outputPer1m: 50.0 },
  'claude-opus-4-8': { inputPer1m: 5.0, outputPer1m: 25.0 },
  'claude-sonnet-5': { inputPer1m: 2.0, outputPer1m: 10.0 },
  'claude-haiku-4-5-20251001': { inputPer1m: 1.0, outputPer1m: 5.0 },
  'claude-opus-4-20250514': { inputPer1m: 15.0, outputPer1m: 75.0 },
  'claude-sonnet-4-20250514': { inputPer1m: 3.0, outputPer1m: 15.0 },
  'claude-3-5-haiku-20241022': { inputPer1m: 0.8, outputPer1m: 4.0 },
  // Google
  'gemini-3.5-flash': { inputPer1m: 1.5, outputPer1m: 9.0 },
  'gemini-3.1-pro-preview': { inputPer1m: 2.0, outputPer1m: 12.0 },
  'gemini-3-flash-preview': { inputPer1m: 0.5, outputPer1m: 3.0 },
  'gemini-3.1-flash-lite': { inputPer1m: 0.25, outputPer1m: 1.5 },
  'gemini-2.5-pro': { inputPer1m: 1.25, outputPer1m: 10.0 },
  'gemini-2.5-flash': { inputPer1m: 0.3, outputPer1m: 2.5 },
  'gemini-2.0-flash': { inputPer1m: 0.1, outputPer1m: 0.4 },
  'gemini-2.0-flash-lite': { inputPer1m: 0.075, outputPer1m: 0.3 },
}

/**
 * The full table: hand-maintained entries above, overlaid with the assistant's
 * catalogue. The catalogue is applied *last* and therefore wins on the ids it
 * covers — that is what guarantees the multiplier a customer picked by is the
 * one their credits were metered at. Ids it doesn't cover (native BYOK ids,
 * older models, analysis-only models) keep their entries above untouched.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  ...BASE_MODEL_PRICING,
  ...Object.fromEntries(CHATBOT_MODELS.map(m => [
    normalizeModelId(m.id),
    { inputPer1m: m.inputPer1m, outputPer1m: m.outputPer1m },
  ])),
}

/** Strip an OpenRouter-style `vendor/` prefix to get the bare model id. */
export function normalizeModelId(model: string): string {
  const slash = model.lastIndexOf('/')
  return slash >= 0 ? model.slice(slash + 1) : model
}

/** Look up a price for a model id, or `null` if we don't have one on file. */
export function getModelPrice(model: string): ModelPrice | null {
  return MODEL_PRICING[normalizeModelId(model)] ?? null
}

/**
 * Compute the cost of a run in **micro-dollars** (1e-6 USD), as an integer.
 *
 * Integer micro-dollars avoid floating-point drift when we sum thousands of
 * runs for budget enforcement. Returns `null` when the model is unpriced — the
 * caller stores null rather than a wrong number, and the budget gate treats an
 * unpriced model conservatively (see budget.ts).
 *
 * cost(USD) = tokens/1e6 * pricePer1m  ⇒  cost(µ$) = tokens * pricePer1m.
 */
export function computeCostUsdMicros(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const price = getModelPrice(model)
  if (!price) return null
  const micros = promptTokens * price.inputPer1m + completionTokens * price.outputPer1m
  return Math.round(micros)
}

/** Convenience: micro-dollars → USD number (for display / PostHog props). */
export function microsToUsd(micros: number): number {
  return micros / 1_000_000
}
