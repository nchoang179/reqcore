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
                Sent to {{ data.feed.boards.map(b => b.label).join(', ') }}. Boards refresh every few hours.
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

