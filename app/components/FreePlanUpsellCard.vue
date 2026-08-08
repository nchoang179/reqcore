<script setup lang="ts">
/**
 * Free-plan usage + upsell card shown on the billing page when an org is on the
 * free tier. Surfaces the count-based caps (active roles, AI shortlists,
 * assistant messages, candidate conversations) as meters that warn as they
 * fill, with a one-click upgrade to the entry plan.
 *
 * Purely presentational — usage comes from /api/billing/status; the upgrade
 * itself is handled by the parent so checkout state stays in one place.
 */
import { ArrowRight, Briefcase, MessageCircle, MessageSquare, Sparkles, Zap } from 'lucide-vue-next'
import { getBillingPlan } from '~~/shared/billing'
import type { UsageMeter } from '~/composables/useBillingStatus'

defineProps<{
  activeRoles: UsageMeter
  aiAnalysis: UsageMeter
  aiAssistant: UsageMeter
  candidateConversations: UsageMeter
  /** Disables the upgrade button for members who can't change billing. */
  canManage?: boolean
  /** Set while a checkout request is in flight. */
  processing?: boolean
}>()

const emit = defineEmits<{
  (e: 'upgrade'): void
}>()

// The entry plan we steer free orgs toward.
const recommended = getBillingPlan('solo')!
</script>

<template>
  <section class="relative overflow-hidden rounded-xl border border-brand-200 dark:border-brand-900/60 bg-white dark:bg-surface-900">
    <!-- Accent line -->
    <div class="h-[2px] bg-gradient-to-r from-brand-400 via-violet-400 to-brand-500" />
    <!-- Ambient glow -->
    <div class="pointer-events-none absolute -top-24 -right-16 size-48 rounded-full bg-brand-500/10 blur-3xl dark:bg-brand-500/[0.07]" />

    <div class="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.1fr_1fr] lg:gap-8">
      <!-- Left: pitch -->
      <div class="flex flex-col">
        <div class="flex items-center gap-2.5">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-sm shadow-brand-500/25">
            <Sparkles class="size-4.5" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
              You're on the Free plan
            </h2>
            <p class="text-xs text-surface-500 dark:text-surface-400">
              Here's what your workspace can use right now.
            </p>
          </div>
        </div>

        <p class="mt-4 text-sm leading-relaxed text-surface-600 dark:text-surface-300">
          Upgrade to <span class="font-semibold text-surface-900 dark:text-surface-100">{{ recommended.name }}</span> to open more roles at once and run
          unlimited deep AI shortlists on every applicant — no more per-account cap.
        </p>

        <div class="mt-auto pt-5">
          <button
            type="button"
            :disabled="!canManage || processing"
            class="group inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            @click="emit('upgrade')"
          >
            <span>Upgrade to {{ recommended.name }} — ${{ recommended.monthlyPrice }}/mo</span>
            <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <p v-if="!canManage" class="mt-2 text-xs text-surface-400">
            Only owners and admins can change the plan.
          </p>
        </div>
      </div>

      <!-- Right: usage meters -->
      <div class="space-y-4 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50/60 dark:bg-surface-950/40 p-4">
        <UsageMeterBar label="Active roles" :icon="Briefcase" :used="activeRoles.used" :limit="activeRoles.limit">
          <template #default="{ tone }">
            <p v-if="tone === 'full'" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400">
              You've reached your open-role limit. Close a role or upgrade to open more.
            </p>
          </template>
        </UsageMeterBar>

        <UsageMeterBar label="AI shortlist runs" :icon="Zap" :used="aiAnalysis.used" :limit="aiAnalysis.limit">
          <template #default="{ tone }">
            <p v-if="tone === 'full'" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400">
              You've used your free AI shortlists. Upgrade to keep running analysis — existing rankings stay.
            </p>
            <p v-else class="mt-1.5 text-xs text-surface-400 dark:text-surface-500">
              Free orgs get {{ aiAnalysis.limit }} platform-paid AI runs. Paid plans are unlimited.
            </p>
          </template>
        </UsageMeterBar>

        <UsageMeterBar
          label="Assistant credits"
          :icon="MessageCircle"
          :used="aiAssistant.used"
          :limit="aiAssistant.limit"
          :value-label="`${aiAssistant.used}% used`"
        >
          <template #default="{ tone }">
            <p v-if="tone === 'full'" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400">
              You've used your free assistant credits. Upgrade to keep chatting — your conversations stay readable.
            </p>
            <p v-else class="mt-1.5 text-xs text-surface-400 dark:text-surface-500">
              Free orgs get a one-off grant of assistant credits. Paid plans renew monthly, or run on your own key.
            </p>
          </template>
        </UsageMeterBar>

        <UsageMeterBar label="Candidate conversations" :icon="MessageSquare" :used="candidateConversations.used" :limit="candidateConversations.limit">
          <template #default="{ tone }">
            <p v-if="tone === 'full'" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400">
              You've started all your free conversations. Existing threads keep unlimited replies — upgrade to reach more candidates.
            </p>
            <p v-else class="mt-1.5 text-xs text-surface-400 dark:text-surface-500">
              Free orgs can start {{ candidateConversations.limit }} candidate conversations. Paid plans are unlimited.
            </p>
          </template>
        </UsageMeterBar>
      </div>
    </div>
  </section>
</template>
