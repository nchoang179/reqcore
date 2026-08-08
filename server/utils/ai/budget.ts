/**
 * AI spend budget gate — the money-safety layer.
 *
 * Two surfaces, two units, deliberately independent:
 *
 *   • CV analysis  — metered in dollars (MONTHLY_BUDGET_USD), an internal cap
 *     the customer never sees a number for.
 *   • The assistant — metered in credits (see credits.ts), the customer-facing
 *     unit. Credits track real cost without disclosing it.
 *
 * They no longer share a pot. A cap spanning both meant heavy assistant use
 * silently starved an org's shortlist runs, and it forced one ceiling to serve
 * two products with very different cost shapes.
 *
 * Lines of defence before any platform-paid LLM call:
 *   1. Per-run output cap        — enforced via maxTokens in the provider call.
 *   2. Per-org ceiling           — dollars for analysis, credits for the
 *                                  assistant, both by plan tier.
 *   3. Global daily kill-switch  — one dollar cap across ALL orgs and BOTH
 *                                  surfaces; the runaway-loop insurance (a
 *                                  re-scoring bug, not normal use, is how you
 *                                  actually lose money). This one still sums
 *                                  every ledger, because it guards the real
 *                                  OpenRouter bill rather than any product
 *                                  boundary.
 *
 * Fail-closed: if we cannot read current spend, we refuse the run rather than
 * risk an unbounded bill. BYOK runs bypass the money caps — it's the org's own
 * key and bill — with one exception, the Free assistant grant, which is a
 * product boundary rather than a cost control.
 *
 * Nothing here may put a dollar figure, token count, or credit-to-cost rate into
 * a customer-visible string. See the note above `BudgetExceededError`.
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import { aiUsageEvent, analysisRun } from '../../database/schema'
import { getModelPrice, microsToUsd } from './pricing'
import { chatbotCreditAllowance } from './credits'
import { isBillingDisabled, resolveOrgPlanId } from '../billing/plan'
import { FREE_PLAN_ANALYSIS_LIMIT } from '../../../shared/billing'

/**
 * Monthly platform-paid **analysis** budget per *paid* org, in USD, keyed by
 * plan. Free orgs are gated by a lifetime run count instead — see `freeRunLimit`.
 * The assistant is not billed against this; it has its own credit allowance in
 * credits.ts.
 *
 * BYOK is available from Solo up and is never capped here; these caps are
 * generous backstops for platform-paid analysis, not expected ceilings.
 *
 * These are conservative starting points — tune them as you learn real
 * cost-per-customer from the analytics. Keep them well under each plan's MRR,
 * remembering the assistant's credit allowance now sits alongside them.
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
 * Global platform-wide daily spend cap in USD. The runaway-loop circuit breaker.
 * Overridable via AI_DAILY_SPEND_CAP_USD; defaults to a deliberately low $25 so
 * a bug trips it loudly long before it empties your account.
 */
function dailyCapUsd(): number {
  const raw = process.env.AI_DAILY_SPEND_CAP_USD
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25
}

/**
 * `scope` reaches the client in the 429 payload, so the values are deliberately
 * coarse: every assistant refusal reports `org_chatbot_credits`, whether the org
 * ran out of a Free grant or a paid monthly allowance. A scope that told those
 * apart would let a customer infer where their plan's ceiling sits.
 *
 * The same applies to `message` — it is rendered verbatim in the chat UI
 * (useChatbot.ts). Never interpolate a dollar amount, a token count, or a raw
 * credit balance into one.
 */
export class BudgetExceededError extends Error {
  constructor(
    public readonly scope:
      | 'org_monthly'
      | 'org_free_limit'
      | 'org_chatbot_credits'
      | 'global_daily',
    message: string,
  ) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

/**
 * Fail closed when we cannot price a model.
 *
 * `computeCostUsdMicros` returns null for anything missing from MODEL_PRICING,
 * which would charge zero credits and freeze every balance — the allowance, and
 * the daily kill-switch that reads the same ledger, would go silently inert.
 * Because the platform model is a plain env var (OPENROUTER_MODEL) with no
 * validation against the price table, a routine model swap is all it takes.
 *
 * Refusing service is the cheaper failure: it surfaces immediately and costs one
 * outage, where the alternative is an uncapped bill nobody notices.
 */
export function assertPricedModel(model: string): void {
  if (getModelPrice(model)) return
  console.error(
    `[Reqcore] refusing platform-paid AI call: model "${model}" has no entry in `
    + `MODEL_PRICING. Add one (server/utils/ai/pricing.ts) before routing traffic `
    + `to it — spend on an unpriced model is invisible to every budget gate.`,
  )
  throw createError({
    statusCode: 503,
    statusMessage: 'The assistant is temporarily unavailable. Please try again later.',
    data: { code: 'AI_MODEL_UNPRICED' },
  })
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
 * Sum the credits an org has spent on the assistant.
 *
 * Two shapes, because the two allowances mean different things:
 *
 *  - Free (`since` omitted, `platformOnly` false) — a lifetime grant, counted in
 *    *any* billing mode. It is a product boundary, not a cost control, so a turn
 *    spends the grant no matter who paid for it. Billing-disabled self-hosted
 *    instances bypass this SaaS quota entirely.
 *  - Paid (`since` = start of month, `platformOnly` true) — a cost control, so a
 *    BYOK turn on the org's own key must not consume it.
 *
 * Rows appear the moment a turn *starts*, carrying an estimated charge that is
 * reconciled when it ends (see usage.ts). That is what makes the gate safe under
 * concurrency; a turn that produces nothing has its row deleted, so failures
 * still cost the customer nothing.
 */
async function sumChatbotCredits(
  orgId: string,
  opts: { since?: Date, platformOnly: boolean },
): Promise<number> {
  const filters = [
    eq(aiUsageEvent.organizationId, orgId),
    eq(aiUsageEvent.feature, 'chatbot_message'),
  ]
  if (opts.since) filters.push(gte(aiUsageEvent.createdAt, opts.since))
  if (opts.platformOnly) filters.push(eq(aiUsageEvent.billingMode, 'platform'))

  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${aiUsageEvent.creditsCharged}), 0)` })
    .from(aiUsageEvent)
    .where(and(...filters))
  return Number(row?.total ?? 0)
}

/**
 * Sum platform-paid spend (µ$) for an org since `since`, across both ledgers.
 * Omit `orgId` for the platform-wide total behind the daily kill-switch.
 *
 * Still spans both tables even though the assistant is metered in credits: this
 * feeds the global kill-switch, which guards the actual OpenRouter invoice and
 * therefore has to see every dollar regardless of which product spent it.
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

/**
 * Sum an org's platform-paid *analysis* spend (µ$) since `since`.
 *
 * Only `analysisRun`, unlike the kill-switch sum above. Assistant turns are
 * metered in credits against their own allowance, so counting them here too
 * would charge one turn twice and let chatbot use quietly exhaust an org's
 * shortlist budget.
 */
async function sumAnalysisSpendMicros(since: Date, orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${analysisRun.costUsdMicros}), 0)` })
    .from(analysisRun)
    .where(and(
      eq(analysisRun.billingMode, 'platform'),
      eq(analysisRun.organizationId, orgId),
      gte(analysisRun.createdAt, since),
    ))
  return Number(row?.total ?? 0)
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
 * How much of its assistant allowance an org has spent.
 *
 * The one place that knows whether a plan's grant is lifetime or monthly, and
 * whether BYOK turns count. Shared by the gate and by the usage meter
 * (billing/usage.ts) so the number shown always matches the number enforced.
 */
export async function getChatbotCreditUsage(
  orgId: string,
  plan: string,
): Promise<{ used: number, allowance: number }> {
  const isFree = plan === 'free'
  const used = await sumChatbotCredits(orgId, {
    since: isFree ? undefined : startOfUtcMonth(),
    platformOnly: !isFree,
  })
  return { used, allowance: chatbotCreditAllowance(plan) }
}

/**
 * Throw if an org has spent its assistant credit allowance.
 *
 * Free and paid share one refusal, one scope, and one message on purpose: the
 * customer sees "out of credits" either way, and cannot tell a lifetime grant
 * from a monthly allowance or read anything about where the ceiling sits.
 */
async function assertChatbotCredits(orgId: string, plan: string): Promise<void> {
  const { used, allowance } = await getChatbotCreditUsage(orgId, plan)
  if (used < allowance) return

  throw new BudgetExceededError(
    'org_chatbot_credits',
    plan === 'free'
      ? 'You’ve used your free assistant credits. Upgrade to Solo to keep chatting with your pipeline — your conversations stay readable either way.'
      : 'You’ve used this workspace’s assistant credits. They renew at the start of next month — or add your own AI key in Settings → AI to keep chatting without a limit.',
  )
}

/**
 * The single gate in front of an assistant turn, whoever is paying.
 *
 * Platform-paid turns spend credits and are additionally covered by the global
 * daily kill-switch. BYOK turns are the org's own key and bill, so they are
 * normally uncapped — the one exception is a Free org on a billing-enabled
 * hosted installation, where the grant is a SaaS product boundary rather than a
 * cost control.
 */
export async function assertChatbotAllowance(
  orgId: string,
  billingMode: 'platform' | 'byok',
): Promise<void> {
  const plan = await resolveOrgPlanId(orgId)
  // The credit allowance is a SaaS product boundary. A billing-disabled
  // self-hosted instance is running on its own key and its own bill, so it gets
  // no allowance — only the daily kill-switch, which is a safety net rather than
  // a quota and protects their spend too.
  const allowanceApplies = !isBillingDisabled()

  if (billingMode === 'platform') {
    const [, daySpend] = await Promise.all([
      allowanceApplies ? assertChatbotCredits(orgId, plan) : Promise.resolve(),
      sumPlatformSpendMicros(startOfUtcDay()),
    ])
    assertDailyCap(daySpend, 'chatbot')
    return
  }

  if (allowanceApplies && plan === 'free') {
    await assertChatbotCredits(orgId, plan)
  }
}

/**
 * Assert that a *platform-paid analysis* call for `orgId` is within budget.
 * Throws `BudgetExceededError` if the org's month-to-date or the global
 * day-to-date spend has already reached its cap. Call this immediately before
 * the LLM call.
 *
 * Assistant turns do not come through here — they spend credits via
 * `assertChatbotAllowance`. This gate covers scoring, CV extraction and share
 * copy, all metered in dollars against MONTHLY_BUDGET_USD.
 *
 * Note: this gate is pre-spend — it stops the *next* call once a cap is reached.
 * Combined with the per-call maxTokens cap, the worst-case overshoot is one call.
 */
export async function assertPlatformBudget(orgId: string): Promise<void> {
  const plan = await resolveOrgPlanId(orgId)

  if (plan === 'free') {
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
    assertDailyCap(daySpend, 'analysis')
    return
  }

  const [monthSpend, daySpend] = await Promise.all([
    sumAnalysisSpendMicros(startOfUtcMonth(), orgId),
    sumPlatformSpendMicros(startOfUtcDay()),
  ])

  const monthlyCapUsd = MONTHLY_BUDGET_USD[plan] ?? MONTHLY_BUDGET_USD.default!
  if (microsToUsd(monthSpend) >= monthlyCapUsd) {
    throw new BudgetExceededError(
      'org_monthly',
      'Monthly AI analysis budget reached for this workspace. It resets at the start of next month, or upgrade for a higher limit.',
    )
  }

  assertDailyCap(daySpend, 'analysis')
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
