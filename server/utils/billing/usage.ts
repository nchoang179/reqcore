/**
 * Org usage vs. plan limits — the numbers the billing UI shows free orgs so they
 * can see how close they are to the caps that the upsell is asking them to lift.
 *
 * Both meters mirror gates enforced elsewhere:
 *  - activeRoles  → assertActiveRoleLimit (server/utils/billing/plan.ts)
 *  - aiAnalysis   → assertPlatformBudget free-tier count gate (server/utils/ai/budget.ts)
 *  - aiAssistant  → assertChatbotAllowance free-tier turn gate (same file)
 *
 * `limit: null` means "no fixed cap on this tier" (e.g. paid AI is a $ budget,
 * agency roles are unlimited) and is JSON-safe, unlike Infinity.
 */
import { and, eq, ne, sql } from 'drizzle-orm'
import { aiUsageEvent, analysisRun, candidateMessage, job } from '../../database/schema'
import { resolveOrgPlanId } from './plan'
import { freeChatbotTurnLimit, freeRunLimit } from '../ai/budget'
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
 * Count assistant turns an org has used (lifetime, any billing mode). Mirrors
 * countChatbotTurns in ai/budget.ts — the meter has to show the same number the
 * gate enforces, including turns a legacy free BYOK config paid for.
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
 * Resolve an org's tier plus its usage against the count-based caps. The AI and
 * candidate-conversation meters only have a fixed limit on the free tier (paid
 * AI is a monthly $ budget; paid messaging is unlimited), so their `limit` is
 * null for any paid tier.
 */
export async function getOrgUsage(orgId: string): Promise<OrgUsage> {
  const tier = await resolveOrgPlanId(orgId)

  const [openJobs, aiRuns, assistantTurns, conversations] = await Promise.all([
    countOpenJobs(orgId),
    countPlatformRuns(orgId),
    countChatbotTurns(orgId),
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
    aiAssistant: {
      used: assistantTurns,
      limit: tier === 'free' ? freeChatbotTurnLimit() : null,
    },
    candidateConversations: {
      used: conversations,
      limit: tier === 'free' ? FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT : null,
    },
  }
}
