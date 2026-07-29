<script setup lang="ts">
import { ArrowRight, Briefcase, FlaskConical, Plus, UploadCloud } from 'lucide-vue-next'

const localePath = useLocalePath()
</script>

<template>
  <section class="mx-auto flex min-h-[calc(100svh-10rem)] w-full max-w-2xl items-center px-4 py-10 sm:px-6">
    <div class="w-full">
      <div class="mx-auto max-w-lg text-center">
        <div class="mx-auto mb-5 flex size-12 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900">
          <Briefcase class="size-6" />
        </div>
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">Start recruiting</h1>
        <p class="mt-2 text-sm leading-relaxed text-surface-500 dark:text-surface-400">
          Create a job to manage applicants in a pipeline, or import existing candidates into your talent pool.
        </p>
      </div>

      <NuxtLink
        :to="localePath('/dashboard/jobs/new')"
        class="group mx-auto mt-7 flex w-full max-w-lg items-center justify-between rounded-lg bg-brand-600 px-4 py-3.5 text-white shadow-sm transition-colors hover:bg-brand-700 no-underline"
      >
        <span class="flex min-w-0 items-center gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
            <Plus class="size-5" />
          </span>
          <span class="min-w-0 text-left">
            <span class="block text-sm font-semibold">Create a new job</span>
            <span class="block text-xs text-brand-100">Set up a role and applicant pipeline</span>
          </span>
        </span>
        <ArrowRight class="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </NuxtLink>

      <div class="mx-auto my-5 flex max-w-lg items-center gap-3" aria-hidden="true">
        <div class="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
        <span class="text-xs font-medium text-surface-400 dark:text-surface-500">or</span>
        <div class="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
      </div>

      <div class="mx-auto grid max-w-lg gap-3 sm:grid-cols-2">
        <NuxtLink
          :to="localePath('/dashboard/candidates/import')"
          class="flex min-w-0 items-start gap-3 rounded-lg border border-surface-200 bg-white p-4 text-left no-underline transition-colors hover:border-brand-300 hover:bg-surface-50 dark:border-surface-800 dark:bg-surface-900 dark:hover:border-brand-800 dark:hover:bg-surface-800/60"
        >
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300">
          <UploadCloud class="size-4" />
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">Import from file</span>
            <span class="mt-1 block text-xs leading-relaxed text-surface-500 dark:text-surface-400">Upload a CSV directly to the candidate pool.</span>
          </span>
        </NuxtLink>

        <!--
          The escape hatch for someone who is evaluating rather than hiring. A
          test role behaves exactly like a real one — it just never reaches the
          public board, the career page or the job boards, so trying the product
          out cannot litter surfaces that real candidates see.
        -->
        <NuxtLink
          :to="localePath({ path: '/dashboard/jobs/new', query: { mode: 'test' } })"
          class="flex min-w-0 items-start gap-3 rounded-lg border border-surface-200 bg-white p-4 text-left no-underline transition-colors hover:border-brand-300 hover:bg-surface-50 dark:border-surface-800 dark:bg-surface-900 dark:hover:border-brand-800 dark:hover:bg-surface-800/60"
        >
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300">
            <FlaskConical class="size-4" />
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">Create a test job</span>
            <span class="mt-1 block text-xs leading-relaxed text-surface-500 dark:text-surface-400">Try the full flow privately. Stays off job boards.</span>
          </span>
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
