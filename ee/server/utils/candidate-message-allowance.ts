import { and, eq, ne, sql } from 'drizzle-orm'
import { candidateMessage } from '~~/server/database/schema'
import {
  FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT,
  type BillingTier,
  tierUsesFreeAllowances,
} from '~~/shared/billing'

/** Any query runner — the global client or an open transaction. */
type DbExecutor = Pick<typeof db, 'select'>

export interface CandidateMessageAllowance {
  tier: BillingTier
  /** Conversations already started (each holds ≥1 live outbound message). */
  used: number
  /** Conversation cap on this tier, or null when unlimited. */
  limit: number | null
  remaining: number | null
  /** Whether a brand-new conversation may be started. Replies are always allowed. */
  canSend: boolean
}

export function candidateMessageAllowanceFromUsage(
  tier: BillingTier,
  used: number,
): CandidateMessageAllowance {
  if (!tierUsesFreeAllowances(tier)) {
    return { tier, used, limit: null, remaining: null, canSend: true }
  }

  const remaining = Math.max(0, FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT - used)
  return {
    tier,
    used,
    limit: FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT,
    remaining,
    canSend: remaining > 0,
  }
}

/** Outbound messages that occupy a Free conversation slot (failed sends release theirs). */
function liveOutbound(orgId: string) {
  return and(
    eq(candidateMessage.organizationId, orgId),
    eq(candidateMessage.direction, 'outbound'),
    ne(candidateMessage.status, 'failed'),
  )
}

/**
 * Count the distinct conversations an org has started — i.e. that hold at least
 * one live outbound message. This is the quantity the Free conversation cap
 * meters; the number of messages within those conversations is irrelevant.
 */
export async function countStartedConversations(
  orgId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const [{ value } = { value: '0' }] = await executor
    .select({ value: sql<string>`count(distinct ${candidateMessage.conversationId})` })
    .from(candidateMessage)
    .where(liveOutbound(orgId))
  return Number(value)
}

/** Whether a conversation already holds a live outbound message (occupies its slot). */
async function conversationHasLiveOutbound(
  orgId: string,
  conversationId: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const [row] = await executor
    .select({ one: sql`1` })
    .from(candidateMessage)
    .where(and(liveOutbound(orgId), eq(candidateMessage.conversationId, conversationId)))
    .limit(1)
  return !!row
}

/**
 * Whether an outbound message may be sent under the Free conversation cap.
 * Messaging into a conversation that already occupies a slot is always allowed;
 * only starting a new conversation consumes one. Free callers must hold the
 * per-org advisory lock so concurrent sends can't both claim the final slot.
 */
export async function canSendIntoConversation(
  orgId: string,
  conversationId: string,
  tier: BillingTier,
  executor: DbExecutor = db,
): Promise<boolean> {
  if (!tierUsesFreeAllowances(tier)) return true
  if (await conversationHasLiveOutbound(orgId, conversationId, executor)) return true
  return (await countStartedConversations(orgId, executor)) < FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT
}

/**
 * Resolve an org's conversation allowance for display. `used` counts started
 * conversations; `canSend` reports whether another one may be opened.
 */
export async function getCandidateMessageAllowance(
  orgId: string,
  tier: BillingTier,
): Promise<CandidateMessageAllowance> {
  const used = await countStartedConversations(orgId)
  return candidateMessageAllowanceFromUsage(tier, used)
}
