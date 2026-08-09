import type { BillingTier } from '~~/shared/billing'
import type { CandidateMessageAttachmentInfo } from '~~/shared/candidate-messaging'

export type CandidateMessageKind = 'message' | 'interview_proposal' | 'interview_update' | 'interview_cancellation' | 'interview_response'

export function candidateMessageKindLabel(kind: CandidateMessageKind): string | null {
  const labels: Record<CandidateMessageKind, string | null> = {
    message: null,
    interview_proposal: 'Interview proposal',
    interview_update: 'Interview update',
    interview_cancellation: 'Interview cancellation',
    interview_response: 'Interview response',
  }
  return labels[kind]
}

export interface CandidateMessageSummary {
  id: string
  direction: 'inbound' | 'outbound'
  status: CandidateMessageStatus
  subject: string
  bodyText: string
  kind: CandidateMessageKind
  interviewId: string | null
  createdAt: string
}

export type CandidateMessageStatus = 'queued' | 'sent' | 'delivered' | 'delayed' | 'bounced' | 'failed' | 'complained'

export interface CandidateConversationSummary {
  id: string
  applicationId: string
  unreadCount: number
  lastMessageAt: string | null
  application: {
    id: string
    status: string
    candidate: { id: string, firstName: string, lastName: string, email: string }
    job: { id: string, title: string }
  }
  messages: CandidateMessageSummary[]
}

export interface CandidateConversation extends Omit<CandidateConversationSummary, 'messages'> {
  messages: Array<CandidateMessageSummary & {
    fromEmail: string
    toEmail: string
    sentAt: string | null
    deliveredAt: string | null
    failedAt: string | null
    errorCode: string | null
    errorMessage: string | null
    calendarAttachmentStatus: 'not_applicable' | 'attached' | 'failed'
    calendarAttachmentError: string | null
    attachments: CandidateMessageAttachmentInfo[]
    sentBy: { id: string, name: string, email: string } | null
  }>
}

export interface CandidateMessageAllowance {
  tier: BillingTier
  used: number
  limit: number | null
  remaining: number | null
  canSend: boolean
}

export function useCandidateMessages() {
  const conversations = ref<CandidateConversationSummary[]>([])
  const selected = ref<CandidateConversation | null>(null)
  const loadingList = ref(false)
  const loadingConversation = ref(false)
  const error = ref<unknown>(null)
  const allowance = ref<CandidateMessageAllowance>({
    tier: 'free',
    used: 0,
    limit: null,
    remaining: null,
    canSend: true,
  })

  async function loadInbox(query: { applicationId?: string, jobId?: string, unread?: boolean, limit?: number } = {}) {
    if (loadingList.value) return
    loadingList.value = true
    try {
      const result = await $fetch<{
        data: CandidateConversationSummary[]
        allowance: CandidateMessageAllowance
      }>('/api/candidate-messages', { query })
      conversations.value = result.data
      allowance.value = result.allowance
      error.value = null
    } catch (err) {
      error.value = err
      throw err
    } finally {
      loadingList.value = false
    }
  }

  async function loadConversation(id: string, options: { markRead?: boolean } = {}) {
    loadingConversation.value = true
    try {
      selected.value = await $fetch<CandidateConversation>(`/api/candidate-messages/${id}`)
      if (options.markRead !== false && selected.value.unreadCount > 0) {
        // Best effort: the conversation is already loaded, and read-only
        // contexts (the shared demo) reject the write. Never fail the load.
        try {
          await $fetch(`/api/candidate-messages/${id}/read`, { method: 'POST' })
          selected.value.unreadCount = 0
          const summary = conversations.value.find(item => item.id === id)
          if (summary) summary.unreadCount = 0
        } catch {
          // keep the unread badge as-is
        }
      }
    } finally {
      loadingConversation.value = false
    }
  }

  async function sendMessage(payload: {
    applicationId: string
    requestId: string
    subject: string
    body: string
    attachments?: File[]
  }) {
    const form = new FormData()
    form.append('applicationId', payload.applicationId)
    form.append('requestId', payload.requestId)
    form.append('subject', payload.subject)
    form.append('body', payload.body)
    for (const attachment of payload.attachments ?? []) form.append('attachments', attachment)

    const result = await $fetch('/api/candidate-messages/send', { method: 'POST', body: form })
    await loadInbox()
    const conversation = conversations.value.find(item => item.applicationId === payload.applicationId)
    if (conversation) await loadConversation(conversation.id, { markRead: false })
    return result
  }

  return {
    conversations,
    selected,
    loadingList,
    loadingConversation,
    error,
    allowance,
    loadInbox,
    loadConversation,
    sendMessage,
  }
}
