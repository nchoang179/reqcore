import { and, eq, gte, ne, sql } from 'drizzle-orm'
import { candidateMessage } from '~~/server/database/schema'
import {
  conversationCapStartFor,
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

/**
 * Outbound messages that occupy a Free conversation slot (failed sends release
 * theirs). `since` narrows the window to messages sent at or after an instant,
 * which is how the cap stays non-retroactive for grandfathered orgs.
 */
function liveOutbound(orgId: string, since?: Date | null) {
  return and(
    eq(candidateMessage.organizationId, orgId),
    eq(candidateMessage.direction, 'outbound'),
    ne(candidateMessage.status, 'failed'),
    ...(since ? [gte(candidateMessage.createdAt, since)] : []),
  )
}

/**
 * Count the distinct conversations an org has started — i.e. that hold at least
 * one live outbound message. This is the quantity the Free conversation cap
 * meters; the number of messages within those conversations is irrelevant.
 *
 * `since` counts only conversations opened at or after that instant. Pass the
 * tier's `conversationCapStartFor` so a tier the cap was extended to later is
 * not charged for its history.
 */
export async function countStartedConversations(
  orgId: string,
  executor: DbExecutor = db,
  since?: Date | null,
): Promise<number> {
  const [{ value } = { value: '0' }] = await executor
    .select({ value: sql<string>`count(distinct ${candidateMessage.conversationId})` })
    .from(candidateMessage)
    .where(liveOutbound(orgId, since))
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
  const used = await countStartedConversations(orgId, executor, conversationCapStartFor(tier))
  return used < FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT
}

/**
 * Resolve an org's conversation allowance for display. `used` counts started
 * conversations; `canSend` reports whether another one may be opened.
 */
export async function getCandidateMessageAllowance(
  orgId: string,
  tier: BillingTier,
): Promise<CandidateMessageAllowance> {
  const used = await countStartedConversations(orgId, db, conversationCapStartFor(tier))
  return candidateMessageAllowanceFromUsage(tier, used)
}
