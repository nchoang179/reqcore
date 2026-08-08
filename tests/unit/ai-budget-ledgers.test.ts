/**
 * The two AI surfaces are metered in different units against different ledgers,
 * and getting that wiring wrong costs real money quietly. These tests pin:
 *
 *  - the assistant is metered in **credits** (aiUsageEvent.credits_charged),
 *  - analysis is metered in **dollars** and no longer double-counts assistant
 *    spend,
 *  - the global daily kill-switch still sees every dollar from both ledgers,
 *  - and no customer-facing refusal leaks a cost figure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiUsageEvent, analysisRun } from '../../server/database/schema'

const state = vi.hoisted(() => ({
  plan: 'solo' as string,
  billingDisabled: false,
  /** Platform spend in µ$, per ledger table. */
  spend: new Map<unknown, number>(),
  /** What each table's `count(*)` query returns. */
  counts: new Map<unknown, number>(),
  /** Assistant credits already charged to the org. */
  credits: 0,
  queriedTables: [] as unknown[],
}))

vi.mock('../../server/utils/billing/plan', () => ({
  resolveOrgPlanId: vi.fn(async () => state.plan),
  isBillingDisabled: vi.fn(() => state.billingDisabled),
}))

/**
 * Minimal drizzle stub for the gate's three query shapes, all of which select a
 * single `total`. They're told apart by the rendered SQL: `count(*)` is a run
 * counter, a sum over `credits_charged` is the assistant allowance, anything
 * else summed is a µ$ spend total.
 *
 * Reads the literal chunks of the drizzle `sql` template plus each chunk's
 * column name — walking the object graph instead would hit the table ⇄ column
 * cycle.
 */
type QueryKind = 'count' | 'credits' | 'spend'

function queryKind(projection: unknown): QueryKind {
  const total = (projection as { total?: { queryChunks?: unknown[] } } | undefined)?.total
  const chunks = total?.queryChunks ?? []
  let text = ''
  for (const chunk of chunks) {
    const value = (chunk as { value?: unknown } | null)?.value
    if (Array.isArray(value)) text += value.join('')
    else if (value != null) text += String(value)
    const name = (chunk as { name?: unknown } | null)?.name
    if (typeof name === 'string') text += name
  }
  if (text.includes('count(')) return 'count'
  if (text.includes('credits_charged')) return 'credits'
  return 'spend'
}

import {
  assertChatbotAllowance,
  assertPlatformBudget,
  assertPricedModel,
  BudgetExceededError,
  getChatbotCreditUsage,
} from '../../server/utils/ai/budget'
import { MONTHLY_CHATBOT_CREDITS, FREE_PLAN_CHATBOT_CREDITS } from '../../server/utils/ai/credits'

beforeEach(() => {
  state.plan = 'solo'
  state.billingDisabled = false
  state.spend = new Map()
  state.counts = new Map()
  state.credits = 0
  state.queriedTables = []

  vi.stubGlobal('db', {
    select: (projection: unknown) => ({
      from: (table: unknown) => {
        state.queriedTables.push(table)
        const kind = queryKind(projection)
        const total = kind === 'count'
          ? state.counts.get(table) ?? 0
          : kind === 'credits'
            ? state.credits
            : state.spend.get(table) ?? 0
        return { where: async () => [{ total: String(total) }] }
      },
    }),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('assistant credit allowance', () => {
  it('lets a paid org under its monthly allowance through', async () => {
    state.credits = MONTHLY_CHATBOT_CREDITS.solo! - 1
    await expect(assertChatbotAllowance('org-1', 'platform')).resolves.toBeUndefined()
  })

  it('blocks a paid org that has spent its monthly allowance', async () => {
    state.credits = MONTHLY_CHATBOT_CREDITS.solo!
    await expect(assertChatbotAllowance('org-1', 'platform'))
      .rejects.toThrow(BudgetExceededError)
  })

  it('lets a free org under its lifetime grant through', async () => {
    state.plan = 'free'
    state.credits = FREE_PLAN_CHATBOT_CREDITS - 1
    await expect(assertChatbotAllowance('org-1', 'platform')).resolves.toBeUndefined()
  })

  it('blocks a free org that has spent its lifetime grant', async () => {
    state.plan = 'free'
    state.credits = FREE_PLAN_CHATBOT_CREDITS
    await expect(assertChatbotAllowance('org-1', 'platform'))
      .rejects.toThrow(/free assistant credits/i)
  })

  it('honours AI_FREE_PLAN_CHATBOT_CREDITS', async () => {
    vi.stubEnv('AI_FREE_PLAN_CHATBOT_CREDITS', '50')
    state.plan = 'free'
    state.credits = 50
    await expect(assertChatbotAllowance('org-1', 'platform'))
      .rejects.toThrow(BudgetExceededError)
    vi.unstubAllEnvs()
  })

  it('reports the same scope for free and paid refusals', async () => {
    // The scope reaches the client in the 429 payload. Telling a Free grant
    // apart from a paid allowance there would let a customer infer where their
    // plan's ceiling sits.
    state.plan = 'free'
    state.credits = FREE_PLAN_CHATBOT_CREDITS
    await expect(assertChatbotAllowance('org-1', 'platform'))
      .rejects.toMatchObject({ scope: 'org_chatbot_credits' })

    state.plan = 'solo'
    state.credits = MONTHLY_CHATBOT_CREDITS.solo!
    await expect(assertChatbotAllowance('org-1', 'platform'))
      .rejects.toMatchObject({ scope: 'org_chatbot_credits' })
  })

  it('never puts a cost or balance figure in a refusal', async () => {
    // These strings are rendered verbatim in the chat UI. A dollar amount or a
    // raw credit count there discloses the margin the credit unit exists to
    // keep private.
    for (const plan of ['free', 'solo', 'team', 'scale']) {
      state.plan = plan
      state.credits = 10_000_000
      await expect(assertChatbotAllowance('org-1', 'platform'))
        .rejects.toThrow(expect.objectContaining({
          message: expect.not.stringMatching(/\$|\d/),
        }))
    }
  })

  it('points a capped paid org at BYOK rather than at an upgrade', async () => {
    state.credits = MONTHLY_CHATBOT_CREDITS.solo!
    await expect(assertChatbotAllowance('org-1', 'platform'))
      .rejects.toThrow(/your own AI key/i)
  })

  it('caps a free org even on its own key — BYOK is not a free escape hatch', async () => {
    // Free orgs can no longer create BYOK configs, but ones grandfathered in
    // before that rule must not get the uncapped assistant for nothing.
    state.plan = 'free'
    state.credits = FREE_PLAN_CHATBOT_CREDITS
    await expect(assertChatbotAllowance('org-1', 'byok'))
      .rejects.toThrow(BudgetExceededError)
  })

  it('never caps a paid org on its own key', async () => {
    state.credits = 9_999_999
    await expect(assertChatbotAllowance('org-1', 'byok')).resolves.toBeUndefined()
  })

  it('does not apply the allowance on a billing-disabled instance', async () => {
    state.plan = 'free'
    state.billingDisabled = true
    state.credits = 9_999_999
    await expect(assertChatbotAllowance('org-1', 'byok')).resolves.toBeUndefined()
    await expect(assertChatbotAllowance('org-1', 'platform')).resolves.toBeUndefined()
  })

  it('still applies the global daily kill-switch to assistant turns', async () => {
    state.spend.set(analysisRun, 25_000_000) // $25 default cap, spent on analysis
    await expect(assertChatbotAllowance('org-1', 'platform'))
      .rejects.toMatchObject({ scope: 'global_daily' })
  })
})

describe('getChatbotCreditUsage', () => {
  it('reports usage against the plan allowance', async () => {
    state.credits = 2_500
    await expect(getChatbotCreditUsage('org-1', 'solo')).resolves.toEqual({
      used: 2_500,
      allowance: MONTHLY_CHATBOT_CREDITS.solo,
    })
  })

  it('reports the lifetime grant for a free org', async () => {
    state.credits = 100
    await expect(getChatbotCreditUsage('org-1', 'free')).resolves.toEqual({
      used: 100,
      allowance: FREE_PLAN_CHATBOT_CREDITS,
    })
  })
})

describe('analysis budget no longer shares a pot with the assistant', () => {
  it('does not count assistant spend against the analysis monthly cap', async () => {
    // The surfaces were split precisely so heavy assistant use stops starving
    // an org's shortlist runs.
    state.spend.set(aiUsageEvent, 20_000_000) // $20 of assistant spend
    state.spend.set(analysisRun, 0)
    await expect(assertPlatformBudget('org-1')).resolves.toBeUndefined()
  })

  it('still enforces the analysis monthly cap from analysis spend', async () => {
    state.spend.set(analysisRun, 20_000_000) // the whole $20 Solo cap
    await expect(assertPlatformBudget('org-1')).rejects.toThrow(BudgetExceededError)
  })

  it('does not quote the dollar cap to the customer', async () => {
    state.spend.set(analysisRun, 20_000_000)
    await expect(assertPlatformBudget('org-1'))
      .rejects.toThrow(expect.objectContaining({
        message: expect.not.stringMatching(/\$/),
      }))
  })

  it('still enforces the free run allowance for analysis', async () => {
    state.plan = 'free'
    state.counts.set(analysisRun, 9_999)
    await expect(assertPlatformBudget('org-1')).rejects.toThrow(/free AI analysis runs/i)
  })

  it('does not meter analysis against the assistant allowance', async () => {
    state.plan = 'free'
    state.credits = 9_999_999
    await expect(assertPlatformBudget('org-1')).resolves.toBeUndefined()
  })

  it('keeps the daily kill-switch summing both ledgers', async () => {
    // Unlike the per-org caps, this one guards the real OpenRouter invoice and
    // must see assistant dollars too.
    state.spend.set(aiUsageEvent, 25_000_000)
    state.spend.set(analysisRun, 0)
    await expect(assertPlatformBudget('org-1'))
      .rejects.toMatchObject({ scope: 'global_daily' })
    expect(state.queriedTables).toContain(aiUsageEvent)
    expect(state.queriedTables).toContain(analysisRun)
  })
})

describe('assertPricedModel', () => {
  it('allows a model that is in the price table', () => {
    expect(() => assertPricedModel('openai/gpt-5.4-mini')).not.toThrow()
  })

  it('refuses an unpriced model rather than charging nothing for it', () => {
    // The failure this prevents: null cost → zero credits → every balance frozen
    // and the daily kill-switch inert, with no error anywhere.
    expect(() => assertPricedModel('google/gemini-9.9-imaginary')).toThrow()
  })

  it('does not name the model or the reason to the customer', () => {
    try {
      assertPricedModel('google/gemini-9.9-imaginary')
      expect.unreachable('should have thrown')
    }
    catch (err) {
      const message = (err as { statusMessage?: string }).statusMessage ?? ''
      expect(message).not.toMatch(/gemini|price|model/i)
    }
  })
})
