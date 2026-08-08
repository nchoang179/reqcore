<script setup lang="ts">
import { Eye, X, ShieldCheck, Sparkles } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { message } = usePreviewReadOnly()

function closeModal() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50" @click="closeModal" />

      <div class="relative w-full max-w-2xl overflow-hidden rounded-xl border border-surface-200 bg-white shadow-2xl shadow-surface-950/15 dark:border-surface-800 dark:bg-surface-950 dark:shadow-black/40">
        <div class="h-1 bg-gradient-to-r from-brand-500 via-violet-500 to-emerald-400" />

        <div class="flex items-center justify-between border-b border-surface-200 px-5 py-4 dark:border-surface-800">
          <div class="flex items-center gap-2">
            <Eye class="size-5 text-brand-600 dark:text-brand-400" />
            <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Create your own Reqcore workspace</h3>
          </div>

          <button
            class="cursor-pointer text-surface-400 transition-colors hover:text-surface-600 dark:hover:text-surface-200"
            @click="closeModal"
          >
            <X class="size-5" />
          </button>
        </div>

        <div class="grid gap-5 px-5 py-5 md:grid-cols-[0.75fr_1.25fr]">
          <div class="space-y-4">
            <div class="rounded-lg border border-brand-100 bg-brand-50/70 p-4 dark:border-brand-900/70 dark:bg-brand-950/20">
              <div class="flex items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-300">
                <Sparkles class="size-4" />
                You're exploring the live demo
              </div>
              <p class="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                {{ message }}
              </p>
            </div>

            <div class="space-y-2 text-xs text-surface-500 dark:text-surface-400">
              <div class="flex items-center gap-2">
                <ShieldCheck class="size-4 text-emerald-500" />
                A private workspace for your data
              </div>
              <div class="flex items-center gap-2">
                <ShieldCheck class="size-4 text-emerald-500" />
                Full editing access
              </div>
              <div class="flex items-center gap-2">
                <ShieldCheck class="size-4 text-emerald-500" />
                Invite your team when you're ready
              </div>
            </div>
          </div>

          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500">
              Create your account
            </p>
            <DemoSignupOptions @select="closeModal" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
