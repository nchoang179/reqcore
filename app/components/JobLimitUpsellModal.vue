<script setup lang="ts">
/**
 * Upsell modal shown when a free-plan org tries to open a second role and hits
 * the active-role cap (free allows one open job at a time). Rather than a
 * dead-end error, we pitch the entry paid plans and start Stripe checkout
 * inline — owners/admins upgrade from here, other members get pointed at the
 * billing page. "Save as draft" lets the user keep their wizard work without
 * opening the role.
 *
 * The modal owns its own checkout flow (useBillingCheckout + active org); the
 * parent only tells it the current cap and whether the user can manage billing,
 * and listens for `close` / `save-draft`.
 */
import { X, Sparkles, TrendingUp, Briefcase, Check, ArrowRight, Loader2, FileEdit, Lock } from 'lucide-vue-next'
import { BILLING_PLANS, type BillingPlan, type BillingPlanId } from '~~/shared/billing'

const props = defineProps<{
  /** Open-role cap on the org's current (free) plan — usually 1. */
  limit: number
  /** Whether the current user can change billing (owner/admin). */
  canManage?: boolean
  /** Set while the wizard is saving the role as a draft. */
  savingDraft?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save-draft'): void
}>()

const { activeOrg } = useCurrentOrg()
const { startBillingCheckout } = useBillingCheckout()

const billingAnnual = ref(false)

// Plans we steer a capped free org toward. Agency isn't self-serve and Scale is
// overkill for someone opening their second role, so we pitch Solo (the entry
// upgrade, recommended) and Team.
const offered = computed<BillingPlan[]>(() =>
  BILLING_PLANS.filter(p => p.id === 'solo' || p.id === 'team'),
)

const planIcons: Record<BillingPlanId, typeof Sparkles> = {
  solo: Sparkles,
  team: TrendingUp,
  scale: Briefcase,
}

const processing = ref<BillingPlanId | null>(null)
const errorMsg = ref('')

function priceFor(plan: BillingPlan): { amount: number, cadence: string } {
  if (billingAnnual.value && plan.annualPrice != null) {
    return { amount: Math.round(plan.annualPrice / 12), cadence: '/mo, billed yearly' }
  }
  return { amount: plan.monthlyPrice, cadence: '/mo' }
}

async function upgrade(planId: BillingPlanId) {
  const orgId = activeOrg.value?.id
  if (!orgId || !props.canManage || processing.value) return
  errorMsg.value = ''
  processing.value = planId
  try {
    const res = await startBillingCheckout({
      planId,
      cadence: billingAnnual.value ? 'annual' : 'monthly',
      orgId,
      // Land back on the wizard after checkout — the draft is auto-saved to
      // localStorage and restored on mount, so their work survives the trip.
      successUrl: '/dashboard/jobs/new?checkout=success',
      cancelUrl: '/dashboard/jobs/new?checkout=cancelled',
    })
    if (!res.ok) errorMsg.value = res.error || 'Could not start checkout. Please try again.'
  }
  catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not start checkout. Please try again.'
  }
  finally {
    // On success we've already redirected to Stripe; this only matters on error.
    processing.value = null
  }
}

function closeModal() {
  if (processing.value) return
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="closeModal" />

      <div class="relative w-full max-w-lg overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-2xl dark:border-surface-800 dark:bg-surface-900">
        <!-- Accent line -->
        <div class="h-[3px] bg-gradient-to-r from-brand-400 via-violet-400 to-brand-500" />

        <!-- Header -->
        <div class="relative px-6 pt-6 pb-5">
          <button
            class="absolute right-4 top-4 cursor-pointer rounded-md p-1 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-surface-800 dark:hover:text-surface-200"
            :disabled="!!processing"
            @click="closeModal"
          >
            <X class="size-5" />
          </button>

          <div class="flex items-start gap-3.5">
            <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-sm shadow-brand-500/25">
              <Lock class="size-5" />
            </div>
            <div class="min-w-0">
              <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-50">
                You've reached your free plan limit
              </h3>
              <p class="mt-1 text-sm leading-relaxed text-surface-500 dark:text-surface-400">
                The Free plan keeps {{ limit === 1 ? 'one role' : `${limit} roles` }} open at a time. Upgrade to open this role
                and run unlimited deep AI shortlists on every applicant.
              </p>
            </div>
          </div>
        </div>

        <!-- Billing cadence toggle -->
        <div v-if="canManage" class="flex items-center justify-center gap-2 px-6">
          <button
            type="button"
            class="rounded-md px-3 py-1 text-xs font-semibold transition-colors"
            :class="!billingAnnual
              ? 'bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900'
              : 'text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200'"
            @click="billingAnnual = false"
          >
            Monthly
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors"
            :class="billingAnnual
              ? 'bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900'
              : 'text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200'"
            @click="billingAnnual = true"
          >
            Yearly
            <span class="rounded-full bg-success-100 px-1.5 py-0.5 text-[10px] font-bold text-success-700 dark:bg-success-950/60 dark:text-success-400">2 months free</span>
          </button>
        </div>

        <!-- Plan cards -->
        <div class="grid gap-3 px-6 py-5 sm:grid-cols-2">
          <div
            v-for="(plan, idx) in offered"
            :key="plan.id"
            class="relative flex flex-col rounded-xl border p-4 transition-colors"
            :class="idx === 0
              ? 'border-brand-300 bg-brand-50/50 dark:border-brand-800 dark:bg-brand-950/20'
              : 'border-surface-200 dark:border-surface-800'"
          >
            <span
              v-if="idx === 0"
              class="absolute -top-2.5 left-4 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
            >
              Recommended
            </span>

            <div class="flex items-center gap-2">
              <component :is="planIcons[plan.id]" class="size-4 text-brand-600 dark:text-brand-400" />
              <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ plan.name }}</span>
            </div>

            <div class="mt-2 flex items-baseline gap-1">
              <span class="text-2xl font-bold text-surface-900 dark:text-surface-50">${{ priceFor(plan).amount }}</span>
              <span class="text-xs text-surface-500 dark:text-surface-400">{{ priceFor(plan).cadence }}</span>
            </div>

            <p class="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-surface-700 dark:text-surface-300">
              <Briefcase class="size-3.5 text-brand-500" />
              Up to {{ plan.activeRoleLimit }} active roles
            </p>

            <ul class="mt-3 space-y-1.5">
              <li
                v-for="feature in plan.features.slice(0, 3)"
                :key="feature"
                class="flex items-start gap-1.5 text-xs leading-snug text-surface-600 dark:text-surface-300"
              >
                <Check class="mt-0.5 size-3.5 shrink-0 text-success-500" />
                <span>{{ feature }}</span>
              </li>
            </ul>

            <button
              v-if="canManage"
              type="button"
              :disabled="!!processing"
              class="group mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              :class="idx === 0
                ? 'bg-brand-600 text-white hover:bg-brand-700'
                : 'border border-surface-300 text-surface-800 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-200 dark:hover:bg-surface-800'"
              @click="upgrade(plan.id)"
            >
              <Loader2 v-if="processing === plan.id" class="size-4 animate-spin" />
              <template v-else>
                Choose {{ plan.name }}
                <ArrowRight class="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </template>
            </button>
          </div>
        </div>

        <p v-if="errorMsg" class="px-6 pb-2 text-xs text-danger-600 dark:text-danger-400">
          {{ errorMsg }}
        </p>

        <!-- Footer -->
        <div class="flex flex-col gap-3 border-t border-surface-100 bg-surface-50/60 px-6 py-4 dark:border-surface-800 dark:bg-surface-950/40 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            :disabled="savingDraft || !!processing"
            class="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-surface-600 transition-colors hover:text-surface-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-surface-400 dark:hover:text-surface-100"
            @click="emit('save-draft')"
          >
            <Loader2 v-if="savingDraft" class="size-4 animate-spin" />
            <FileEdit v-else class="size-4" />
            Save as draft instead
          </button>

          <NuxtLink
            v-if="!canManage"
            :to="$localePath('/dashboard/settings/billing')"
            class="text-xs text-surface-500 transition-colors hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200"
            @click="closeModal"
          >
            Only owners and admins can upgrade — view billing
          </NuxtLink>
          <NuxtLink
            v-else
            :to="$localePath('/dashboard/settings/billing')"
            class="inline-flex items-center gap-1 text-xs text-surface-400 transition-colors hover:text-surface-700 dark:text-surface-500 dark:hover:text-surface-300"
            @click="closeModal"
          >
            Compare all plans
            <ArrowRight class="size-3" />
          </NuxtLink>
        </div>
      </div>
    </div>
  </Teleport>
</template>
