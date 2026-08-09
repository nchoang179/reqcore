import type { WebhookEventPayload } from 'resend'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import {
  candidateConversation,
  candidateMessage,
  candidateMessageAttachment,
  candidateMessageWebhookEvent,
} from '~~/server/database/schema'
import { enqueueNotification } from '~~/server/utils/notifications/enqueue'
import { getResendClient, getResendReceivingClient } from '~~/server/utils/email'
import { processNotificationStatusEvent } from '~~/server/utils/notifications/delivery-status'
import { deleteFromS3, uploadToS3 } from '~~/server/utils/s3'
import {
  CANDIDATE_MESSAGE_MAX_ATTACHMENT_BYTES,
  CANDIDATE_MESSAGE_MAX_ATTACHMENTS,
  CANDIDATE_MESSAGE_MAX_TOTAL_ATTACHMENT_BYTES,
} from '~~/shared/candidate-messaging'
import { restoreCandidateForEngagement } from '~~/server/utils/candidate-retention'
import {
  findReplyToken,
  inboundTextContent,
  isKnownConversationSender,
  normalizeEmailAddress,
  parseReferences,
} from '../../utils/candidate-messaging'
import {
  CandidateMessageAttachmentError,
  shouldStoreInboundAttachment,
  validateCandidateMessageAttachments,
  type ValidatedCandidateMessageAttachment,
} from '../../utils/candidate-message-attachments'
import { requireCandidateMessagingConfig } from '../../utils/candidate-messaging-config'

const STATUS_BY_EVENT = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.failed': 'failed',
  'email.complained': 'complained',
} as const

export default defineEventHandler(async (event) => {
  const webhookSecret = env.RESEND_WEBHOOK_SECRET
  if (!webhookSecret) {
    throw createError({ statusCode: 503, statusMessage: 'Resend webhook is not configured' })
  }
  const payload = await readRawBody(event, 'utf8')
  const webhookId = getHeader(event, 'svix-id')
  const timestamp = getHeader(event, 'svix-timestamp')
  const signature = getHeader(event, 'svix-signature')
  if (!payload || !webhookId || !timestamp || !signature || !webhookSecret) {
    throw createError({ statusCode: 400, statusMessage: 'Missing webhook payload or signature headers' })
  }

  const resend = getResendReceivingClient() ?? getResendClient()
  if (!resend) throw createError({ statusCode: 503, statusMessage: 'Resend is not configured' })

  let verified: WebhookEventPayload
  try {
    verified = resend.webhooks.verify({
      payload,
      headers: { id: webhookId, timestamp, signature },
      webhookSecret,
    })
  }
  catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
  }

  const providerMessageId = 'email_id' in verified.data ? verified.data.email_id : null
  const occurredAt = new Date(verified.created_at)
  await db.insert(candidateMessageWebhookEvent).values({
    id: webhookId,
    type: verified.type,
    providerMessageId,
    occurredAt,
  }).onConflictDoNothing({ target: candidateMessageWebhookEvent.id })

  const existingEvent = await db.query.candidateMessageWebhookEvent.findFirst({
    where: eq(candidateMessageWebhookEvent.id, webhookId),
    columns: { processedAt: true },
  })
  if (existingEvent?.processedAt) return { received: true, duplicate: true }

  try {
    if (verified.type === 'email.received') {
      const { replyDomain } = requireCandidateMessagingConfig()
      await processInboundMessage(verified, replyDomain)
    } else if (verified.type in STATUS_BY_EVENT) {
      await processStatusEvent(verified as StatusWebhookEvent)
    }

    await db.update(candidateMessageWebhookEvent).set({ processedAt: new Date(), lastError: null })
      .where(eq(candidateMessageWebhookEvent.id, webhookId))
    return { received: true }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.update(candidateMessageWebhookEvent).set({ lastError: message.slice(0, 1000) })
      .where(eq(candidateMessageWebhookEvent.id, webhookId))
    logError('candidate_message.webhook_failed', {
      webhook_id: webhookId,
      event_type: verified.type,
      error_message: message,
    })
    throw createError({ statusCode: 500, statusMessage: 'Webhook processing failed' })
  }
})

type StatusWebhookEvent = Extract<WebhookEventPayload, { type: keyof typeof STATUS_BY_EVENT }>

async function processStatusEvent(event: StatusWebhookEvent): Promise<void> {
  // Recruiter notifications share this webhook — route their delivery events to
  // the outbox instead of the candidate-message table.
  if (event.data.tags?.category === 'notification') {
    await processNotificationStatusEvent(event)
    return
  }

  const status = STATUS_BY_EVENT[event.type]
  const eventAt = new Date(event.created_at)
  const taggedMessageId = event.data.tags?.message
  const identity = taggedMessageId
    ? or(eq(candidateMessage.providerMessageId, event.data.email_id), eq(candidateMessage.id, taggedMessageId))
    : eq(candidateMessage.providerMessageId, event.data.email_id)
  const error = statusError(event)

  await db.update(candidateMessage).set({
    status,
    providerMessageId: event.data.email_id,
    providerStatusAt: eventAt,
    ...(status === 'sent' ? { sentAt: eventAt } : {}),
    ...(status === 'delivered' ? { deliveredAt: eventAt, errorCode: null, errorMessage: null } : {}),
    ...(['bounced', 'failed', 'complained'].includes(status) ? { failedAt: eventAt } : {}),
    ...(error ? { errorCode: error.code, errorMessage: error.message.slice(0, 1000) } : {}),
    updatedAt: new Date(),
  }).where(and(
    identity,
    or(isNull(candidateMessage.providerStatusAt), lte(candidateMessage.providerStatusAt, eventAt)),
  ))
}

function statusError(event: StatusWebhookEvent): { code: string, message: string } | null {
  if (event.type === 'email.bounced') {
    return { code: event.data.bounce.type, message: event.data.bounce.message }
  }
  if (event.type === 'email.failed') {
    return { code: 'failed', message: event.data.failed.reason }
  }
  if (event.type === 'email.complained') {
    return { code: 'complained', message: 'The recipient marked this message as spam' }
  }
  return null
}

async function processInboundMessage(
  event: Extract<WebhookEventPayload, { type: 'email.received' }>,
  replyDomain: string,
): Promise<void> {
  const token = findReplyToken(event.data.to, replyDomain)
  if (!token) {
    logWarn('candidate_message.inbound_unroutable', { provider_message_id: event.data.email_id })
    return
  }

  const conversation = await db.query.candidateConversation.findFirst({
    where: eq(candidateConversation.replyToken, token),
    with: {
      application: {
        with: {
          candidate: { columns: { email: true, firstName: true, lastName: true } },
          job: { columns: { title: true } },
        },
      },
    },
  })
  if (!conversation) {
    logWarn('candidate_message.inbound_unknown_token', { provider_message_id: event.data.email_id })
    return
  }

  const fromEmail = normalizeEmailAddress(event.data.from)
  const priorAddresses = await db
    .selectDistinct({
      address: sql<string>`case when ${candidateMessage.direction} = 'outbound'
        then ${candidateMessage.toEmail} else ${candidateMessage.fromEmail} end`,
    })
    .from(candidateMessage)
    .where(eq(candidateMessage.conversationId, conversation.id))
  if (!isKnownConversationSender(fromEmail, [
    conversation.application.candidate.email,
    ...priorAddresses.map(row => row.address),
  ])) {
    logWarn('candidate_message.inbound_sender_mismatch', {
      organization_id: conversation.organizationId,
      conversation_id: conversation.id,
    })
    return
  }

  const resend = getResendReceivingClient()
  if (!resend) throw new Error('Resend Receiving is not configured')
  const { data, error } = await resend.emails.receiving.get(event.data.email_id)
  if (error || !data) throw new Error(error?.message ?? 'Inbound email content was unavailable')

  await restoreCandidateForEngagement(
    conversation.organizationId,
    conversation.application.candidateId,
    'candidate_message',
  )

  const header = (name: string) => {
    const entry = Object.entries(data.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())
    return entry?.[1]
  }
  const createdAt = new Date(data.created_at)
  const bodyText = inboundTextContent(data.text, data.html)
  const candidateName = `${conversation.application.candidate.firstName} ${conversation.application.candidate.lastName}`.trim()
  const { storedMessage, shouldNotify } = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(candidateMessage).values({
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      direction: 'inbound',
      status: 'delivered',
      fromEmail,
      toEmail: normalizeEmailAddress(data.to[0] ?? event.data.to[0] ?? ''),
      subject: data.subject || event.data.subject || '(No subject)',
      bodyText,
      providerMessageId: data.id,
      internetMessageId: data.message_id,
      inReplyTo: header('in-reply-to'),
      references: parseReferences(header('references')),
      providerStatusAt: createdAt,
      sentAt: createdAt,
      deliveredAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    }).onConflictDoNothing().returning({ id: candidateMessage.id })

    const storedMessage = inserted ?? await tx.query.candidateMessage.findFirst({
      where: eq(candidateMessage.providerMessageId, data.id),
      columns: { id: true },
    })
    if (!storedMessage) throw new Error('Inbound message could not be persisted')

    if (inserted) {
      await tx.update(candidateConversation).set({
        unreadCount: sql`${candidateConversation.unreadCount} + 1`,
        lastMessageAt: createdAt,
        updatedAt: new Date(),
      }).where(eq(candidateConversation.id, conversation.id))
    }
    return { storedMessage, shouldNotify: Boolean(inserted) }
  })

  if (shouldNotify) {
    await enqueueNotification({
      organizationId: conversation.organizationId,
      type: 'candidate_replied',
      dedupeKey: `candidate_replied:${storedMessage.id}`,
      payload: {
        applicationId: conversation.applicationId,
        conversationId: conversation.id,
        candidateName,
        jobTitle: conversation.application.job.title,
        preview: bodyText.slice(0, 200),
      },
    })
  }

  if (data.attachments.length > 0) {
    await captureInboundAttachments({
      resend,
      emailId: data.id,
      messageId: storedMessage.id,
      orgId: conversation.organizationId,
    })
  }
}

async function captureInboundAttachments(input: {
  resend: NonNullable<ReturnType<typeof getResendReceivingClient>>
  emailId: string
  messageId: string
  orgId: string
}): Promise<void> {
  const { data: page, error } = await input.resend.emails.receiving.attachments.list({
    emailId: input.emailId,
  })
  if (error || !page) throw new Error(error?.message ?? 'Inbound attachment metadata was unavailable')

  const existing = await db.query.candidateMessageAttachment.findMany({
    where: eq(candidateMessageAttachment.messageId, input.messageId),
    columns: { providerAttachmentId: true, sizeBytes: true },
  })
  const existingProviderIds = new Set(existing.map(row => row.providerAttachmentId).filter(Boolean))
  let storedCount = existing.length
  let totalBytes = existing.reduce((sum, row) => sum + row.sizeBytes, 0)

  for (const attachment of page.data) {
    if (storedCount >= CANDIDATE_MESSAGE_MAX_ATTACHMENTS) break
    if (existingProviderIds.has(attachment.id)) continue
    if (!shouldStoreInboundAttachment({
      contentDisposition: attachment.content_disposition,
      contentId: attachment.content_id,
    })) continue
    if (attachment.size > CANDIDATE_MESSAGE_MAX_ATTACHMENT_BYTES) {
      logWarn('candidate_message.inbound_attachment_skipped', {
        organization_id: input.orgId,
        reason: 'file_size_limit',
      })
      continue
    }
    if (totalBytes + attachment.size > CANDIDATE_MESSAGE_MAX_TOTAL_ATTACHMENT_BYTES) {
      logWarn('candidate_message.inbound_attachment_skipped', {
        organization_id: input.orgId,
        reason: 'total_size_limit',
      })
      continue
    }

    const response = await fetch(attachment.download_url, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`Inbound attachment download failed with status ${response.status}`)
    const fileData = Buffer.from(await response.arrayBuffer())

    let validated: ValidatedCandidateMessageAttachment | undefined
    try {
      const files = await validateCandidateMessageAttachments([{
        data: fileData,
        filename: attachment.filename || 'attachment',
      }])
      validated = files[0]
    }
    catch (validationError) {
      if (validationError instanceof CandidateMessageAttachmentError) {
        logWarn('candidate_message.inbound_attachment_skipped', {
          organization_id: input.orgId,
          reason: validationError.message,
        })
        continue
      }
      throw validationError
    }
    if (!validated) continue

    const id = crypto.randomUUID()
    const storageKey = `${input.orgId}/candidate-messages/${input.messageId}/${id}.${validated.extension}`
    await uploadToS3(storageKey, validated.data, validated.mimeType)
    try {
      const inserted = await db.insert(candidateMessageAttachment).values({
        id,
        organizationId: input.orgId,
        messageId: input.messageId,
        storageKey,
        filename: validated.filename,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        providerAttachmentId: attachment.id,
      }).onConflictDoNothing({ target: candidateMessageAttachment.providerAttachmentId }).returning({
        id: candidateMessageAttachment.id,
      })
      if (inserted.length === 0) {
        await deleteFromS3(storageKey)
        continue
      }
      storedCount++
      totalBytes += validated.sizeBytes
    }
    catch (insertError) {
      await deleteFromS3(storageKey).catch(cleanupError => logWarn('candidate_message.attachment_cleanup_failed', {
        organization_id: input.orgId,
        error_message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      }))
      throw insertError
    }
  }
}
