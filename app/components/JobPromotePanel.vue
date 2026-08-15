<script setup lang="ts">
/**
 * Internal job distribution only.
 *
 * Reqcore runs as a private, logged-in application: the public application
 * link, branded career page and social share pack have been removed, so the
 * only remaining "promotion" surface is which external job boards the role is
 * syndicated to. That is a job-level preference with no public URL, so a
 * recruiter can still control board distribution from here.
 */
import { Loader2, CheckCircle2, AlertCircle, CircleSlash, Rss } from 'lucide-vue-next'

const props = defineProps<{
  jobId: string
  /** Kept for API compatibility with the wizard; both renders are identical. */
  compact?: boolean
}>()

const toast = useToast()
const { track } = useTrack()
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const localePath = useLocalePath()

const { data, status, refresh } = await useFetch(`/api/jobs/${props.jobId}/promote`, {
  key: `job-promote-${props.jobId}`,
})

const { allowed: canUpdateJob } = usePermission({ job: ['update'] })

const canToggleDistribution = computed(() =>
  Boolean(data.value) && !data.value?.job.isTest && canUpdateJob.value,
)

const isTogglingDistribution = ref(false)

async function setDistributeToBoards(next: boolean) {
  if (isTogglingDistribution.value) return
  isTogglingDistribution.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}`, {
      method: 'PATCH',
      body: { distributeToBoards: next },
    })
    await refresh()
    await refreshNuxtData(`job-${props.jobId}`)
    track('job_distribution_toggled', { job_id: props.jobId, enabled: next })
    toast.success(
      next ? 'Sent to job boards' : 'Removed from job boards',
      next
        ? 'It appears on the boards at their next refresh.'
        : 'Boards drop it at their next refresh.',
    )
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Could not change job board distribution', {
      message: err?.data?.statusMessage,
      statusCode: err?.data?.statusCode,
    })
  } finally {
    isTogglingDistribution.value = false
  }
}

// ─────────────────────────────────────────────
// Per-board delivery
// ─────────────────────────────────────────────

/**
 * How each board's row reads.
 *
 * Every label is a statement about the feed, never about the board's site —
 * "collected" is the strongest thing a pull-based feed can evidence, and a
 * board decides on its own schedule what to do with what it collected. Saying
 * "live on Adzuna" here would be the same unbacked claim this panel used to
 * make for all seven at once.
 */
const DELIVERY_LABELS: Record<string, { text: string; dot: string; tone: string }> = {
  delivered: {
    text: 'Collected',
    dot: 'bg-success-500',
    tone: 'text-surface-600 dark:text-surface-400',
  },
  pending: {
    text: 'Next pull',
    dot: 'bg-brand-500',
    tone: 'text-surface-500 dark:text-surface-400',
  },
  dropped: {
    text: 'Not in last pull',
    dot: 'bg-warning-500',
    tone: 'text-warning-700 dark:text-warning-400',
  },
  never_fetched: {
    text: 'No pull recorded',
    dot: 'bg-surface-300 dark:bg-surface-600',
    tone: 'text-surface-400 dark:text-surface-500',
  },
}

const deliveredCount = computed(() =>
  data.value?.feed.deliveries.filter(d => d.state === 'delivered').length ?? 0,
)

/** Coarse on purpose: the exact minute a crawler called is noise to a recruiter. */
function since(value: string | Date | null): string | null {
  if (!value) return null
  const then = new Date(value).getTime()
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

onMounted(() => {
  track('promote_tab_viewed', { job_id: props.jobId })
})
</script>

<template>
  <div v-if="status === 'pending' && !data" class="flex items-center justify-center py-12">
    <Loader2 class="size-5 animate-spin text-surface-400" />
  </div>

  <div v-else-if="data" class="space-y-6">
    <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 overflow-hidden">
      <div class="border-b border-surface-100 dark:border-surface-800 px-5 py-4">
        <h3 class="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-surface-100">
          <Rss class="size-4 text-brand-600 dark:text-brand-400" />
          Where this job is live
        </h3>
        <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
          Which external job boards this role is syndicated to. Switch them off any time.
        </p>
      </div>

      <ul class="divide-y divide-surface-100 dark:divide-surface-800">
        <li class="px-5 py-3">
          <div class="flex items-start gap-3">
            <component
              :is="data.feed.eligible ? CheckCircle2 : data.job.distributeToBoards ? AlertCircle : CircleSlash"
              class="mt-0.5 size-4 shrink-0"
              :class="data.feed.eligible
                ? 'text-success-600 dark:text-success-400'
                : data.job.distributeToBoards
                  ? 'text-warning-600 dark:text-warning-400'
                  : 'text-surface-400 dark:text-surface-500'"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm text-surface-700 dark:text-surface-300">
                {{ data.feed.eligible
                  ? 'External job boards'
                  : data.job.distributeToBoards
                    ? 'External job boards — not yet'
                    : 'External job boards — off' }}
              </p>
              <p v-if="data.feed.eligible" class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                {{ deliveredCount
                  ? `Collected by ${deliveredCount} of ${data.feed.deliveries.length} boards.`
                  : 'Waiting for the boards to collect it.' }}
                Each board pulls the feed on its own schedule.
              </p>
              <p
                v-else
                class="mt-0.5 text-xs"
                :class="data.job.distributeToBoards
                  ? 'text-warning-700 dark:text-warning-400'
                  : 'text-surface-500 dark:text-surface-400'"
              >
                {{ data.feed.reason }}
              </p>
              <NuxtLink
                v-if="!data.feed.eligible && data.feed.fixable && data.feed.code !== 'opted_out'"
                :to="localePath(`/dashboard/jobs/${jobId}/settings`)"
                class="mt-1 inline-block text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
              >
                Fix in job settings
              </NuxtLink>

              <!-- One row per board. Present only while the job is eligible:
                   when it isn't, the reason above is the whole answer and
                   delivery history would read as a claim about a role that is
                   no longer going anywhere. -->
              <ul
                v-if="data.feed.eligible && data.feed.deliveries.length"
                class="mt-3 space-y-1.5 border-l border-surface-100 dark:border-surface-800 pl-3"
              >
                <li
                  v-for="d in data.feed.deliveries"
                  :key="d.board"
                  class="flex items-center gap-2 text-xs"
                >
                  <span class="size-1.5 shrink-0 rounded-full" :class="DELIVERY_LABELS[d.state]?.dot" />
                  <span class="min-w-0 flex-1 truncate text-surface-600 dark:text-surface-400">{{ d.label }}</span>
                  <span class="shrink-0 tabular-nums" :class="DELIVERY_LABELS[d.state]?.tone">
                    {{ DELIVERY_LABELS[d.state]?.text }}
                    <template v-if="d.state === 'delivered' && since(d.lastFetchedAt)">
                      · {{ since(d.lastFetchedAt) }}
                    </template>
                  </span>
                </li>
              </ul>
            </div>

            <button
              v-if="canToggleDistribution"
              type="button"
              role="switch"
              :aria-checked="data.job.distributeToBoards"
              :aria-label="data.job.distributeToBoards ? 'Stop sending this job to external job boards' : 'Send this job to external job boards'"
              :disabled="isTogglingDistribution"
              class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-surface-950"
              :class="data.job.distributeToBoards ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-700'"
              @click="setDistributeToBoards(!data.job.distributeToBoards)"
            >
              <span
                class="inline-block size-3.5 rounded-full bg-white shadow transition-transform"
                :class="data.job.distributeToBoards ? 'translate-x-[1.125rem]' : 'translate-x-[0.1875rem]'"
              />
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
