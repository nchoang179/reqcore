<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'

/**
 * Delete control shown only on test jobs in the jobs list. Test roles are
 * throwaway by design, so the confirm is inline rather than a modal — but it
 * still exists, since deleting a job takes its applications with it.
 *
 * Rendered inside cards that are themselves links, so every handler stops and
 * prevents the click before the surrounding navigation can fire.
 */
const props = defineProps<{
  jobId: string
}>()

const { deleteJob } = useJobs()
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const toast = useToast()
const { track } = useTrack()

const confirming = ref(false)
const isDeleting = ref(false)

async function remove() {
  isDeleting.value = true
  try {
    track('job_deleted', { job_id: props.jobId, source: 'jobs_list_test' })
    // Refreshes the shared `jobs` list, which unmounts this button with its row.
    await deleteJob(props.jobId)
  } catch (err: any) {
    if (!handlePreviewReadOnlyError(err)) {
      toast.error('Failed to delete test job', { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
    }
    isDeleting.value = false
    confirming.value = false
  }
}
</script>

<template>
  <div class="inline-flex items-center gap-1.5 shrink-0">
    <template v-if="confirming">
      <span class="text-[11px] text-surface-500 dark:text-surface-400">Delete test job?</span>
      <button
        type="button"
        :disabled="isDeleting"
        class="cursor-pointer rounded-md bg-danger-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-danger-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        @click.stop.prevent="remove"
      >
        {{ isDeleting ? 'Deleting…' : 'Yes' }}
      </button>
      <button
        type="button"
        :disabled="isDeleting"
        class="cursor-pointer rounded-md border border-surface-300 dark:border-surface-700 px-2 py-1 text-[11px] font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 transition-colors"
        @click.stop.prevent="confirming = false"
      >
        Cancel
      </button>
    </template>
    <button
      v-else
      type="button"
      aria-label="Delete test job"
      title="Delete test job"
      class="cursor-pointer rounded-md p-1 text-surface-400 dark:text-surface-500 hover:bg-danger-50 dark:hover:bg-danger-950/40 hover:text-danger-600 dark:hover:text-danger-400 transition-colors"
      @click.stop.prevent="confirming = true"
    >
      <Trash2 class="size-3.5" />
    </button>
  </div>
</template>
