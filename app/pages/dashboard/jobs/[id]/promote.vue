<script setup lang="ts">
import { Megaphone } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const jobId = route.params.id as string

const { job } = useJob(jobId)

useSeoMeta({
  title: computed(() =>
    job.value ? `Promote — ${job.value.title} — Reqcore` : 'Promote — Reqcore',
  ),
})
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6">
    <header class="mb-6">
      <h1 class="flex items-center gap-2 text-xl font-bold text-surface-900 dark:text-surface-100">
        <Megaphone class="size-5 text-brand-600 dark:text-brand-400" />
        Promote this job
      </h1>
      <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
        Everything that brings applicants to <strong>{{ job?.title }}</strong>.
      </p>
    </header>

    <JobPromotePanel :job-id="jobId" />
  </div>
</template>
