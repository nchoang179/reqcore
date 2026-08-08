/**
 * The model picker makes two promises the customer can't verify themselves:
 * that every model on offer can actually be charged for, and that the "about N×"
 * multiplier next to it reflects what it will spend. Both are structural — they
 * hold because the catalogue is the single source for the price table and the
 * multiplier alike — so these tests pin the structure, not the numbers.
 */
import { describe, expect, it } from 'vitest'
import {
  CHATBOT_MODELS,
  CHATBOT_ARENA_TEXT_LEADER_SCORE,
  CHATBOT_ARENA_TEXT_NORMALIZATION_RANGE,
  CHATBOT_MODEL_TIER_LABELS,
  CHATBOT_MODEL_VENDOR_LABELS,
  DEFAULT_CHATBOT_MODEL_ID,
  blendedPricePer1m,
  chatbotModelChoices,
  creditMultiplier,
  findChatbotModel,
  intelligencePercentage,
  isChatbotCatalogueModel,
  type ChatbotModelTier,
  type ChatbotModelVendor,
} from '../../shared/chatbot-models'
import { computeCostUsdMicros, getModelPrice } from '../../server/utils/ai/pricing'
import { ESTIMATED_TURN_CREDITS, estimatedTurnCredits } from '../../server/utils/ai/credits'

const VENDORS: ChatbotModelVendor[] = ['anthropic', 'openai', 'google', 'xai']
const TIERS: ChatbotModelTier[] = ['expensive', 'medium', 'cheap']

describe('catalogue shape', () => {
  it('covers every tier for every vendor', () => {
    // At least one, not exactly one: a vendor may list two models in a band
    // while an older generation is still offered alongside its successor. What
    // must never happen is a vendor with a missing price band, which would make
    // "cheap" unreachable for that lab.
    for (const vendor of VENDORS) {
      for (const tier of TIERS) {
        const matches = CHATBOT_MODELS.filter(m => m.vendor === vendor && m.tier === tier)
        expect(matches.length, `${vendor}/${tier}`).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('has no duplicate model ids', () => {
    const ids = CHATBOT_MODELS.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('offers Gemini 3.6 Flash', () => {
    expect(findChatbotModel('google/gemini-3.6-flash')).toMatchObject({
      label: 'Gemini 3.6 Flash',
      vendor: 'google',
      tier: 'medium',
      inputPer1m: 1.5,
      outputPer1m: 7.5,
    })
  })

  it('labels every vendor and tier it uses', () => {
    for (const m of CHATBOT_MODELS) {
      expect(CHATBOT_MODEL_VENDOR_LABELS[m.vendor]).toBeTruthy()
      expect(CHATBOT_MODEL_TIER_LABELS[m.tier]).toBeTruthy()
    }
  })

  it('orders tiers by real cost within each vendor', () => {
    // The tier label is the only cost signal a non-technical user reads before
    // the multiplier. A "Fastest" model that bills more than the "Most capable"
    // one would be an outright lie. Checked across whole bands, so a second
    // model in a tier can't quietly overlap the band above it.
    for (const vendor of VENDORS) {
      const band = (tier: ChatbotModelTier) =>
        CHATBOT_MODELS.filter(m => m.vendor === vendor && m.tier === tier).map(blendedPricePer1m)
      const cheap = band('cheap')
      const medium = band('medium')
      const expensive = band('expensive')
      expect(Math.max(...cheap), `${vendor} cheap/medium`).toBeLessThan(Math.min(...medium))
      expect(Math.max(...medium), `${vendor} medium/expensive`).toBeLessThanOrEqual(Math.min(...expensive))
    }
  })
})

describe('pricing coverage', () => {
  it('prices every catalogue model, so no turn escapes the credit gate', () => {
    // assertPricedModel refuses a platform turn on an unpriced model. Shipping a
    // model in the picker that fails that check is a 503 for a choice we offered.
    for (const m of CHATBOT_MODELS) {
      expect(getModelPrice(m.id), m.id).not.toBeNull()
    }
  })

  it('charges at the catalogue price, not a stale duplicate elsewhere', () => {
    // MODEL_PRICING also carries hand-maintained entries for bare ids. The
    // catalogue is overlaid last precisely so the number shown in the picker and
    // the number billed cannot come from different rows.
    for (const m of CHATBOT_MODELS) {
      const price = getModelPrice(m.id)!
      expect(price.inputPer1m, m.id).toBe(m.inputPer1m)
      expect(price.outputPer1m, m.id).toBe(m.outputPer1m)
    }
  })

  it('bills a turn in proportion to the multiplier it advertised', () => {
    // Same turn shape on every model, at the 4:1 input:output ratio the
    // multiplier assumes. The realised cost ratio should land on the advertised
    // multiplier, within the rounding the picker applies.
    const baseline = findChatbotModel(DEFAULT_CHATBOT_MODEL_ID)!
    const baselineCost = computeCostUsdMicros(baseline.id, 40_000, 10_000)!
    for (const m of CHATBOT_MODELS) {
      const cost = computeCostUsdMicros(m.id, 40_000, 10_000)!
      expect(cost / baselineCost, m.id).toBeCloseTo(creditMultiplier(m), 1)
    }
  })
})

describe('creditMultiplier', () => {
  it('anchors the default model at 1×', () => {
    expect(creditMultiplier(findChatbotModel(DEFAULT_CHATBOT_MODEL_ID)!)).toBe(1)
  })

  it('never rounds a model down to free', () => {
    for (const m of chatbotModelChoices()) {
      expect(m.multiplier, m.id).toBeGreaterThan(0)
    }
  })

  it('marks exactly one choice as the default', () => {
    expect(chatbotModelChoices().filter(m => m.isDefault)).toHaveLength(1)
  })

  it('uses Gemini 3.6 Flash as the catalogue default', () => {
    expect(DEFAULT_CHATBOT_MODEL_ID).toBe('google/gemini-3.6-flash')
    expect(chatbotModelChoices().find(m => m.isDefault)?.label).toBe('Gemini 3.6 Flash')
  })
})

describe('intelligencePercentage', () => {
  it('anchors the supplied LM Arena text leader at 100%', () => {
    const fable = findChatbotModel('anthropic/claude-fable-5')!
    expect(fable.arenaTextScore).toBe(CHATBOT_ARENA_TEXT_LEADER_SCORE)
    expect(intelligencePercentage(fable)).toBe(100)
  })

  it('normalizes the leader score\'s top 20% across the full percentage scale', () => {
    expect(CHATBOT_ARENA_TEXT_NORMALIZATION_RANGE).toBe(0.2)
    expect(intelligencePercentage(findChatbotModel('google/gemini-3.6-flash')!)).toBe(92.7)
    expect(intelligencePercentage(findChatbotModel('anthropic/claude-sonnet-5')!)).toBe(85.4)
    expect(intelligencePercentage(findChatbotModel('x-ai/grok-4')!)).toBe(67.5)
  })

  it('clamps scores outside the normalization window', () => {
    const floor = CHATBOT_ARENA_TEXT_LEADER_SCORE
      * (1 - CHATBOT_ARENA_TEXT_NORMALIZATION_RANGE)
    expect(intelligencePercentage({ arenaTextScore: floor })).toBe(0)
    expect(intelligencePercentage({ arenaTextScore: floor - 100 })).toBe(0)
    expect(intelligencePercentage({ arenaTextScore: CHATBOT_ARENA_TEXT_LEADER_SCORE + 100 })).toBe(100)
  })

  it('does not assign a nearby model\'s score when no matching row was supplied', () => {
    expect(intelligencePercentage(findChatbotModel('google/gemini-3.1-flash-lite')!)).toBeNull()
  })

  it('exposes the derived value on picker choices', () => {
    for (const choice of chatbotModelChoices()) {
      expect(choice.intelligence).toBe(intelligencePercentage(choice))
    }
  })
})

describe('estimatedTurnCredits', () => {
  it('scales the up-front reservation with the chosen model', () => {
    // A flat reservation would let an expensive model's real cost land far above
    // what concurrent turns could see, which is the overdraw the reservation
    // exists to prevent.
    const fable = findChatbotModel('anthropic/claude-fable-5')!
    expect(estimatedTurnCredits(fable.id))
      .toBe(Math.ceil(ESTIMATED_TURN_CREDITS * creditMultiplier(fable)))
    expect(estimatedTurnCredits(fable.id)).toBeGreaterThan(estimatedTurnCredits(DEFAULT_CHATBOT_MODEL_ID))
  })

  it('falls back to the flat estimate for a BYOK or unknown model', () => {
    expect(estimatedTurnCredits('some-org/private-model')).toBe(ESTIMATED_TURN_CREDITS)
  })

  it('always reserves at least one credit', () => {
    for (const m of CHATBOT_MODELS) {
      expect(estimatedTurnCredits(m.id), m.id).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('isChatbotCatalogueModel', () => {
  it('accepts only catalogue ids — the gate on a request-supplied model', () => {
    // An arbitrary id here would route platform-paid traffic anywhere on
    // OpenRouter, including models with no price on file.
    expect(isChatbotCatalogueModel(DEFAULT_CHATBOT_MODEL_ID)).toBe(true)
    expect(isChatbotCatalogueModel('openai/gpt-4o')).toBe(false)
    expect(isChatbotCatalogueModel('')).toBe(false)
    expect(isChatbotCatalogueModel(null)).toBe(false)
    expect(isChatbotCatalogueModel(undefined)).toBe(false)
  })
})
