import type { MaybeRefOrGetter } from 'vue'

export interface Interview {
  id: string
  title: string
  type: 'phone' | 'video' | 'in_person' | 'panel' | 'technical' | 'take_home'
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  scheduledAt: string
  duration: number
  location: string | null
  notes: string | null
  personalNote: string | null
  interviewers: string[] | null
  invitationSentAt: string | null
  candidateResponse: 'pending' | 'accepted' | 'declined' | 'tentative'
  candidateRespondedAt: string | null
  googleCalendarEventId: string | null
  googleCalendarEventLink: string | null
  timezone: string
  latestDelivery?: {
    id: string
    kind: 'message' | 'interview_proposal' | 'interview_update' | 'interview_cancellation' | 'interview_response'
    status: 'queued' | 'sent' | 'delivered' | 'delayed' | 'bounced' | 'failed' | 'complained'
    calendarAttachmentStatus: 'not_applicable' | 'attached' | 'failed'
    calendarAttachmentError: string | null
    errorCode: string | null
    errorMessage: string | null
    sentAt: string | null
    deliveredAt: string | null
    failedAt: string | null
  } | null
  applicationId: string
  candidateId: string
  candidateFirstName: string
  candidateLastName: string
  candidateEmail: string
  candidatePhone?: string | null
  jobId: string
  jobTitle: string
  createdAt: string
  updatedAt: string
}

export interface InterviewDelivery {
  messageId: string
  conversationId: string
  messageStatus: 'sent' | 'failed'
  calendarAttachmentStatus: 'attached' | 'failed'
  errorCode: string | null
  errorMessage: string | null
  manualFallback: { to: string, subject: string, body: string } | null
}

export interface InterviewMutationResult {
  id: string
  status: Interview['status']
  delivery: InterviewDelivery | null
  notification: {
    intent: 'proposal' | 'update' | 'cancellation' | null
    attempted: boolean
    status: 'sent' | 'failed' | 'not_required'
    messageId: string | null
    reason: 'no_prior_invitation' | 'internal_status_only' | null
  }
}

export function useInterviewMutationFeedback() {
  const toast = useToast()

  function reportStatus(status: Interview['status'], result: InterviewMutationResult, candidateEmail: string) {
    if (status === 'cancelled') {
      if (result.delivery?.messageStatus === 'failed') {
        toast.error('Interview cancelled, cancellation not sent', {
          message: result.delivery.errorMessage ?? 'Retry the cancellation from the interview or candidate conversation.',
        })
      }
      else if (result.delivery?.messageStatus === 'sent') {
        toast.success('Interview cancelled', `Cancellation sent to ${candidateEmail}.`)
      }
      else {
        toast.success('Interview cancelled', 'The candidate was not notified because no interview proposal had been sent.')
      }
      return
    }

    if (status === 'no_show') {
      toast.success('Marked as no-show', 'Internal status only. The candidate was not notified.')
      return
    }

    if (status === 'completed') {
      toast.success('Interview completed', 'Internal status only. The candidate was not notified.')
    }
  }

  function reportCandidateUpdate(result: InterviewMutationResult, candidateEmail: string, label = 'Interview updated') {
    if (result.delivery?.messageStatus === 'failed') {
      toast.error(`${label}, candidate update not sent`, {
        message: result.delivery.errorMessage ?? 'Retry the update from the interview or candidate conversation.',
      })
    }
    else if (result.delivery?.messageStatus === 'sent') {
      toast.success(label, `Update sent to ${candidateEmail}.`)
    }
    else {
      toast.success(label, 'No candidate message was required.')
    }
  }

  return { reportStatus, reportCandidateUpdate }
}

interface InterviewListResponse {
  data: Interview[]
  total: number
  page: number
  limit: number
}

/**
 * Composable for listing interviews with filters.
 */
export function useInterviews(options?: {
  applicationId?: MaybeRefOrGetter<string | undefined>
  jobId?: MaybeRefOrGetter<string | undefined>
  status?: MaybeRefOrGetter<string | undefined>
  from?: MaybeRefOrGetter<string | undefined>
  to?: MaybeRefOrGetter<string | undefined>
  order?: MaybeRefOrGetter<'asc' | 'desc' | 'scheduled_first' | undefined>
  limit?: MaybeRefOrGetter<number | undefined>
}) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()

  const query = computed(() => {
    const q: Record<string, string | number> = {}
    if (options?.applicationId) {
      const v = toValue(options.applicationId)
      if (v) q.applicationId = v
    }
    if (options?.jobId) {
      const v = toValue(options.jobId)
      if (v) q.jobId = v
    }
    if (options?.status) {
      const v = toValue(options.status)
      if (v) q.status = v
    }
    if (options?.from) {
      const v = toValue(options.from)
      if (v) q.from = v
    }
    if (options?.to) {
      const v = toValue(options.to)
      if (v) q.to = v
    }
    if (options?.order) {
      const v = toValue(options.order)
      if (v) q.order = v
    }
    if (options?.limit) {
      const v = toValue(options.limit)
      if (v) q.limit = v
    }
    return q
  })

  const fetchKey = computed(() => {
    const parts = ['interviews']
    const q = query.value
    for (const [k, v] of Object.entries(q)) {
      parts.push(`${k}:${v}`)
    }
    return parts.join('-')
  })

  const { data, status, error, refresh } = useFetch<InterviewListResponse>('/api/interviews', {
    key: fetchKey,
    query,
    headers: useRequestHeaders(['cookie']),
  })

  const interviews = computed(() => data.value?.data ?? [])
  const total = computed(() => data.value?.total ?? 0)

  async function createInterview(payload: {
    applicationId: string
    title: string
    type?: Interview['type']
    scheduledAt: string
    duration?: number
    location?: string
    notes?: string
    personalNote?: string
    interviewers?: string[]
    timezone?: string
  }) {
    try {
      const created = await $fetch('/api/interviews', {
        method: 'POST',
        body: payload,
      })
      await refresh()
      return created
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
  }

  async function updateInterview(id: string, payload: Partial<{
    title: string
    type: Interview['type']
    status: Interview['status']
    scheduledAt: string
    duration: number
    location: string | null
    notes: string | null
    personalNote: string | null
    interviewers: string[] | null
  }>) {
    try {
      const updated = await $fetch<InterviewMutationResult>(`/api/interviews/${id}`, {
        method: 'PATCH',
        body: payload,
      })
      await refresh()
      return updated
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
  }

  async function deleteInterviewById(id: string) {
    try {
      await $fetch(`/api/interviews/${id}`, { method: 'DELETE' })
      await refresh()
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
  }

  return { interviews, total, status, error, refresh, createInterview, updateInterview, deleteInterviewById }
}

/**
 * Composable for a single interview detail with update/delete mutations.
 */
export function useInterview(id: MaybeRefOrGetter<string>) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()
  const interviewId = computed(() => toValue(id))

  const { data: interview, status, error, refresh } = useFetch<Interview>(
    () => `/api/interviews/${interviewId.value}`,
    {
      key: computed(() => `interview-${interviewId.value}`),
      headers: useRequestHeaders(['cookie']),
    },
  )

  async function updateInterview(payload: Partial<{
    title: string
    type: Interview['type']
    status: Interview['status']
    scheduledAt: string
    duration: number
    location: string | null
    notes: string | null
    personalNote: string | null
    interviewers: string[] | null
  }>) {
    try {
      const updated = await $fetch<InterviewMutationResult>(`/api/interviews/${interviewId.value}`, {
        method: 'PATCH',
        body: payload,
      })
      await refresh()
      await refreshNuxtData('interviews')
      return updated
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
  }

  async function deleteInterview() {
    try {
      await $fetch(`/api/interviews/${interviewId.value}`, {
        method: 'DELETE',
      })
      await refreshNuxtData('interviews')
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
  }

  return { interview, status, error, refresh, updateInterview, deleteInterview }
}
