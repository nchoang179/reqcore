import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import {
  application,
  candidateConversation,
  candidateMessage,
  candidateMessageAttachment,
} from '~~/server/database/schema'
import { sendCandidateMessageEmail } from '~~/server/utils/email'
import { assertOutboundMessageLimit } from '~~/server/utils/candidate-message-rate-limit'
import { deleteFromS3, downloadFromS3, uploadToS3 } from '~~/server/utils/s3'
import {
  conversationCapStartFor,
  FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT,
} from '~~/shared/billing'
import { CANDIDATE_MESSAGE_MAX_REQUEST_BYTES } from '~~/shared/candidate-messaging'
import {
  canSendIntoConversation,
  countStartedConversations,
} from '../../utils/candidate-message-allowance'
import {
  appendReference,
  candidateReplyAddress,
  normalizeEmailAddress,
  replySubject,
} from '../../utils/candidate-messaging'
import { requireCandidateMessagingConfig } from '../../utils/candidate-messaging-config'
import {
  CandidateMessageAttachmentError,
  validateCandidateMessageAttachments,
  type ValidatedCandidateMessageAttachment,
} from '../../utils/candidate-message-attachments'
import { sendCandidateMessageSchema } from '../../utils/schemas/candidate-message'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidateMessage: ['create'] })
  assertEmailVerified(session.user)
  const orgId = session.session.activeOrganizationId
  const tier = await assertPlanFeature(orgId, 'candidateMessaging')
  const { replyDomain } = requireCandidateMessagingConfig()
  const { body, files } = await readCandidateMessageRequest(event)

  const applicationRecord = await db.query.application.findFirst({
    where: and(eq(application.id, body.applicationId), eq(application.organizationId, orgId)),
    columns: { id: true },
    with: {
      candidate: { columns: { email: true, quarantinedAt: true } },
      job: { columns: { title: true } },
    },
  })
  if (!applicationRecord) throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  if (applicationRecord.candidate.quarantinedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Restore this candidate before sending a message' })
  }

  let conversation = await db.query.candidateConversation.findFirst({
    where: and(
      eq(candidateConversation.applicationId, body.applicationId),
      eq(candidateConversation.organizationId, orgId),
    ),
  })
  if (!conversation) {
    await db.insert(candidateConversation).values({
      organizationId: orgId,
      applicationId: body.applicationId,
    }).onConflictDoNothing({ target: candidateConversation.applicationId })
    conversation = await db.query.candidateConversation.findFirst({
      where: and(
        eq(candidateConversation.applicationId, body.applicationId),
        eq(candidateConversation.organizationId, orgId),
      ),
    })
  }
  if (!conversation) throw createError({ statusCode: 500, statusMessage: 'Could not create conversation' })

  const existing = await db.query.candidateMessage.findFirst({
    where: and(eq(candidateMessage.id, body.requestId), eq(candidateMessage.organizationId, orgId)),
  })
  if (existing && existing.conversationId !== conversation.id) {
    throw createError({ statusCode: 409, statusMessage: 'Request ID has already been used' })
  }
  if (existing?.providerMessageId) return existing

  // Abuse guard: cap outbound candidate emails per organization per rolling
  // hour. Independent of the Free-tier conversation cap (which meters product
  // usage) — this bounds how much mail one org can relay if a paid account is
  // hijacked. Shared with interview invitations via the same counter. Runs
  // after the idempotency check so retries don't consume budget.
  await assertOutboundMessageLimit(orgId)

  const latestMessage = await db.query.candidateMessage.findFirst({
    where: eq(candidateMessage.conversationId, conversation.id),
    orderBy: [desc(candidateMessage.createdAt)],
  })
  const latestInbound = await db.query.candidateMessage.findFirst({
    where: and(
      eq(candidateMessage.conversationId, conversation.id),
      eq(candidateMessage.direction, 'inbound'),
    ),
    orderBy: [desc(candidateMessage.createdAt)],
  })
  const subject = latestMessage ? replySubject(latestMessage.subject) : body.subject
  const references = appendReference(latestInbound?.references, latestInbound?.internetMessageId)
  const now = new Date()

  const alreadySent = await db.transaction(async (tx) => {
    // Serialize Free allowance reservations per organization so overlapping
    // sends cannot both claim the fifth and final conversation slot.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`candidate-message:${orgId}`}))`,
    )

    const [current] = await tx.select().from(candidateMessage).where(and(
      eq(candidateMessage.id, body.requestId),
      eq(candidateMessage.organizationId, orgId),
    )).limit(1)

    if (current && current.conversationId !== conversation.id) {
      throw createError({ statusCode: 409, statusMessage: 'Request ID has already been used' })
    }
    if (current?.providerMessageId) return current

    // Replies into a started conversation are unlimited; only opening a new
    // conversation consumes one of the Free slots.
    if (!(await canSendIntoConversation(orgId, conversation.id, tier, tx))) {
      const used = await countStartedConversations(orgId, tx, conversationCapStartFor(tier))
      throw createError({
        statusCode: 402,
        statusMessage: `You've started all ${FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT} free candidate conversations. Upgrade to Solo to open more.`,
        data: {
          code: 'CANDIDATE_MESSAGE_LIMIT',
          tier,
          used,
          limit: FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT,
        },
      })
    }

    if (!current) {
      await tx.insert(candidateMessage).values({
        id: body.requestId,
        organizationId: orgId,
        conversationId: conversation.id,
        direction: 'outbound',
        status: 'queued',
        fromEmail: normalizeEmailAddress(env.RESEND_CANDIDATE_FROM_EMAIL),
        toEmail: normalizeEmailAddress(applicationRecord.candidate.email),
        subject,
        bodyText: body.body,
        inReplyTo: latestInbound?.internetMessageId,
        references,
        sentById: session.user.id,
      })
      await tx.update(candidateConversation).set({ lastMessageAt: now, updatedAt: now })
        .where(eq(candidateConversation.id, conversation.id))
    } else {
      await tx.update(candidateMessage).set({
        status: 'queued',
        errorCode: null,
        errorMessage: null,
        failedAt: null,
        updatedAt: now,
      }).where(eq(candidateMessage.id, current.id))
    }

    return null
  })

  if (alreadySent) return alreadySent

  try {
    let attachments = await db.query.candidateMessageAttachment.findMany({
      where: and(
        eq(candidateMessageAttachment.messageId, body.requestId),
        eq(candidateMessageAttachment.organizationId, orgId),
      ),
    })
    if (attachments.length === 0 && files.length > 0) {
      attachments = await persistOutboundAttachments(orgId, body.requestId, files)
    }

    const emailAttachments = await Promise.all(attachments.map(async attachment => ({
      filename: attachment.filename,
      content: (await downloadFromS3(attachment.storageKey)).toString('base64'),
      contentType: attachment.mimeType,
    })))

    const result = await sendCandidateMessageEmail({
      to: applicationRecord.candidate.email,
      subject,
      text: body.body,
      replyTo: candidateReplyAddress(conversation.replyToken, replyDomain),
      senderName: session.user.name || session.user.email,
      idempotencyKey: `candidate-message/${body.requestId}`,
      inReplyTo: latestInbound?.internetMessageId,
      references,
      organizationId: orgId,
      conversationId: conversation.id,
      messageId: body.requestId,
      attachments: emailAttachments,
    })
    const sentAt = new Date()
    // Only advance to "sent" if no provider status webhook has landed yet. A
    // delivered/bounced/failed event can match this row by its `message` tag and
    // write `providerStatusAt` before this post-send update runs; clobbering it
    // with "sent" would leave the recruiter seeing a false status forever.
    const [sent] = await db.update(candidateMessage).set({
      status: 'sent',
      fromEmail: normalizeEmailAddress(result.from),
      providerMessageId: result.id,
      sentAt,
      updatedAt: sentAt,
    }).where(and(
      eq(candidateMessage.id, body.requestId),
      eq(candidateMessage.organizationId, orgId),
      isNull(candidateMessage.providerStatusAt),
    )).returning()
    if (sent) return sent

    // A status webhook already advanced this row; return the authoritative state.
    const [current] = await db.select().from(candidateMessage).where(and(
      eq(candidateMessage.id, body.requestId),
      eq(candidateMessage.organizationId, orgId),
    )).limit(1)
    return current
  }
  catch (error) {
    const failedAt = new Date()
    await db.update(candidateMessage).set({
      status: 'failed',
      failedAt,
      errorCode: 'send_failed',
      errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown send error',
      updatedAt: failedAt,
    }).where(and(eq(candidateMessage.id, body.requestId), eq(candidateMessage.organizationId, orgId)))
    logError('candidate_message.send_failed', {
      organization_id: orgId,
      conversation_id: conversation.id,
      error_message: error instanceof Error ? error.message : String(error),
    })
    throw createError({ statusCode: 502, statusMessage: 'Message could not be sent. It is safe to retry.' })
  }
})

async function readCandidateMessageRequest(event: Parameters<typeof getHeader>[0]) {
  const contentType = getHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return {
      body: await readValidatedBody(event, sendCandidateMessageSchema.parse),
      files: [] as ValidatedCandidateMessageAttachment[],
    }
  }

  // Bound how much we buffer into memory before readMultipartFormData reads the
  // body. A finite Content-Length is required: Node frames the request body to
  // exactly that many bytes, so validating the header here caps the actual
  // buffered size. This also rejects chunked/Transfer-Encoding uploads that omit
  // Content-Length — those would otherwise skip this guard and let the body grow
  // unbounded in memory. The per-file and total-size limits below still apply to
  // the actual bytes received.
  const declaredBytes = Number(getHeader(event, 'content-length'))
  if (!Number.isFinite(declaredBytes)) {
    throw createError({ statusCode: 411, statusMessage: 'A Content-Length header is required for attachment uploads.' })
  }
  if (declaredBytes > CANDIDATE_MESSAGE_MAX_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Attachments can be at most 20 MB in total.' })
  }

  const form = await readMultipartFormData(event)
  if (!form) throw createError({ statusCode: 400, statusMessage: 'No message data received' })

  const field = (name: string) => form.find(part => part.name === name && !part.filename)?.data.toString('utf8')
  const parsed = sendCandidateMessageSchema.safeParse({
    applicationId: field('applicationId'),
    requestId: field('requestId'),
    subject: field('subject'),
    body: field('body'),
  })
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid message data' })
  const body = parsed.data

  try {
    const files = await validateCandidateMessageAttachments(
      form
        .filter(part => part.name === 'attachments' && part.filename)
        .map(part => ({ data: part.data, filename: part.filename })),
    )
    return { body, files }
  }
  catch (error) {
    if (error instanceof CandidateMessageAttachmentError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
}

async function persistOutboundAttachments(
  orgId: string,
  messageId: string,
  files: ValidatedCandidateMessageAttachment[],
) {
  const attemptedKeys: string[] = []
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`candidate-message-attachments:${messageId}`}))`)
      const current = await tx.select().from(candidateMessageAttachment).where(and(
        eq(candidateMessageAttachment.messageId, messageId),
        eq(candidateMessageAttachment.organizationId, orgId),
      ))
      if (current.length > 0) return current

      const values = files.map((file) => {
        const id = crypto.randomUUID()
        return {
          id,
          organizationId: orgId,
          messageId,
          storageKey: `${orgId}/candidate-messages/${messageId}/${id}.${file.extension}`,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          data: file.data,
        }
      })
      for (const value of values) {
        attemptedKeys.push(value.storageKey)
        await uploadToS3(value.storageKey, value.data, value.mimeType)
      }
      return tx.insert(candidateMessageAttachment).values(values.map(({ data: _, ...value }) => value)).returning()
    })
  }
  catch (error) {
    await Promise.allSettled(attemptedKeys.map(key => deleteFromS3(key)))
    throw error
  }
}
