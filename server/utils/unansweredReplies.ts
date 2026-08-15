import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { application, candidate, candidateConversation, candidateMessage, job } from '../database/schema'

/**
 * Conversations where the candidate spoke last and nobody has answered.
 *
 * Deliberately derived from message order rather than
 * `candidateConversation.unreadCount`: nothing in the product ever clears that
 * counter (there is no inbox and no mark-read path), so a badge built on it
 * would only ever grow and could never be worked down to zero. "The newest
 * message is inbound" self-clears the moment anything goes out on the thread —
 * an interview proposal, an update, a cancellation — which is exactly the set of
 * replies that are still owed an answer.
 *
 * Quarantined candidates are excluded for the same reason the pipeline counts
 * exclude them: they aren't shown anywhere else either.
 */
function latestMessagePerConversation(organizationId: string) {
  return db
    .selectDistinctOn([candidateMessage.conversationId], {
      conversationId: candidateMessage.conversationId,
      direction: candidateMessage.direction,
      subject: candidateMessage.subject,
      bodyText: candidateMessage.bodyText,
      kind: candidateMessage.kind,
      createdAt: candidateMessage.createdAt,
    })
    .from(candidateMessage)
    .where(eq(candidateMessage.organizationId, organizationId))
    // DISTINCT ON requires the distinct columns to lead the ORDER BY; the
    // trailing `desc(createdAt)` is what makes the retained row the newest one.
    .orderBy(candidateMessage.conversationId, desc(candidateMessage.createdAt))
    .as('latest_message')
}

export interface UnansweredReply {
  conversationId: string
  applicationId: string
  candidateFirstName: string
  candidateLastName: string
  jobTitle: string
  subject: string
  bodyText: string
  kind: string
  receivedAt: Date
}

/**
 * The most recent unanswered candidate replies, newest first.
 *
 * Today the only inbound messages the app can produce are interview responses
 * (accept / decline / reschedule) from the public respond endpoint — there is no
 * inbound-email webhook wired up yet — so this list is small by construction.
 * The query doesn't assume that: any inbound message lands here once replies
 * start arriving from other sources.
 */
export async function unansweredReplies(params: {
  organizationId: string
  limit?: number
}): Promise<UnansweredReply[]> {
  const latest = latestMessagePerConversation(params.organizationId)

  const rows = await db
    .select({
      conversationId: latest.conversationId,
      applicationId: candidateConversation.applicationId,
      candidateFirstName: candidate.firstName,
      candidateLastName: candidate.lastName,
      jobTitle: job.title,
      subject: latest.subject,
      bodyText: latest.bodyText,
      kind: latest.kind,
      receivedAt: latest.createdAt,
    })
    .from(latest)
    .innerJoin(candidateConversation, eq(candidateConversation.id, latest.conversationId))
    .innerJoin(application, eq(application.id, candidateConversation.applicationId))
    .innerJoin(candidate, eq(candidate.id, application.candidateId))
    .innerJoin(job, eq(job.id, application.jobId))
    .where(and(
      eq(latest.direction, 'inbound'),
      isNull(candidate.quarantinedAt),
    ))
    .orderBy(desc(latest.createdAt))
    .limit(params.limit ?? 5)

  return rows
}

/** How many conversations are waiting on a reply, for the "+N more" affordance. */
export async function unansweredReplyCount(params: {
  organizationId: string
}): Promise<number> {
  const latest = latestMessagePerConversation(params.organizationId)

  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(latest)
    .innerJoin(candidateConversation, eq(candidateConversation.id, latest.conversationId))
    .innerJoin(application, eq(application.id, candidateConversation.applicationId))
    .innerJoin(candidate, eq(candidate.id, application.candidateId))
    .where(and(
      eq(latest.direction, 'inbound'),
      isNull(candidate.quarantinedAt),
    ))

  return row?.value ?? 0
}
