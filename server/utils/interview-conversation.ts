import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import {
  candidateConversation,
  candidateMessage,
  interview,
  organization,
} from '../database/schema'
import { type BillingTier, tierUsesFreeAllowances } from '../../shared/billing'
import { canSendIntoConversation } from '../../ee/server/utils/candidate-message-allowance'
import { sendCandidateMessageEmail } from './email'
import { assertOutboundMessageLimit } from './candidate-message-rate-limit'
import {
  appendReference,
  candidateReplyAddress,
  normalizeEmailAddress,
  replySubject,
} from '../../ee/server/utils/candidate-messaging'
import { requireCandidateMessagingConfig } from '../../ee/server/utils/candidate-messaging-config'
import { buildICalendarAttachment, generateCancellationICS, generateInterviewICS } from './ical'
import { buildResponseUrl } from './interview-token'

type InterviewMessageKind = 'interview_proposal' | 'interview_update' | 'interview_cancellation'

export interface InterviewConversationDelivery {
  messageId: string
  conversationId: string
  messageStatus: 'sent' | 'failed'
  calendarAttachmentStatus: 'attached' | 'failed'
  errorCode: string | null
  errorMessage: string | null
  manualFallback: { to: string, subject: string, body: string } | null
}

const TYPE_LABELS: Record<string, string> = {
  video: 'Video interview',
  phone: 'Phone interview',
  in_person: 'In-person interview',
  technical: 'Technical interview',
  panel: 'Panel interview',
  take_home: 'Take-home interview',
}

function publicBaseUrl(): string {
  return env.BETTER_AUTH_URL
    || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '')
    || 'https://reqcore.com'
}

function formatSchedule(date: Date, timezone: string, duration: number): { date: string, time: string } {
  return {
    date: date.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: timezone,
    }),
    time: date.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: timezone,
    }),
  }
}

export function buildInterviewConversationBody(params: {
  kind: InterviewMessageKind
  candidateFirstName: string
  title: string
  type: string
  date: string
  time: string
  duration: number
  location: string | null
  interviewers: string[] | null
  personalNote: string | null
}): string {
  const heading = params.kind === 'interview_cancellation'
    ? `The ${params.title} has been cancelled.`
    : params.kind === 'interview_update'
      ? `The details for ${params.title} have been updated.`
      : `We'd like to invite you to ${params.title}.`

  const lines = [
    `Hi ${params.candidateFirstName},`,
    '',
    heading,
  ]

  if (params.kind !== 'interview_cancellation') {
    lines.push(
      '',
      `Date: ${params.date}`,
      `Time: ${params.time}`,
      `Duration: ${params.duration} minutes`,
      `Format: ${TYPE_LABELS[params.type] ?? params.type}`,
      ...(params.location ? [`Location: ${params.location}`] : []),
      ...(params.interviewers?.length ? [`Interviewers: ${params.interviewers.join(', ')}`] : []),
      ...(params.personalNote ? ['', params.personalNote] : []),
      '',
      'Use the response button in this email. The calendar event is for scheduling.',
    )
  }

  return lines.join('\n')
}

export async function sendInterviewConversationMessage(params: {
  interviewId: string
  organizationId: string
  sender: { id: string, name?: string | null, email: string, emailVerified: boolean }
  tier: BillingTier
  bypassAllowance?: boolean
  retry?: boolean
}): Promise<InterviewConversationDelivery> {
  assertEmailVerified(params.sender)

  const record = await db.query.interview.findFirst({
    where: and(eq(interview.id, params.interviewId), eq(interview.organizationId, params.organizationId)),
    with: {
      application: {
        with: {
          candidate: { columns: { firstName: true, lastName: true, email: true, quarantinedAt: true } },
          job: { columns: { title: true } },
        },
      },
    },
  })
  if (!record) throw createError({ statusCode: 404, statusMessage: 'Interview not found' })
  if (record.application.candidate.quarantinedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Restore this candidate before sending an interview proposal' })
  }

  // Abuse guard: interview invitations share the outbound candidate-email
  // channel, so they count against the same per-org rolling-hour cap. Throws
  // 429 when the org has relayed too much mail this hour. Fails safe — for the
  // create/update flows the interview row already persists and the recruiter
  // can resend the invitation once the window clears.
  await assertOutboundMessageLimit(params.organizationId)

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, params.organizationId),
    columns: { name: true },
  })
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Organization not found' })

  let conversation = await db.query.candidateConversation.findFirst({
    where: and(
      eq(candidateConversation.applicationId, record.applicationId),
      eq(candidateConversation.organizationId, params.organizationId),
    ),
  })
  if (!conversation) {
    await db.insert(candidateConversation).values({
      organizationId: params.organizationId,
      applicationId: record.applicationId,
    }).onConflictDoNothing({ target: candidateConversation.applicationId })
    conversation = await db.query.candidateConversation.findFirst({
      where: and(
        eq(candidateConversation.applicationId, record.applicationId),
        eq(candidateConversation.organizationId, params.organizationId),
      ),
    })
  }
  if (!conversation) throw createError({ statusCode: 500, statusMessage: 'Could not create candidate conversation' })

  const [latestMessage, latestInbound, latestInterviewMessage] = await Promise.all([
    db.query.candidateMessage.findFirst({
      where: eq(candidateMessage.conversationId, conversation.id),
      orderBy: [desc(candidateMessage.createdAt)],
    }),
    db.query.candidateMessage.findFirst({
      where: and(eq(candidateMessage.conversationId, conversation.id), eq(candidateMessage.direction, 'inbound')),
      orderBy: [desc(candidateMessage.createdAt)],
    }),
    db.query.candidateMessage.findFirst({
      where: eq(candidateMessage.interviewId, record.id),
      orderBy: [desc(candidateMessage.createdAt)],
    }),
  ])

  const retryMessage = params.retry && latestInterviewMessage?.status === 'failed'
    ? latestInterviewMessage
    : null
  const kind: InterviewMessageKind = record.status === 'cancelled'
    ? 'interview_cancellation'
    : record.invitationSentAt
      ? 'interview_update'
      : 'interview_proposal'
  const sequence = retryMessage?.calendarSequence
    ?? ((latestInterviewMessage?.calendarSequence ?? -1) + 1)
  const scheduledAt = new Date(record.scheduledAt)
  const schedule = formatSchedule(scheduledAt, record.timezone || 'UTC', record.duration)
  const responseUrl = kind === 'interview_cancellation'
    ? null
    : buildResponseUrl(publicBaseUrl(), record.id, env.BETTER_AUTH_SECRET)
  const body = buildInterviewConversationBody({
    kind,
    candidateFirstName: record.application.candidate.firstName,
    title: record.title,
    type: record.type,
    date: schedule.date,
    time: schedule.time,
    duration: record.duration,
    location: record.location,
    interviewers: record.interviewers,
    personalNote: record.personalNote,
  })
  const subject = latestMessage
    ? replySubject(latestMessage.subject)
    : `Interview invitation: ${record.application.job.title}`
  const messageId = retryMessage?.id ?? crypto.randomUUID()
  const candidateName = `${record.application.candidate.firstName} ${record.application.candidate.lastName}`
  const organizerEmail = normalizeEmailAddress(env.RESEND_CANDIDATE_FROM_EMAIL)
  const references = appendReference(latestInbound?.references, latestInbound?.internetMessageId)

  let icsContent: string
  try {
    icsContent = kind === 'interview_cancellation'
      ? generateCancellationICS({
          interviewId: record.id,
          summary: record.title,
          startTime: scheduledAt,
          durationMinutes: record.duration,
          organizerName: params.sender.name || org.name,
          organizerEmail,
          attendeeEmail: record.application.candidate.email,
          attendeeName: candidateName,
          sequence: Math.max(0, sequence - 1),
        })
      : generateInterviewICS({
          interviewId: record.id,
          summary: record.title,
          description: `${record.title}\n${record.application.job.title}\n${body}`,
          startTime: scheduledAt,
          durationMinutes: record.duration,
          location: record.location,
          organizerName: params.sender.name || org.name,
          organizerEmail,
          attendeeEmail: record.application.candidate.email,
          attendeeName: candidateName,
          sequence,
        })
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message.slice(0, 1000) : 'Calendar invitation generation failed'
    await persistFailedMessage({
      id: messageId,
      conversationId: conversation.id,
      organizationId: params.organizationId,
      interviewId: record.id,
      kind,
      fromEmail: organizerEmail,
      toEmail: record.application.candidate.email,
      subject,
      body,
      senderId: params.sender.id,
      sequence,
      calendarStatus: 'failed',
      errorCode: 'calendar_attachment_failed',
      errorMessage,
      retry: !!retryMessage,
    })
    return deliveryResult(messageId, conversation.id, 'failed', errorMessage, record.application.candidate.email, subject, body, 'calendar_attachment_failed')
  }

  const now = new Date()
  const reserved = await db.transaction(async (tx) => {
    if (!params.bypassAllowance && tierUsesFreeAllowances(params.tier)) {
      // An interview request opens (or reuses) a candidate conversation. Sending
      // into an already-started conversation is unlimited; a first message only
      // goes through while the org has a free conversation slot left.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`candidate-message:${params.organizationId}`}))`)
      if (!(await canSendIntoConversation(params.organizationId, conversation.id, params.tier, tx))) return false
    }

    if (retryMessage) {
      await tx.update(candidateMessage).set({
        status: 'queued',
        kind,
        subject,
        bodyText: body,
        calendarAttachmentStatus: 'attached',
        calendarAttachmentError: null,
        errorCode: null,
        errorMessage: null,
        failedAt: null,
        updatedAt: now,
      }).where(eq(candidateMessage.id, messageId))
    }
    else {
      await tx.insert(candidateMessage).values({
        id: messageId,
        organizationId: params.organizationId,
        conversationId: conversation.id,
        direction: 'outbound',
        status: 'queued',
        fromEmail: organizerEmail,
        toEmail: normalizeEmailAddress(record.application.candidate.email),
        subject,
        bodyText: body,
        kind,
        interviewId: record.id,
        calendarAttachmentStatus: 'attached',
        calendarSequence: sequence,
        inReplyTo: latestInbound?.internetMessageId,
        references,
        sentById: params.sender.id,
      })
    }
    await tx.update(candidateConversation).set({ lastMessageAt: now, updatedAt: now })
      .where(eq(candidateConversation.id, conversation.id))
    return true
  })

  if (!reserved) {
    const errorMessage = 'Free candidate conversation limit reached. Upgrade to preserve replies, confirmations, calendar updates, and shared history.'
    await persistFailedMessage({
      id: messageId,
      conversationId: conversation.id,
      organizationId: params.organizationId,
      interviewId: record.id,
      kind,
      fromEmail: organizerEmail,
      toEmail: record.application.candidate.email,
      subject,
      body,
      senderId: params.sender.id,
      sequence,
      calendarStatus: 'attached',
      errorCode: 'candidate_message_limit',
      errorMessage,
      retry: !!retryMessage,
    })
    return deliveryResult(messageId, conversation.id, 'attached', errorMessage, record.application.candidate.email, subject, body, 'candidate_message_limit')
  }

  try {
    const { replyDomain } = requireCandidateMessagingConfig()
    const sendResult = await sendCandidateMessageEmail({
      to: record.application.candidate.email,
      subject,
      text: body,
      replyTo: candidateReplyAddress(conversation.replyToken, replyDomain),
      senderName: params.sender.name || params.sender.email,
      idempotencyKey: `candidate-message/${messageId}`,
      inReplyTo: latestInbound?.internetMessageId,
      references,
      organizationId: params.organizationId,
      conversationId: conversation.id,
      messageId,
      actionLinks: responseUrl
        ? [{ label: 'Respond to invitation', url: responseUrl, emphasis: true }]
        : undefined,
      attachments: [buildICalendarAttachment(
        icsContent,
        kind === 'interview_cancellation' ? 'CANCEL' : 'REQUEST',
      )],
    })
    const sentAt = new Date()
    await Promise.all([
      // Only advance to "sent" if no provider status webhook has landed yet. A
      // delivered/bounced/failed event can match this row by its `message` tag and
      // write `providerStatusAt` before this post-send update runs; clobbering it
      // with "sent" would leave the recruiter seeing a false status forever.
      db.update(candidateMessage).set({
        status: 'sent',
        fromEmail: normalizeEmailAddress(sendResult.from),
        providerMessageId: sendResult.id,
        sentAt,
        updatedAt: sentAt,
      }).where(and(eq(candidateMessage.id, messageId), isNull(candidateMessage.providerStatusAt))),
      kind !== 'interview_cancellation'
        ? db.update(interview).set({ invitationSentAt: sentAt, updatedAt: sentAt }).where(eq(interview.id, record.id))
        : Promise.resolve(),
    ])
    return {
      messageId,
      conversationId: conversation.id,
      messageStatus: 'sent',
      calendarAttachmentStatus: 'attached',
      errorCode: null,
      errorMessage: null,
      manualFallback: null,
    }
  }
  catch (error) {
    const failedAt = new Date()
    const errorMessage = error instanceof Error ? error.message.slice(0, 1000) : 'Message could not be sent'
    await db.update(candidateMessage).set({
      status: 'failed',
      failedAt,
      errorCode: 'send_failed',
      errorMessage,
      updatedAt: failedAt,
    }).where(eq(candidateMessage.id, messageId))
    logError('interview.conversation_delivery_failed', {
      organization_id: params.organizationId,
      interview_id: record.id,
      conversation_id: conversation.id,
      error_message: errorMessage,
    })
    return deliveryResult(messageId, conversation.id, 'attached', errorMessage, record.application.candidate.email, subject, body)
  }
}

async function persistFailedMessage(params: {
  id: string
  conversationId: string
  organizationId: string
  interviewId: string
  kind: InterviewMessageKind
  fromEmail: string
  toEmail: string
  subject: string
  body: string
  senderId: string
  sequence: number
  calendarStatus: 'attached' | 'failed'
  errorCode: string
  errorMessage: string
  retry: boolean
}) {
  const now = new Date()
  const values = {
    status: 'failed' as const,
    kind: params.kind,
    subject: params.subject,
    bodyText: params.body,
    calendarAttachmentStatus: params.calendarStatus,
    calendarAttachmentError: params.calendarStatus === 'failed' ? params.errorMessage : null,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    failedAt: now,
    updatedAt: now,
  }
  if (params.retry) {
    await db.update(candidateMessage).set(values).where(eq(candidateMessage.id, params.id))
  }
  else {
    await db.insert(candidateMessage).values({
      id: params.id,
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      direction: 'outbound',
      ...values,
      fromEmail: params.fromEmail,
      toEmail: normalizeEmailAddress(params.toEmail),
      interviewId: params.interviewId,
      calendarSequence: params.sequence,
      sentById: params.senderId,
    })
  }
  await db.update(candidateConversation).set({ lastMessageAt: now, updatedAt: now })
    .where(eq(candidateConversation.id, params.conversationId))
}

function deliveryResult(
  messageId: string,
  conversationId: string,
  calendarAttachmentStatus: 'attached' | 'failed',
  errorMessage: string,
  to: string,
  subject: string,
  body: string,
  errorCode = 'send_failed',
): InterviewConversationDelivery {
  return {
    messageId,
    conversationId,
    messageStatus: 'failed',
    calendarAttachmentStatus,
    errorCode,
    errorMessage,
    manualFallback: { to, subject, body },
  }
}
