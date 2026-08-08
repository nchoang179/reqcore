/**
 * The assistant's selectable model catalogue — one vetted list, shared by the
 * server (pricing, validation) and the composer's picker (labels, multipliers).
 *
 * Scope is deliberately narrow: three frontier labs (Anthropic, OpenAI, and
 * Google), with a small set of vetted tiers. Every entry is reachable through
 * OpenRouter on the platform key, so this list is *only* meaningful for
 * platform-paid turns. A BYOK config brings its own model id and never consults
 * this file.
 *
 * ## Why the prices live here and not only in `MODEL_PRICING`
 *
 * A customer sees a model's cost as a **credit multiplier**, never as dollars.
 * That multiplier and the credits actually charged must come from the same
 * numbers, or the picker will promise "2.4×" while the ledger bills something
 * else. So this table is the source of truth: `pricing.ts` folds it into
 * `MODEL_PRICING` (catalogue wins on conflict) and the picker derives its
 * multiplier from the same rows.
 *
 * Publishing per-token prices to the client is safe and does not weaken the
 * credit unit. These are OpenRouter's public list prices — anyone can read them
 * — and a *ratio* between two public prices says nothing about MICROS_PER_CREDIT
 * (see the header in `server/utils/ai/credits.ts`), which is the number that
 * must stay server-side.
 *
 * ⚠️ Prices are list prices copied by hand and go stale. Re-check them against
 * https://openrouter.ai/models whenever you touch this file: an understated
 * price here understates every credit charge for that model.
 */

/** Which lab publishes the model. Drives grouping in the picker. */
export type ChatbotModelVendor = 'anthropic' | 'openai' | 'google' | 'xai'

/**
 * Cost/capability band within a vendor. Every model in the catalogue is a
 * frontier-lab model; the tier says how much of that lab's ceiling you get.
 */
export type ChatbotModelTier = 'expensive' | 'medium' | 'cheap'

export interface ChatbotModelOption {
  /** OpenRouter model slug — sent verbatim to the gateway. */
  id: string
  vendor: ChatbotModelVendor
  tier: ChatbotModelTier
  /** Human label for the picker. */
  label: string
  /** One line, plain English, aimed at a recruiter rather than an engineer. */
  description: string
  /** USD per 1M input tokens (OpenRouter list price). */
  inputPer1m: number
  /** USD per 1M output tokens (OpenRouter list price). */
  outputPer1m: number
  /**
   * LM Arena text score for this model (or its explicitly named Arena variant).
   * Kept optional because we must not borrow a nearby model's result when the
   * catalogue entry has no matching row in the supplied leaderboard data.
   */
  arenaTextScore?: number
}

/**
 * Highest score in the supplied LM Arena text data. Intelligence is normalized
 * across the top 20% of this score: 80% of the leader maps to 0 intelligence,
 * and the leader maps to 100.
 */
export const CHATBOT_ARENA_TEXT_LEADER_SCORE = 1507
export const CHATBOT_ARENA_TEXT_NORMALIZATION_RANGE = 0.2

export const CHATBOT_MODEL_VENDOR_LABELS: Record<ChatbotModelVendor, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
}

export const CHATBOT_MODEL_TIER_LABELS: Record<ChatbotModelTier, string> = {
  expensive: 'Most capable',
  medium: 'Balanced',
  cheap: 'Fastest',
}

/**
 * The catalogue. Ordered vendor-major, then most capable first — the picker
 * renders it in this order, so the list here *is* the menu layout.
 */
export const CHATBOT_MODELS: readonly ChatbotModelOption[] = [
  // ── Anthropic ──
  {
    id: 'anthropic/claude-opus-5',
    vendor: 'anthropic',
    tier: 'expensive',
    label: 'Claude Opus 5',
    description: 'Anthropic\'s flagship for the hardest analysis and long-horizon work.',
    inputPer1m: 5.0,
    outputPer1m: 25.0,
    // LM Arena reports this score for the claude-opus-5-high variant.
    arenaTextScore: 1493,
  },
  {
    id: 'anthropic/claude-sonnet-5',
    vendor: 'anthropic',
    tier: 'medium',
    label: 'Claude Sonnet 5',
    description: 'Strong analysis for demanding shortlisting calls and long documents.',
    inputPer1m: 2.0,
    outputPer1m: 10.0,
    arenaTextScore: 1463,
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    vendor: 'anthropic',
    tier: 'cheap',
    label: 'Claude Haiku 4.5',
    description: 'Quick answers and lookups when you don\'t need deep reasoning.',
    inputPer1m: 1.0,
    outputPer1m: 5.0,
    arenaTextScore: 1412,
  },

  // ── OpenAI ──
  {
    id: 'openai/gpt-5.5',
    vendor: 'openai',
    tier: 'expensive',
    label: 'GPT-5.5',
    description: 'OpenAI\'s flagship — best for complex, multi-candidate comparisons.',
    inputPer1m: 5.0,
    outputPer1m: 30.0,
    arenaTextScore: 1477,
  },
  {
    id: 'openai/gpt-5.4',
    vendor: 'openai',
    tier: 'medium',
    label: 'GPT-5.4',
    description: 'Frontier quality for everyday hiring work, cheaper than GPT-5.5.',
    inputPer1m: 2.5,
    outputPer1m: 15.0,
    arenaTextScore: 1465,
  },
  {
    id: 'openai/gpt-5.4-mini',
    vendor: 'openai',
    tier: 'cheap',
    label: 'GPT-5.4 Mini',
    description: 'Fast and inexpensive for quick, high-volume recruiting questions.',
    inputPer1m: 0.75,
    outputPer1m: 4.5,
    arenaTextScore: 1448,
  },

  // ── Google ──
  {
    id: 'google/gemini-3.1-pro-preview',
    vendor: 'google',
    tier: 'expensive',
    label: 'Gemini 3.1 Pro',
    description: 'Google\'s strongest reasoning model, good with very long context.',
    inputPer1m: 2.0,
    outputPer1m: 12.0,
    arenaTextScore: 1487,
  },
  {
    id: 'google/gemini-3.6-flash',
    vendor: 'google',
    tier: 'medium',
    label: 'Gemini 3.6 Flash',
    description: 'The default — quick, strong on long candidate histories.',
    inputPer1m: 1.5,
    outputPer1m: 7.5,
    arenaTextScore: 1485,
  },
  {
    id: 'google/gemini-3.5-flash',
    vendor: 'google',
    tier: 'medium',
    label: 'Gemini 3.5 Flash',
    description: 'Fast, capable all-rounder that handles large CV batches well.',
    inputPer1m: 1.5,
    outputPer1m: 9.0,
    arenaTextScore: 1476,
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    vendor: 'google',
    tier: 'cheap',
    label: 'Gemini 3.5 Flash-Lite',
    description: 'Fast, cost-efficient answers for focused questions and document lookups.',
    inputPer1m: 0.3,
    outputPer1m: 2.5,
    arenaTextScore: 1459,
  },
]

/**
 * The model a platform turn uses when nothing is pinned, and the 1.0× anchor for
 * every multiplier. Changing it re-bases the whole table the customer sees, so
 * change it deliberately.
 */
export const DEFAULT_CHATBOT_MODEL_ID = 'google/gemini-3.6-flash'

/** The only platform model available to hosted Free-plan workspaces. */
export const FREE_PLAN_CHATBOT_MODEL_ID = 'google/gemini-3.5-flash-lite'

/**
 * Input:output token ratio assumed when collapsing a two-number price into the
 * single figure a multiplier can be built from.
 *
 * 4:1 reflects how this assistant actually runs: tool results (job records, CVs,
 * scoring breakdowns) dominate the prompt while the visible answer is short.
 * A naive average would over-weight output and make cheap models look dearer
 * than they bill.
 */
const INPUT_WEIGHT = 4
const OUTPUT_WEIGHT = 1

/** Effective USD per 1M tokens for a typical assistant turn. */
export function blendedPricePer1m(model: Pick<ChatbotModelOption, 'inputPer1m' | 'outputPer1m'>): number {
  return (model.inputPer1m * INPUT_WEIGHT + model.outputPer1m * OUTPUT_WEIGHT)
    / (INPUT_WEIGHT + OUTPUT_WEIGHT)
}

export function findChatbotModel(id: string | null | undefined): ChatbotModelOption | null {
  if (!id) return null
  return CHATBOT_MODELS.find(m => m.id === id) ?? null
}

export function isChatbotCatalogueModel(id: string | null | undefined): boolean {
  return findChatbotModel(id) !== null
}

const DEFAULT_MODEL = findChatbotModel(DEFAULT_CHATBOT_MODEL_ID)
if (!DEFAULT_MODEL) {
  throw new Error(`DEFAULT_CHATBOT_MODEL_ID "${DEFAULT_CHATBOT_MODEL_ID}" is not in CHATBOT_MODELS.`)
}
const BASELINE_BLENDED_PRICE = blendedPricePer1m(DEFAULT_MODEL)

/**
 * How much faster this model burns credits than the default, e.g. `2.4` means a
 * turn costs roughly 2.4× the credits the same turn would on the baseline model.
 *
 * "Roughly" is load-bearing: the real charge is metered from the turn's actual
 * tokens, so a prompt-heavy turn on a model with cheap input lands below its
 * multiplier and an essay-length answer lands above it. The multiplier is a
 * planning aid for choosing a model, not a quoted price — the picker says
 * "about" for exactly this reason.
 */
export function creditMultiplier(model: ChatbotModelOption): number {
  const ratio = blendedPricePer1m(model) / BASELINE_BLENDED_PRICE
  // One decimal keeps sub-baseline models (0.3×) legible without implying a
  // precision the token-metered charge doesn't have.
  return Math.max(0.1, Math.round(ratio * 10) / 10)
}

/**
 * Relative intelligence from the supplied LM Arena text leaderboard, rescaled
 * so only the top 20% of the leader's score occupies the full 0–100 range.
 * One decimal retains useful separation between frontier models. Scores outside
 * the window are clamped; missing scores remain null instead of being inferred
 * from another model in the same family.
 */
export function intelligencePercentage(
  model: Pick<ChatbotModelOption, 'arenaTextScore'>,
): number | null {
  if (model.arenaTextScore === undefined) return null
  const floor = CHATBOT_ARENA_TEXT_LEADER_SCORE
    * (1 - CHATBOT_ARENA_TEXT_NORMALIZATION_RANGE)
  const normalized = (model.arenaTextScore - floor)
    / (CHATBOT_ARENA_TEXT_LEADER_SCORE - floor)
    * 100
  return Math.min(100, Math.max(0, Math.round(normalized * 10) / 10))
}

/** Catalogue entry plus its multiplier — what the picker actually renders. */
export interface ChatbotModelChoice extends ChatbotModelOption {
  multiplier: number
  intelligence: number | null
  isDefault: boolean
}

export function chatbotModelChoices(): ChatbotModelChoice[] {
  return CHATBOT_MODELS.map(m => ({
    ...m,
    multiplier: creditMultiplier(m),
    intelligence: intelligencePercentage(m),
    isDefault: m.id === DEFAULT_CHATBOT_MODEL_ID,
  }))
}
