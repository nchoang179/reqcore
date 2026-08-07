/**
 * The budget gate sums platform spend from two ledgers: `analysisRun` (scoring)
 * and `aiUsageEvent` (assistant turns). Spend it can't see is spend it can't
 * cap, so these tests pin that both tables are consulted and that the assistant
 * is metered by dollars rather than by the analysis run-count allowance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiUsageEvent, analysisRun } from '../../server/database/schema'

const state = vi.hoisted(() => ({
  plan: 'solo' as string,
  billingDisabled: false,
  /** Platform spend in µ$, per ledger table. */
  spend: new Map<unknown, number>(),
  /** What each table's `count(*)` query returns — analysis runs vs. assistant turns. */
  counts: new Map<unknown, number>(),
  queriedTables: [] as unknown[],
}))

vi.mock('../../server/utils/billing/plan', () => ({
  resolveOrgPlanId: vi.fn(async () => state.plan),
  isBillingDisabled: vi.fn(() => state.billingDisabled),
}))

/**
 * Minimal drizzle stub for the gate's two query shapes, both of which select a
 * single `total` and are told apart by their aggregate: `count(*)` is the
 * free-tier run counter, `sum(...)` is a spend total.
 */
function isCountQuery(projection: unknown): boolean {
  // Read the literal chunks of the drizzle `sql` template. Walking the object
  // graph instead would hit the table ⇄ column cycle.
  const total = (projection as { total?: { queryChunks?: unknown[] } } | undefined)?.total
  const chunks = total?.queryChunks ?? []
  return chunks.some((chunk) => {
    const value = (chunk as { value?: unknown } | null)?.value
    const text = Array.isArray(value) ? value.join('') : String(value ?? '')
    return text.includes('count(')
  })
}

import {
  assertChatbotAllowance,
  assertPlatformBudget,
  BudgetExceededError,
} from '../../server/utils/ai/budget'

beforeEach(() => {
  state.plan = 'solo'
  state.billingDisabled = false
  state.spend = new Map()
  state.counts = new Map()
  state.queriedTables = []

  vi.stubGlobal('db', {
    select: (projection: unknown) => ({
      from: (table: unknown) => {
        state.queriedTables.push(table)
        const total = isCountQuery(projection)
          ? state.counts.get(table) ?? 0
          : state.spend.get(table) ?? 0
        return { where: async () => [{ total: String(total) }] }
      },
    }),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('assertPlatformBudget ledger coverage', () => {
  it('sums both the analysis and assistant ledgers', async () => {
    await assertPlatformBudget('org-1', { feature: 'chatbot' })
    expect(state.queriedTables).toContain(analysisRun)
    expect(state.queriedTables).toContain(aiUsageEvent)
  })

  it('blocks a Solo org whose assistant spend alone exhausts the monthly cap', async () => {
    // $20 Solo cap, all of it spent in the assistant and none in analysis.
    state.spend.set(aiUsageEvent, 20_000_000)
    state.spend.set(analysisRun, 0)
    await expect(assertPlatformBudget('org-1', { feature: 'chatbot' }))
      .rejects.toThrow(BudgetExceededError)
  })

  it('blocks an analysis run once assistant spend has eaten the cap', async () => {
    // The two surfaces share one budget — assistant spend must count against
    // analysis too, or the cap is bypassable by alternating between them.
    state.spend.set(aiUsageEvent, 20_000_000)
    await expect(assertPlatformBudget('org-1')).rejects.toThrow(BudgetExceededError)
  })

  it('lets a Solo org under the cap through', async () => {
    state.spend.set(aiUsageEvent, 1_000_000) // $1 of a $20 cap
    await expect(assertPlatformBudget('org-1', { feature: 'chatbot' })).resolves.toBeUndefined()
  })

  it('points a capped assistant user at BYOK rather than at an upgrade', async () => {
    state.spend.set(aiUsageEvent, 20_000_000)
    await expect(assertPlatformBudget('org-1', { feature: 'chatbot' }))
      .rejects.toThrow(/add your own AI key/i)
  })

  it('does not meter the assistant against the free analysis-run allowance', async () => {
    // The two free allowances are separate products: burning every shortlist
    // run must not silence the assistant.
    state.plan = 'free'
    state.counts.set(analysisRun, 9_999)
    await expect(assertPlatformBudget('org-1', { feature: 'chatbot' })).resolves.toBeUndefined()
  })

  it('does not meter analysis against the free assistant allowance either', async () => {
    state.plan = 'free'
    state.counts.set(aiUsageEvent, 9_999)
    await expect(assertPlatformBudget('org-1')).resolves.toBeUndefined()
  })

  it('still enforces the free run allowance for analysis', async () => {
    state.plan = 'free'
    state.counts.set(analysisRun, 9_999)
    await expect(assertPlatformBudget('org-1')).rejects.toThrow(/free AI analysis runs/i)
  })
})

describe('free-tier assistant turn allowance', () => {
  it('lets a free org through below the 20-turn cap', async () => {
    state.plan = 'free'
    state.counts.set(aiUsageEvent, 19)
    await expect(assertChatbotAllowance('org-1', 'platform')).resolves.toBeUndefined()
  })

  it('blocks the 21st turn with an upgrade prompt', async () => {
    state.plan = 'free'
    state.counts.set(aiUsageEvent, 20)
    await expect(assertChatbotAllowance('org-1', 'platform'))
      .rejects.toThrow(/free assistant messages/i)
  })

  it('tags the refusal so the client can tell it from a spend cap', async () => {
    state.plan = 'free'
    state.counts.set(aiUsageEvent, 20)
    await expect(assertChatbotAllowance('org-1', 'platform'))
      .rejects.toMatchObject({ scope: 'org_free_chatbot_limit' })
  })

  it('honours AI_FREE_PLAN_CHATBOT_TURN_LIMIT', async () => {
    vi.stubEnv('AI_FREE_PLAN_CHATBOT_TURN_LIMIT', '5')
    state.plan = 'free'
    state.counts.set(aiUsageEvent, 5)
    await expect(assertChatbotAllowance('org-1', 'platform'))
      .rejects.toThrow(BudgetExceededError)
    vi.unstubAllEnvs()
  })

  it('caps a free org even on its own key — BYOK is not a free escape hatch', async () => {
    // Free orgs can no longer create BYOK configs, but ones grandfathered in
    // before that rule must not get the uncapped assistant for nothing.
    state.plan = 'free'
    state.counts.set(aiUsageEvent, 20)
    await expect(assertChatbotAllowance('org-1', 'byok'))
      .rejects.toThrow(BudgetExceededError)
  })

  it('does not apply the hosted Free quota to self-hosted BYOK turns', async () => {
    state.plan = 'free'
    state.billingDisabled = true
    state.counts.set(aiUsageEvent, 20)
    await expect(assertChatbotAllowance('org-1', 'byok')).resolves.toBeUndefined()
    expect(state.queriedTables).not.toContain(aiUsageEvent)
  })

  it('does not apply the hosted Free quota to self-hosted platform turns', async () => {
    state.plan = 'free'
    state.billingDisabled = true
    state.counts.set(aiUsageEvent, 20)
    await expect(assertChatbotAllowance('org-1', 'platform')).resolves.toBeUndefined()
  })

  it('never caps a paid org on its own key', async () => {
    state.plan = 'solo'
    state.counts.set(aiUsageEvent, 9_999)
    state.spend.set(aiUsageEvent, 999_000_000)
    await expect(assertChatbotAllowance('org-1', 'byok')).resolves.toBeUndefined()
  })

  it('meters paid orgs by dollars, not by turn count', async () => {
    state.plan = 'solo'
    state.counts.set(aiUsageEvent, 9_999)
    await expect(assertChatbotAllowance('org-1', 'platform')).resolves.toBeUndefined()
  })
})
