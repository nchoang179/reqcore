<script setup lang="ts">
/**
 * Always-visible Free-plan upgrade entry point in the dashboard top bar.
 *
 * Renders nothing unless the active org is on the free tier (Stripe billing
 * enabled, no paid subscription). Otherwise it's a compact "Upgrade" pill that
 * opens a popover with the live usage meters and a link to the billing page —
 * so the upsell and the org's current limits are reachable from every page,
 * not just buried in settings.
 */
import { Briefcase, ArrowRight, MessageCircle, MessageSquare, Sparkles, Zap } from 'lucide-vue-next'
import { getBillingPlan } from '~~/shared/billing'
import { freePlanUsage, useBillingStatus } from '~/composables/useBillingStatus'

// No top-level await: this renders inside the (already-async) top bar without a
// Suspense boundary of its own; the data ref fills in reactively once fetched.
const { data: status } = useBillingStatus()
const usage = computed(() => freePlanUsage(status.value))

// Highlight the pill when the org has hit one of its caps.
const atLimit = computed(() => {
  const u = usage.value
  if (!u) return false
  const hit = (m: { used: number, limit: number | null }) =>
    m.limit != null && Number.isFinite(m.limit) && m.used >= m.limit
  return hit(u.activeRoles) || hit(u.aiAnalysis) || hit(u.aiAssistant)
    || hit(u.candidateConversations)
})

const recommended = getBillingPlan('solo')!

const open = ref(false)
const route = useRoute()
watch(() => route.path, () => { open.value = false })
</script>

<template>
  <div v-if="usage" class="relative" @mouseenter="open = true" @mouseleave="open = false">
    <button
      type="button"
      class="group inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-white shadow-sm transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500/35 dark:focus-visible:ring-offset-surface-950 hover:-translate-y-px hover:shadow-md active:translate-y-0"
      :class="atLimit
        ? 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-500/25 hover:shadow-amber-500/35'
        : 'bg-gradient-to-r from-brand-600 to-violet-600 shadow-brand-500/25 hover:shadow-brand-500/35'"
      :aria-expanded="open"
      aria-haspopup="menu"
    >
      <Sparkles class="size-3.5 shrink-0 transition-transform duration-300 group-hover:rotate-12" />
      <span class="hidden sm:inline">{{ atLimit ? 'Limit reached' : 'Upgrade' }}</span>
    </button>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 -translate-y-1"
    >
      <div
        v-if="open"
        class="absolute right-0 top-[calc(100%+6px)] z-50 w-80 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/8 dark:shadow-surface-950/30"
      >
        <!-- Header -->
        <div class="flex items-center gap-3 border-b border-surface-100 dark:border-surface-800 bg-gradient-to-br from-brand-50/60 to-violet-50/60 dark:from-brand-950/20 dark:to-violet-950/20 px-4 py-3.5">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-sm shadow-brand-500/30">
            <Sparkles class="size-4" />
          </div>
          <div>
            <p class="text-sm font-semibold text-surface-900 dark:text-surface-100">Free plan</p>
            <p class="text-xs text-surface-500 dark:text-surface-400">Your current limits</p>
          </div>
        </div>

        <!-- Usage meters -->
        <div class="space-y-4 px-4 py-4">
          <UsageMeterBar label="Active roles" :icon="Briefcase" :used="usage.activeRoles.used" :limit="usage.activeRoles.limit" />
          <UsageMeterBar label="AI shortlist runs" :icon="Zap" :used="usage.aiAnalysis.used" :limit="usage.aiAnalysis.limit" />
          <UsageMeterBar
            label="Assistant credits"
            :icon="MessageCircle"
            :used="usage.aiAssistant.used"
            :limit="usage.aiAssistant.limit"
            :value-label="`${usage.aiAssistant.used}% used`"
          />
          <UsageMeterBar label="Candidate conversations" :icon="MessageSquare" :used="usage.candidateConversations.used" :limit="usage.candidateConversations.limit" />
        </div>

        <!-- CTA -->
        <div class="border-t border-surface-100 dark:border-surface-800 px-4 py-3">
          <NuxtLink
            :to="$localePath('/dashboard/settings/billing')"
            class="group flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white no-underline shadow-sm shadow-brand-500/25 transition-all hover:shadow-md hover:shadow-brand-500/35 hover:-translate-y-px active:translate-y-0"
            @click="open = false"
          >
            <span>Upgrade to {{ recommended.name }} — ${{ recommended.monthlyPrice }}/mo</span>
            <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
          </NuxtLink>
          <p class="mt-2 text-center text-xs text-surface-400 dark:text-surface-500">
            More roles · unlimited AI shortlists · unlimited conversations
          </p>
        </div>
      </div>
    </Transition>
  </div>
</template>
