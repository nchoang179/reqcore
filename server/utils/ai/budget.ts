/**
 * AI spend budget gate — the money-safety layer.
 *
 * Three lines of defence, checked *before* any platform-paid LLM call:
 *   1. Per-run output cap        — enforced via maxTokens in the provider call.
 *   2. Per-org monthly ceiling   — by plan tier.
 *   3. Global daily kill-switch  — one cap across ALL orgs; the runaway-loop
 *                                  insurance (a re-scoring bug, not normal use,
 *                                  is how you actually lose money).
 *
 * Spend is summed across BOTH ledgers: `analysisRun` (scoring) and
 * `aiUsageEvent` (everything else, currently assistant turns). A cap that saw
 * only one of them would be trivially bypassed by spending on the other.
 *
 * Fail-closed: if we cannot read current spend, we refuse the run rather than
 * risk an unbounded bill. BYOK runs bypass everything here — it's the org's own
 * key and bill; we only track those, we don't cap them.
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import { aiUsageEvent, analysisRun } from '../../database/schema'
import { microsToUsd } from './pricing'
import { isBillingDisabled, resolveOrgPlanId } from '../billing/plan'
import { FREE_PLAN_ANALYSIS_LIMIT, FREE_PLAN_CHATBOT_TURN_LIMIT } from '../../../shared/billing'

/**
 * Monthly platform-paid AI budget per *paid* org, in USD, keyed by plan.
 * Free orgs are gated by lifetime counts instead — see `freeRunLimit` for
 * analysis and `freeChatbotTurnLimit` for the assistant.
 * BYOK is available from Solo up and is never capped here; these caps are
 * generous backstops for platform-paid analysis, not expected ceilings.
 *
 * These are conservative starting points — tune them as you learn real
 * cost-per-customer from the analytics. Keep them well under each plan's MRR.
 */
export const MONTHLY_BUDGET_USD: Record<string, number> = {
  default: 2,
  solo: 20,
  team: 60,
  scale: 200,
  agency: 500,
}

/**
 * Lifetime platform-paid run allowance for a free org — the count-based
 * "one free AI shortlist" gate. Defaults to FREE_PLAN_ANALYSIS_LIMIT, overridable
 * via AI_FREE_PLAN_RUN_LIMIT.
 */
export function freeRunLimit(): number {
  const raw = process.env.AI_FREE_PLAN_RUN_LIMIT
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FREE_PLAN_ANALYSIS_LIMIT
}

/**
 * Lifetime platform-paid assistant turns a free org may use — the count-based
 * "taste of the assistant" gate, mirroring `freeRunLimit` for analysis.
 * Defaults to FREE_PLAN_CHATBOT_TURN_LIMIT, overridable via
 * AI_FREE_PLAN_CHATBOT_TURN_LIMIT.
 */
export function freeChatbotTurnLimit(): number {
  const raw = process.env.AI_FREE_PLAN_CHATBOT_TURN_LIMIT
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FREE_PLAN_CHATBOT_TURN_LIMIT
}

/**
 * Global platform-wide daily spend cap in USD. The runaway-loop circuit breaker.
 * Overridable via AI_DAILY_SPEND_CAP_USD; defaults to a deliberately low $25 so
 * a bug trips it loudly long before it empties your account.
 */
function dailyCapUsd(): number {
  const raw = process.env.AI_DAILY_SPEND_CAP_USD
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly scope:
      | 'org_monthly'
      | 'org_free_limit'
      | 'org_free_chatbot_limit'
      | 'global_daily',
    message: string,
  ) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

/** Count completed platform-paid runs for an org (lifetime). */
async function countPlatformRuns(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`count(*)` })
    .from(analysisRun)
    .where(and(
      eq(analysisRun.billingMode, 'platform'),
      eq(analysisRun.organizationId, orgId),
      eq(analysisRun.status, 'completed'),
    ))
  return Number(row?.total ?? 0)
}

/**
 * Count assistant turns for a hosted SaaS org (lifetime), in *any* billing mode.
 *
 * Deliberately not filtered by `billingMode`. On hosted Free the turn allowance
 * is a product boundary, not a cost control, so a turn counts no matter who paid
 * for it. Billing-disabled self-hosted instances bypass this SaaS product quota.
 *
 * One row per completed turn, written by recordAiUsage after the stream ends —
 * so a turn that errored out before producing an answer never lands here and
 * never costs the org a slot. That's deliberate: the free allowance should be
 * spent on answers, not on our failures.
 */
async function countChatbotTurns(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`count(*)` })
    .from(aiUsageEvent)
    .where(and(
      eq(aiUsageEvent.organizationId, orgId),
      eq(aiUsageEvent.feature, 'chatbot_message'),
    ))
  return Number(row?.total ?? 0)
}

/**
 * Sum platform-paid spend (µ$) for an org since `since`, across both ledgers.
 * Omit `orgId` for the platform-wide total behind the daily kill-switch.
 */
async function sumPlatformSpendMicros(since: Date, orgId?: string): Promise<number> {
  const runWhere = orgId
    ? and(
        eq(analysisRun.billingMode, 'platform'),
        eq(analysisRun.organizationId, orgId),
        gte(analysisRun.createdAt, since),
      )
    : and(
        eq(analysisRun.billingMode, 'platform'),
        gte(analysisRun.createdAt, since),
      )

  const usageWhere = orgId
    ? and(
        eq(aiUsageEvent.billingMode, 'platform'),
        eq(aiUsageEvent.organizationId, orgId),
        gte(aiUsageEvent.createdAt, since),
      )
    : and(
        eq(aiUsageEvent.billingMode, 'platform'),
        gte(aiUsageEvent.createdAt, since),
      )

  const [[runRow], [usageRow]] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${analysisRun.costUsdMicros}), 0)` })
      .from(analysisRun)
      .where(runWhere),
    db
      .select({ total: sql<string>`coalesce(sum(${aiUsageEvent.costUsdMicros}), 0)` })
      .from(aiUsageEvent)
      .where(usageWhere),
  ])

  return Number(runRow?.total ?? 0) + Number(usageRow?.total ?? 0)
}

function startOfUtcMonth(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

function startOfUtcDay(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** Which surface is asking — only affects the wording of the refusal. */
export type BudgetFeature = 'analysis' | 'chatbot'

/**
 * Throw if a free org has spent its lifetime assistant-turn allowance.
 * Split out because it is reached two ways: through the platform budget gate
 * below, and directly from `assertChatbotAllowance` for a legacy free org
 * running on its own key.
 */
async function assertFreeChatbotTurns(orgId: string): Promise<void> {
  const turns = await countChatbotTurns(orgId)
  if (turns >= freeChatbotTurnLimit()) {
    throw new BudgetExceededError(
      'org_free_chatbot_limit',
      'You’ve used your free assistant messages. Upgrade to Solo to keep chatting with your pipeline — your conversations stay readable either way.',
    )
  }
}

/**
 * The single gate in front of an assistant turn, whoever is paying.
 *
 * Platform-paid turns go through the full budget gate. BYOK turns are the org's
 * own key and bill, so they are normally uncapped — the one exception is a Free
 * org on a billing-enabled hosted installation, where the turn count is a SaaS
 * product boundary rather than a cost control.
 */
export async function assertChatbotAllowance(
  orgId: string,
  billingMode: 'platform' | 'byok',
): Promise<void> {
  if (billingMode === 'platform') {
    await assertPlatformBudget(orgId, { feature: 'chatbot' })
    return
  }
  if (!isBillingDisabled() && await resolveOrgPlanId(orgId) === 'free') {
    await assertFreeChatbotTurns(orgId)
  }
}

/**
 * Assert that a *platform-paid* call for `orgId` is within budget. Throws
 * `BudgetExceededError` if the org's month-to-date or the global day-to-date
 * spend has already reached its cap. Call this immediately before the LLM call.
 *
 * Note: this gate is pre-spend — it stops the *next* call once a cap is reached.
 * Combined with the per-call maxTokens cap, the worst-case overshoot is one call.
 *
 * The org's monthly cap is shared across surfaces: assistant turns and analysis
 * runs draw on the same plan budget, because it's one OpenRouter bill and a
 * per-surface cap would just raise the ceiling without anyone choosing to.
 */
export async function assertPlatformBudget(
  orgId: string,
  opts: { feature?: BudgetFeature } = {},
): Promise<void> {
  const feature = opts.feature ?? 'analysis'
  const plan = await resolveOrgPlanId(orgId)

  // Free orgs are metered by counts, not dollars, and the two surfaces get
  // separate allowances because they're separate products: burning your
  // shortlist runs shouldn't silence the assistant, or vice versa.
  if (plan === 'free' && feature === 'chatbot' && !isBillingDisabled()) {
    const [, daySpend] = await Promise.all([
      assertFreeChatbotTurns(orgId),
      sumPlatformSpendMicros(startOfUtcDay()),
    ])
    assertDailyCap(daySpend, feature)
    return
  }

  if (plan === 'free' && feature === 'analysis') {
    // Count-based gate: one free AI shortlist per account, then upgrade.
    const [runs, daySpend] = await Promise.all([
      countPlatformRuns(orgId),
      sumPlatformSpendMicros(startOfUtcDay()),
    ])
    const limit = freeRunLimit()
    if (runs >= limit) {
      throw new BudgetExceededError(
        'org_free_limit',
        'You’ve used your free AI analysis runs. Upgrade to a paid plan to keep running AI analysis — or bring your own AI key, included from Solo up. Your existing rankings stay available either way.',
      )
    }
    assertDailyCap(daySpend, feature)
    return
  }

  const [monthSpend, daySpend] = await Promise.all([
    sumPlatformSpendMicros(startOfUtcMonth(), orgId),
    sumPlatformSpendMicros(startOfUtcDay()),
  ])

  const monthlyCapUsd = MONTHLY_BUDGET_USD[plan] ?? MONTHLY_BUDGET_USD.default!
  if (microsToUsd(monthSpend) >= monthlyCapUsd) {
    throw new BudgetExceededError(
      'org_monthly',
      feature === 'chatbot'
        ? `Monthly AI budget reached for this workspace ($${monthlyCapUsd}). It resets at the start of next month — or add your own AI key in Settings → AI to keep chatting without a cap.`
        : `Monthly AI budget reached for this workspace ($${monthlyCapUsd}). It resets at the start of next month, or upgrade for a higher limit.`,
    )
  }

  assertDailyCap(daySpend, feature)
}

/** Global daily kill-switch — one cap across all orgs. */
function assertDailyCap(daySpend: number, feature: BudgetFeature = 'analysis'): void {
  const capUsd = dailyCapUsd()
  if (microsToUsd(daySpend) >= capUsd) {
    throw new BudgetExceededError(
      'global_daily',
      feature === 'chatbot'
        ? 'The assistant is temporarily paused for maintenance. Please try again later.'
        : 'AI analysis is temporarily paused for maintenance. Please try again later.',
    )
  }
}

/** Map a BudgetExceededError to an H3 error (429). */
export function budgetErrorToHttp(err: BudgetExceededError) {
  return createError({
    statusCode: 429,
    statusMessage: err.message,
    data: { code: 'AI_BUDGET_EXCEEDED', scope: err.scope },
  })
}
