/**
 * Credits are the customer-facing unit for the assistant, and the whole point of
 * them is that they track real cost *without* disclosing it. These tests pin the
 * conversion's safety properties: a turn is never free, unpriced spend is never
 * silently treated as zero, and nothing derived for the client depends on the
 * µ$-per-credit rate.
 */
import { describe, expect, it } from 'vitest'
import {
  chatbotCreditAllowance,
  creditPercentUsed,
  creditsForMicros,
  MONTHLY_CHATBOT_CREDITS,
} from '../../server/utils/ai/credits'
import { BILLING_PLANS } from '../../shared/billing'

describe('creditsForMicros', () => {
  it('rounds up so a turn is never free', () => {
    expect(creditsForMicros(1)).toBe(1)
  })

  it('charges nothing only for genuinely zero spend', () => {
    expect(creditsForMicros(0)).toBe(0)
  })

  it('scales linearly with spend', () => {
    const one = creditsForMicros(100_000)
    const two = creditsForMicros(200_000)
    expect(two).toBe(one * 2)
  })

  it('throws rather than charging zero for unpriced spend', () => {
    // The failure mode this guards: computeCostUsdMicros returns null for a
    // model missing from MODEL_PRICING. Coercing that to 0 would freeze every
    // balance and silently disable the gate.
    expect(() => creditsForMicros(Number.NaN)).toThrow()
    expect(() => creditsForMicros(-1)).toThrow()
  })
})

describe('creditPercentUsed', () => {
  it('reports a plain percentage', () => {
    expect(creditPercentUsed(25, 100)).toBe(25)
    expect(creditPercentUsed(1_000, 4_000)).toBe(25)
  })

  it('clamps to 0–100 so an overdraw does not render past full', () => {
    expect(creditPercentUsed(500, 100)).toBe(100)
    expect(creditPercentUsed(-5, 100)).toBe(0)
  })

  it('is invariant to the allowance size — the reason it is safe to expose', () => {
    // Two orgs on different allowances, both a quarter of the way through, look
    // identical to the client. Nothing about cost per turn is recoverable.
    expect(creditPercentUsed(125, 500)).toBe(creditPercentUsed(12_500, 50_000))
  })

  it('treats a missing allowance as unused rather than exhausted', () => {
    expect(creditPercentUsed(10, 0)).toBe(0)
  })
})

describe('chatbotCreditAllowance', () => {
  it('gives every self-serve plan a positive allowance', () => {
    for (const plan of BILLING_PLANS) {
      expect(chatbotCreditAllowance(plan.id)).toBeGreaterThan(0)
    }
  })

  it('grows monotonically with plan tier', () => {
    expect(MONTHLY_CHATBOT_CREDITS.solo!).toBeLessThan(MONTHLY_CHATBOT_CREDITS.team!)
    expect(MONTHLY_CHATBOT_CREDITS.team!).toBeLessThan(MONTHLY_CHATBOT_CREDITS.scale!)
  })

  it('falls back to the default allowance for an unknown plan', () => {
    expect(chatbotCreditAllowance('not-a-plan')).toBe(MONTHLY_CHATBOT_CREDITS.default)
  })

  it('does not define a token-priced Free allowance', () => {
    expect(chatbotCreditAllowance('free')).toBe(MONTHLY_CHATBOT_CREDITS.default)
  })
})
