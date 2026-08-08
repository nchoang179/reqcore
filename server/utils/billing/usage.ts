/**
 * Org usage vs. plan limits — the numbers the billing UI shows free orgs so they
 * can see how close they are to the caps that the upsell is asking them to lift.
 *
 * Both meters mirror gates enforced elsewhere:
 *  - activeRoles  → assertActiveRoleLimit (server/utils/billing/plan.ts)
 *  - aiAnalysis   → assertPlatformBudget free-tier count gate (server/utils/ai/budget.ts)
 *  - aiAssistant  → assertChatbotAllowance prompt/credit gate (same file)
 *
 * `limit: null` means "no fixed cap on this tier" (e.g. paid analysis is a $
 * budget, agency roles are unlimited) and is JSON-safe, unlike Infinity.
 *
 * `aiAssistant` reports the exact prompt count on Free, where the public limit
 * is count-based. Paid tiers still report only a credit percentage, keeping raw
 * balances and the credit-to-cost rate private.
 */
import { and, eq, ne, sql } from 'drizzle-orm'
import { analysisRun, candidateMessage, job } from '../../database/schema'
import { resolveOrgPlanId } from './plan'
import {
  freeRunLimit,
  getChatbotCreditUsage,
  getFreeChatbotPromptUsage,
} from '../ai/budget'
import { creditPercentUsed } from '../ai/credits'
import {
  activeRoleLimitForTier,
  FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT,
  type BillingTier,
} from '../../../shared/billing'

export interface UsageMeter {
  used: number
  /** Hard cap on this tier, or null when there's no fixed count limit. */
  limit: number | null
}

export interface OrgUsage {
  tier: BillingTier
  activeRoles: UsageMeter
  aiAnalysis: UsageMeter
  aiAssistant: UsageMeter
  candidateConversations: UsageMeter
}

/** Count an org's currently-open roles (jobs with status 'open'). */
// Mirrors the cap query in billing/plan.ts — test roles don't count, so the
// usage meter matches what is actually being enforced.
async function countOpenJobs(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`count(*)` })
    .from(job)
    .where(and(eq(job.organizationId, orgId), eq(job.status, 'open'), eq(job.isTest, false)))
  return Number(row?.total ?? 0)
}

/** Count completed platform-paid AI runs for an org (lifetime). */
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
 * Count the distinct candidate conversations an org has started — those holding
 * at least one live (non-failed) outbound message. Mirrors the Free conversation
 * gate enforced in ee/server/utils/candidate-message-allowance.ts
 * (countStartedConversations); the number of messages within a thread is
 * irrelevant, only whether a slot is occupied.
 */
async function countStartedConversations(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`count(distinct ${candidateMessage.conversationId})` })
    .from(candidateMessage)
    .where(and(
      eq(candidateMessage.organizationId, orgId),
      eq(candidateMessage.direction, 'outbound'),
      ne(candidateMessage.status, 'failed'),
    ))
  return Number(row?.total ?? 0)
}

/**
 * Resolve an org's tier plus its usage against the plan caps. The analysis and
 * candidate-conversation meters only have a fixed limit on the free tier (paid
 * analysis is a monthly $ budget; paid messaging is unlimited), so their `limit`
 * is null for any paid tier. The assistant meter is populated on *every* tier,
 * as a percentage — see the file header.
 */
export async function getOrgUsage(orgId: string): Promise<OrgUsage> {
  const tier = await resolveOrgPlanId(orgId)

  const [openJobs, aiRuns, assistantUsage, conversations] = await Promise.all([
    countOpenJobs(orgId),
    countPlatformRuns(orgId),
    tier === 'free'
      ? getFreeChatbotPromptUsage(orgId)
      : getChatbotCreditUsage(orgId, tier),
    countStartedConversations(orgId),
  ])

  const roleLimit = activeRoleLimitForTier(tier)

  return {
    tier,
    activeRoles: {
      used: openJobs,
      limit: Number.isFinite(roleLimit) ? roleLimit : null,
    },
    aiAnalysis: {
      used: aiRuns,
      limit: tier === 'free' ? freeRunLimit() : null,
    },
    aiAssistant: tier === 'free'
      ? { used: assistantUsage.used, limit: assistantUsage.allowance }
      : {
          // Percentage of a paid credit allowance, never its raw balance.
          used: creditPercentUsed(assistantUsage.used, assistantUsage.allowance),
          limit: 100,
        },
    candidateConversations: {
      used: conversations,
      limit: tier === 'free' ? FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT : null,
    },
  }
}
