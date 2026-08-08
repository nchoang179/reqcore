/**
 * Chatbot credit accounting — the assistant's spend unit.
 *
 * A credit is the only assistant-usage number a customer ever sees. It exists so
 * the allowance can track what a turn genuinely costs us *without publishing
 * that cost*: the µ$ rate behind a credit (MICROS_PER_CREDIT) never leaves this
 * server. Not in an API response, not in an error string, not in a stream event.
 * If you ever need to surface a number to a user, surface a percentage — see
 * `creditPercentUsed`.
 *
 * Scope is deliberately the assistant alone. CV analysis keeps its own dollar
 * budget (MONTHLY_BUDGET_USD in budget.ts) and is untouched by anything here, so
 * the two surfaces have separate, independently tunable ceilings and heavy
 * chatbot use can no longer starve a customer's shortlist runs.
 */
import { creditMultiplier, findChatbotModel } from '../../../shared/chatbot-models'

/**
 * Real spend, in µ$, that one credit represents.
 *
 * Deliberately not a round fraction of a cent. At 1 credit = $0.01 (or $0.001) a
 * customer who ever learns one turn's true cost can derive the whole table from
 * a single observation; an off-denomination rate makes that inference useless
 * even if a cost estimate leaks.
 *
 * Retuning this does NOT restate history — credits are frozen onto each usage
 * row at write time, the same discipline pricing.ts applies to µ$ (see the
 * header there). Changing it only affects turns recorded afterwards.
 */
const MICROS_PER_CREDIT = 2_000

/**
 * Credits charged up front when a turn starts, before its real cost is known.
 * Reconciled to actual at the end of the stream (see `settleChatbotUsage`).
 * Sized a little above a typical turn so the common case never overdraws.
 *
 * This is the figure for the *baseline* model; scale it with
 * `estimatedTurnCredits` whenever the model is known.
 */
export const ESTIMATED_TURN_CREDITS = 30

/**
 * Up-front reservation for one turn on a specific model.
 *
 * A flat estimate was fine when every turn ran the same model. With a picker in
 * the composer it is not: reserving 30 credits for a turn that will cost ~360
 * leaves the gap invisible to concurrent turns, which is exactly the overdraw
 * the reservation exists to prevent. Scaling by the model's published
 * multiplier keeps the claim in the right order of magnitude; settlement still
 * corrects it to the real cost moments later.
 *
 * Unknown or BYOK models fall back to the flat estimate — we have no multiplier
 * for them, and a BYOK turn is the org's own bill anyway.
 */
export function estimatedTurnCredits(model: string): number {
  const option = findChatbotModel(model)
  if (!option) return ESTIMATED_TURN_CREDITS
  return Math.max(1, Math.ceil(ESTIMATED_TURN_CREDITS * creditMultiplier(option)))
}

/**
 * Monthly assistant credits for paid orgs, by plan. Free orgs do not use this
 * meter; they have an exact lifetime prompt count in budget.ts.
 *
 * These are roughly half of each plan's old shared MONTHLY_BUDGET_USD, so
 * splitting the assistant out into its own budget did not quietly double total
 * AI exposure per org. They are starting points — tune them off `aiUsageEvent`
 * once there is real per-customer usage data, not before.
 */
export const MONTHLY_CHATBOT_CREDITS: Record<string, number> = {
  default: 500,
  solo: 5_000,
  team: 15_000,
  scale: 50_000,
  agency: 125_000,
}

/** Resolve a paid plan's credit allowance. */
export function chatbotCreditAllowance(plan: string): number {
  return MONTHLY_CHATBOT_CREDITS[plan] ?? MONTHLY_CHATBOT_CREDITS.default!
}

/**
 * Convert real spend to credits, rounding up so a turn is never free.
 *
 * Throws on unpriced spend rather than returning 0. `computeCostUsdMicros`
 * returns null for a model missing from MODEL_PRICING, and a null there would
 * charge nothing — every turn free, every balance frozen, the whole gate
 * silently inert. Callers must fail closed instead; see `assertPricedModel`.
 */
export function creditsForMicros(micros: number): number {
  if (!Number.isFinite(micros) || micros < 0) {
    throw new Error(`Cannot convert unpriced or negative spend (${micros}µ$) to credits.`)
  }
  return Math.ceil(micros / MICROS_PER_CREDIT)
}

/**
 * Percentage of an allowance consumed, clamped to 0–100 and rounded.
 *
 * The only credit-derived number safe to send to a client: it is invariant to
 * MICROS_PER_CREDIT, so it reveals nothing about what a turn costs us.
 */
export function creditPercentUsed(used: number, allowance: number): number {
  if (!Number.isFinite(allowance) || allowance <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((used / allowance) * 100)))
}
