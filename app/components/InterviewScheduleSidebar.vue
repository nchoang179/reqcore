<script setup lang="ts">
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Plus,
  RefreshCw,
  Send,
  Users,
  X,
} from 'lucide-vue-next'
import type { Interview, InterviewDelivery, InterviewMutationResult } from '~/composables/useInterviews'

const props = withDefaults(defineProps<{
  applicationId: string
  candidateName: string
  jobTitle: string
  interview?: Interview | null
  teleportTarget?: string | HTMLElement
  /**
   * Opened from the "Interview" status transition — offer moving the candidate
   * into the interview stage without scheduling anything here (teams that book
   * interviews outside reqcore).
   */
  allowSkip?: boolean
}>(), {
  interview: null,
  teleportTarget: 'body',
  allowSkip: false,
})

const emit = defineEmits<{
  close: []
  scheduled: [createdInterview?: { id: string, googleCalendarEventLink?: string | null }]
  skip: []
}>()

const canSkip = computed(() => props.allowSkip && !props.interview)

type SavedInterview = {
  id: string
  googleCalendarEventLink?: string | null
  delivery: InterviewDelivery | null
}

const form = reactive({
  date: '',
  time: '10:00',
  duration: 60,
  type: 'video',
  location: '',
  interviewers: [''],
  personalNote: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
})

const errors = ref<Record<string, string>>({})
const isSubmitting = ref(false)
const isRetrying = ref(false)
const savedInterview = ref<SavedInterview | null>(null)
const isRescheduling = computed(() => !!props.interview)

const interviewTypes = [
  { value: 'video', label: 'Video call' },
  { value: 'phone', label: 'Phone call' },
  { value: 'in_person', label: 'In person' },
  { value: 'technical', label: 'Technical' },
  { value: 'panel', label: 'Panel' },
  { value: 'take_home', label: 'Take home' },
]
const durations = [15, 30, 45, 60, 90, 120]
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

onMounted(() => {
  if (props.interview) {
    const scheduledAt = new Date(props.interview.scheduledAt)
    form.date = localDate(scheduledAt)
    form.time = `${String(scheduledAt.getHours()).padStart(2, '0')}:${String(scheduledAt.getMinutes()).padStart(2, '0')}`
    form.duration = props.interview.duration
    form.type = props.interview.type
    form.location = props.interview.location ?? ''
    form.interviewers = props.interview.interviewers?.length ? [...props.interview.interviewers] : ['']
    form.personalNote = props.interview.personalNote ?? ''
    form.timezone = props.interview.timezone || form.timezone
    return
  }

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  form.date = localDate(tomorrow)
})

const formattedSchedule = computed(() => {
  if (!form.date || !form.time) return ''
  return new Date(`${form.date}T${form.time}`).toLocaleString([], {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
})

const manualFallbackHref = computed(() => {
  const fallback = savedInterview.value?.delivery?.manualFallback
  if (!fallback) return '#'
  return `mailto:${encodeURIComponent(fallback.to)}?subject=${encodeURIComponent(fallback.subject)}&body=${encodeURIComponent(fallback.body)}`
})

function addInterviewer() {
  form.interviewers.push('')
}

function removeInterviewer(index: number) {
  form.interviewers.splice(index, 1)
}

async function handleSubmit() {
  errors.value = {}
  const scheduledAt = new Date(`${form.date}T${form.time}`)
  if (!form.date || !form.time || Number.isNaN(scheduledAt.getTime())) {
    errors.value.schedule = 'Choose a valid date and time.'
  }
  else if (scheduledAt <= new Date()) {
    errors.value.schedule = 'Choose a time in the future.'
  }

  const interviewers = form.interviewers.map(value => value.trim()).filter(Boolean)
  if (interviewers.some(value => !emailPattern.test(value))) {
    errors.value.interviewers = 'Enter a valid email address for each interviewer.'
  }
  if (Object.keys(errors.value).length) return

  isSubmitting.value = true
  try {
    const details = {
      type: form.type,
      scheduledAt: scheduledAt.toISOString(),
      duration: form.duration,
      timezone: form.timezone,
    }
    if (props.interview) {
      const result = await $fetch<InterviewMutationResult>(`/api/interviews/${props.interview.id}`, {
        method: 'PATCH',
        body: {
          ...details,
          location: form.location.trim() || null,
          interviewers: interviewers.length ? interviewers : null,
          personalNote: form.personalNote.trim() || null,
          status: 'scheduled',
          notifyCandidate: true,
        },
      })
      savedInterview.value = {
        id: props.interview.id,
        googleCalendarEventLink: props.interview.googleCalendarEventLink,
        delivery: result.delivery,
      }
    }
    else {
      savedInterview.value = await $fetch<SavedInterview>('/api/interviews', {
        method: 'POST',
        body: {
          applicationId: props.applicationId,
          ...details,
          location: form.location.trim() || undefined,
          interviewers: interviewers.length ? interviewers : undefined,
          personalNote: form.personalNote.trim() || undefined,
        },
      })
    }
    await refreshNuxtData('interviews')
  }
  catch (error: any) {
    errors.value.submit = error?.data?.statusMessage
      ?? `The interview could not be ${isRescheduling.value ? 'rescheduled' : 'scheduled'}.`
  }
  finally {
    isSubmitting.value = false
  }
}

async function retryDelivery() {
  const interviewId = savedInterview.value?.id
  if (!interviewId) return

  isRetrying.value = true
  errors.value.delivery = ''
  try {
    const result = await $fetch<{ success: boolean, delivery: InterviewDelivery }>(`/api/interviews/${interviewId}/send-invitation`, {
      method: 'POST',
    })
    savedInterview.value = {
      ...savedInterview.value!,
      delivery: result.delivery,
    }
    await refreshNuxtData('interviews')
  }
  catch (error: any) {
    errors.value.delivery = error?.data?.statusMessage ?? 'The candidate notification could not be retried.'
  }
  finally {
    isRetrying.value = false
  }
}

function finish() {
  const saved = savedInterview.value
  emit('scheduled', saved ? { id: saved.id, googleCalendarEventLink: saved.googleCalendarEventLink } : undefined)
}
</script>

<template>
  <Teleport :to="teleportTarget">
    <div class="fixed inset-0 z-[70] flex justify-end">
      <button class="absolute inset-0 bg-black/45" aria-label="Close scheduling" @click="savedInterview ? finish() : emit('close')" />

      <section class="relative flex h-full w-full max-w-xl flex-col border-l border-surface-200 bg-white shadow-2xl dark:border-surface-800 dark:bg-surface-900">
        <header class="flex shrink-0 items-start justify-between border-b border-surface-200 px-5 py-4 dark:border-surface-800">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <Calendar class="size-4 text-brand-600 dark:text-brand-400" />
              <h2 class="text-base font-semibold text-surface-900 dark:text-white">
                {{ savedInterview
                  ? isRescheduling ? 'Interview rescheduled' : 'Interview scheduled'
                  : isRescheduling ? 'Reschedule interview' : 'Schedule interview' }}
              </h2>
            </div>
            <p class="mt-1 truncate text-sm text-surface-500 dark:text-surface-400">
              {{ candidateName }} · {{ jobTitle }}
            </p>
          </div>
          <button
            type="button"
            class="grid size-8 shrink-0 place-items-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200"
            aria-label="Close"
            @click="savedInterview ? finish() : emit('close')"
          >
            <X class="size-4" />
          </button>
        </header>

        <template v-if="savedInterview">
          <div class="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center">
            <div
              class="grid size-12 place-items-center rounded-lg"
              :class="savedInterview.delivery?.messageStatus === 'sent'
                ? 'bg-success-50 text-success-600 dark:bg-success-950/40 dark:text-success-400'
                : 'bg-warning-50 text-warning-700 dark:bg-warning-950/40 dark:text-warning-400'"
            >
              <CheckCircle2 v-if="savedInterview.delivery?.messageStatus === 'sent'" class="size-6" />
              <AlertCircle v-else class="size-6" />
            </div>

            <h3 class="mt-4 text-lg font-semibold text-surface-900 dark:text-white">
              {{ savedInterview.delivery?.messageStatus === 'sent'
                ? isRescheduling ? 'Update sent' : 'Proposal sent'
                : isRescheduling ? 'Interview rescheduled, update not sent' : 'Interview saved, proposal not sent' }}
            </h3>
            <p class="mt-2 max-w-sm text-sm leading-6 text-surface-500 dark:text-surface-400">
              <template v-if="savedInterview.delivery?.messageStatus === 'sent'">
                The {{ isRescheduling ? 'update' : 'proposal' }} is in the candidate conversation with a calendar invitation attached.
              </template>
              <template v-else>
                {{ savedInterview.delivery?.errorMessage ?? 'The interview was saved, but no candidate notification was sent.' }}
              </template>
            </p>
            <p v-if="errors.delivery" class="mt-3 max-w-sm text-sm text-danger-600 dark:text-danger-400">
              {{ errors.delivery }}
            </p>

            <div class="mt-6 flex w-full max-w-sm flex-col gap-2">
              <button
                v-if="savedInterview.delivery?.messageStatus !== 'sent' && savedInterview.delivery?.errorCode !== 'candidate_message_limit'"
                type="button"
                :disabled="isRetrying"
                class="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                @click="retryDelivery"
              >
                <RefreshCw class="size-4" :class="{ 'animate-spin': isRetrying }" />
                {{ isRetrying ? 'Retrying…' : 'Retry notification' }}
              </button>
              <NuxtLink
                v-if="savedInterview.delivery?.errorCode === 'candidate_message_limit'"
                :to="$localePath('/dashboard/settings/billing')"
                class="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Upgrade to keep the thread in Reqcore
                <ExternalLink class="size-4" />
              </NuxtLink>
              <a
                v-if="savedInterview.delivery?.manualFallback"
                :href="manualFallbackHref"
                class="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-surface-300 px-4 text-sm font-medium text-surface-700 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
              >
                <Mail class="size-4" />
                Open manual email
              </a>
              <NuxtLink
                :to="$localePath(`/dashboard/inbox?applicationId=${applicationId}`)"
                class="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-surface-300 px-4 text-sm font-medium text-surface-700 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
              >
                View conversation
              </NuxtLink>
            </div>
          </div>

          <footer class="shrink-0 border-t border-surface-200 p-4 dark:border-surface-800">
            <button type="button" class="h-10 w-full rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700" @click="finish">
              Done
            </button>
          </footer>
        </template>

        <template v-else>
          <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="handleSubmit">
            <div class="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <div v-if="errors.submit" class="flex gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-950/30 dark:text-danger-300">
                <AlertCircle class="mt-0.5 size-4 shrink-0" />
                {{ errors.submit }}
              </div>

              <fieldset>
                <legend class="mb-2 flex items-center gap-2 text-sm font-medium text-surface-700 dark:text-surface-300">
                  <Calendar class="size-4 text-surface-400" /> Date and time
                </legend>
                <div class="grid grid-cols-2 gap-3">
                  <input v-model="form.date" type="date" required class="h-10 min-w-0 rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-900 focus:border-brand-500 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-white" />
                  <input v-model="form.time" type="time" required class="h-10 min-w-0 rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-900 focus:border-brand-500 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-white" />
                </div>
                <p v-if="errors.schedule" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400">{{ errors.schedule }}</p>
                <p class="mt-2 flex items-center gap-1.5 text-xs text-surface-400 dark:text-surface-500">
                  <Globe class="size-3.5" /> {{ form.timezone }}
                </p>
              </fieldset>

              <div>
                <label for="interview-duration" class="mb-2 flex items-center gap-2 text-sm font-medium text-surface-700 dark:text-surface-300">
                  <Clock class="size-4 text-surface-400" /> Duration
                </label>
                <select id="interview-duration" v-model="form.duration" class="h-10 w-full rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-900 focus:border-brand-500 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-white">
                  <option v-for="duration in durations" :key="duration" :value="duration">{{ duration }} minutes</option>
                </select>
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label for="interview-type" class="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Format</label>
                  <select id="interview-type" v-model="form.type" class="h-10 w-full rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-900 focus:border-brand-500 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-white">
                    <option v-for="type in interviewTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
                  </select>
                </div>
                <div>
                  <label for="interview-location" class="mb-2 flex items-center gap-2 text-sm font-medium text-surface-700 dark:text-surface-300">
                    <MapPin class="size-4 text-surface-400" /> Location
                  </label>
                  <input id="interview-location" v-model="form.location" type="text" maxlength="500" placeholder="Link or address" class="h-10 w-full rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-900 placeholder:text-surface-400 focus:border-brand-500 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-white" />
                </div>
              </div>

              <div>
                <div class="mb-2 flex items-center justify-between">
                  <label class="flex items-center gap-2 text-sm font-medium text-surface-700 dark:text-surface-300">
                    <Users class="size-4 text-surface-400" /> Interviewers
                  </label>
                  <button type="button" class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/30" @click="addInterviewer">
                    <Plus class="size-3.5" /> Add
                  </button>
                </div>
                <div class="space-y-2">
                  <div v-for="(_, index) in form.interviewers" :key="index" class="flex gap-2">
                    <input v-model="form.interviewers[index]" type="email" placeholder="interviewer@company.com" class="h-10 min-w-0 flex-1 rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-900 placeholder:text-surface-400 focus:border-brand-500 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-white" />
                    <button v-if="form.interviewers.length > 1" type="button" class="grid size-10 place-items-center rounded-lg text-surface-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-950/30" aria-label="Remove interviewer" @click="removeInterviewer(index)">
                      <X class="size-4" />
                    </button>
                  </div>
                </div>
                <p v-if="errors.interviewers" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400">{{ errors.interviewers }}</p>
              </div>

              <div>
                <label for="personal-note" class="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Personal note <span class="font-normal text-surface-400">(optional)</span></label>
                <textarea id="personal-note" v-model="form.personalNote" rows="3" maxlength="5000" placeholder="Add a note for the candidate" class="w-full resize-y rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 placeholder:text-surface-400 focus:border-brand-500 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-white" />
              </div>
            </div>

            <footer class="shrink-0 border-t border-surface-200 px-5 py-4 dark:border-surface-800">
              <p v-if="formattedSchedule" class="mb-3 truncate text-xs text-surface-500 dark:text-surface-400">{{ formattedSchedule }} · {{ form.duration }} min</p>
              <button
                v-if="canSkip"
                type="button"
                class="mb-3 w-full cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-surface-500 hover:bg-surface-50 hover:text-surface-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200"
                :disabled="isSubmitting"
                @click="emit('skip')"
              >
                Skip — move to Interview without scheduling
              </button>
              <div class="flex gap-3">
                <button type="button" class="h-10 flex-1 rounded-lg border border-surface-300 px-4 text-sm font-medium text-surface-700 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800" :disabled="isSubmitting" @click="emit('close')">Cancel</button>
                <button type="submit" class="inline-flex h-10 flex-[1.5] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="isSubmitting">
                  <RefreshCw v-if="isSubmitting" class="size-4 animate-spin" />
                  <Send v-else class="size-4" />
                  {{ isSubmitting ? 'Sending…' : isRescheduling ? 'Reschedule and send' : 'Send proposal' }}
                </button>
              </div>
            </footer>
          </form>
        </template>
      </section>
    </div>
  </Teleport>
</template>
