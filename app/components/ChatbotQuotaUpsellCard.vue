<script setup lang="ts">
/**
 * Composer replacement for Free workspaces that have spent their assistant
 * allowance. Conversation history remains readable; this card gives billing
 * managers a focused path into Solo checkout and points other members to the
 * billing page without presenting a button they cannot use.
 */
import { ArrowRight, Bot, Check, CreditCard, Sparkles } from 'lucide-vue-next'
import { getBillingPlan } from '~~/shared/billing'

const props = defineProps<{
  limit: number
  canManage?: boolean
  permissionLoading?: boolean
}>()

const localePath = useLocalePath()
const solo = getBillingPlan('solo')!

const upgradeTarget = computed(() => {
  const path = localePath('/dashboard/settings/billing')
  if (!props.canManage) return path

  return {
    path,
    query: buildBillingCheckoutQuery({ planId: 'solo', cadence: 'monthly' }),
  }
})
</script>

<template>
  <section
    aria-labelledby="chatbot-quota-heading"
    class="relative overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-lg shadow-brand-950/5 dark:border-brand-900/70 dark:bg-surface-900 dark:shadow-black/20"
  >
    <div class="h-[3px] bg-gradient-to-r from-brand-500 via-violet-500 to-fuchsia-500" />
    <div class="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-brand-500/10 blur-3xl dark:bg-brand-500/[0.08]" />

    <div class="relative grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
      <div class="flex min-w-0 items-start gap-3.5">
        <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-sm shadow-brand-500/30">
          <Bot class="size-5" />
        </div>

        <div class="min-w-0">
          <div class="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
            <Sparkles class="size-3" />
            Free assistant limit reached
          </div>
          <h2 id="chatbot-quota-heading" class="text-lg font-semibold tracking-tight text-surface-950 dark:text-white">
            Keep the conversation going with Solo
          </h2>
          <p class="mt-1 max-w-xl text-sm leading-relaxed text-surface-600 dark:text-surface-300">
            Your workspace has used all {{ limit }} free assistant messages. Your conversations are safe and stay readable.
            Solo adds a monthly Reqcore AI allowance, or you can connect your own AI key.
          </p>

          <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-medium text-surface-600 dark:text-surface-300">
            <li class="inline-flex items-center gap-1.5">
              <Check class="size-3.5 text-success-500" />
              Keep chatting with your pipeline
            </li>
            <li class="inline-flex items-center gap-1.5">
              <Check class="size-3.5 text-success-500" />
              Bring your own AI key
            </li>
            <li class="inline-flex items-center gap-1.5">
              <Check class="size-3.5 text-success-500" />
              Unlimited AI shortlists
            </li>
          </ul>
        </div>
      </div>

      <div class="sm:min-w-56 sm:border-l sm:border-surface-200 sm:pl-5 dark:sm:border-surface-800">
        <div class="flex items-baseline gap-1 text-surface-950 dark:text-white">
          <span class="text-2xl font-bold">${{ solo.monthlyPrice }}</span>
          <span class="text-xs text-surface-500 dark:text-surface-400">/ month</span>
        </div>
        <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
          Flat workspace price · no seat fees
        </p>

        <NuxtLink
          :to="upgradeTarget"
          class="group mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white no-underline shadow-sm shadow-brand-500/25 transition-all hover:-translate-y-px hover:shadow-md hover:shadow-brand-500/35 active:translate-y-0"
        >
          <CreditCard class="size-4" />
          <span v-if="permissionLoading">View billing</span>
          <span v-else-if="canManage">Upgrade to Solo</span>
          <span v-else>View Solo plan</span>
          <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
        </NuxtLink>
        <p v-if="!permissionLoading && !canManage" class="mt-2 text-center text-[11px] leading-snug text-surface-400 dark:text-surface-500">
          An organization owner or admin can upgrade your workspace.
        </p>
      </div>
    </div>
  </section>
</template>
