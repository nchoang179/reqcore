<script setup lang="ts">
import { CreditCard, Check, Loader2, ExternalLink, Sparkles, ShieldCheck, TrendingUp } from 'lucide-vue-next'
import type { BillingCadence } from '~/composables/useBillingCheckout'
import { BILLING_PLANS, getBillingPlan, tierDisplayName, type BillingPlanId, type BillingTier } from '~~/shared/billing'

useSeoMeta({
  title: 'Billing & Plans — Reqcore',
  description: 'Manage your organization subscription and billing.',
})

// Only owners/admins can change the plan (server enforces this too via
// authorizeReference). Members see a read-only view.
const { allowed: canManage, isLoading: isPermissionLoading } = usePermission({ organization: ['update'] })
const { activeOrg } = useCurrentOrg()
const orgId = computed(() => activeOrg.value?.id ?? null)
const { startBillingCheckout } = useBillingCheckout()
const { openUpsell } = usePreviewReadOnly()

// The read-only demo can't buy or manage a real subscription — the server
// hard-blocks it (authorizeReference). Surface the sign-up upsell instead of a
// checkout that would only fail. We detect the demo by org slug AND by the
// public demo account email, since the slug isn't configured in every env.
const { data: session } = await authClient.useSession(useFetch)
const config = useRuntimeConfig()
const isDemo = computed(() => {
  const slug = config.public.demoOrgSlug
  const isDemoOrg = !!slug && activeOrg.value?.slug === slug
  const isDemoAccount = session.value?.user?.email === 'demo@reqcore.com'
  return isDemoOrg || isDemoAccount
})

const route = useRoute()
const checkoutResult = computed(() => route.query.checkout as string | undefined)
const pendingCheckoutIntent = computed(() => parseBillingCheckoutIntent(route.query))

// Plan icons (kept here, not in shared/, since they're presentational only).
const planIcons: Record<BillingPlanId, typeof Sparkles> = {
  solo: Sparkles,
  team: TrendingUp,
  scale: ShieldCheck,
}

const { data: status, refresh, status: fetchStatus } = await useBillingStatus()

const billingAnnual = ref(false)
const isProcessing = ref<string | null>(null) // holds the plan id (or 'portal') being processed
const errorMsg = ref('')

const current = computed(() => status.value?.subscription ?? null)
const hasActivePlan = computed(() =>
  !!current.value && ['active', 'trialing', 'past_due'].includes(current.value.status),
)
const hasStripeManagedPlan = computed(() =>
  hasActivePlan.value && !!current.value?.stripeSubscriptionId,
)
const isGrandfatheredPlan = computed(() =>
  hasActivePlan.value && current.value?.plan === 'grandfathered',
)
const checkoutSuccessConfirmed = computed(() => {
  if (checkoutResult.value !== 'success') return false
  // When billing is not enabled (self-hosted / CI), there is no real Stripe
  // subscription to confirm, so treat any success redirect as confirmed.
  if (status.value && !status.value.enabled) return true
  return !!current.value && ['active', 'trialing'].includes(current.value.status)
})
const checkoutSuccessPending = computed(() => checkoutResult.value === 'success' && !checkoutSuccessConfirmed.value)

// Usage meters + upsell card are only relevant for orgs still on the free tier.
const freeUsage = computed(() => freePlanUsage(status.value))
const currentPlanName = computed(() => {
  if (!hasActivePlan.value || !current.value) return 'Free'
  return getBillingPlan(current.value.plan)?.name ?? tierDisplayName(current.value.plan as BillingTier)
})

const statusBadge = computed(() => {
  const s = current.value?.status
  switch (s) {
    case 'active': return { label: 'Active', class: 'bg-success-50 dark:bg-success-950/40 text-success-700 dark:text-success-400 border-success-200 dark:border-success-800' }
    case 'trialing': return { label: 'Trial', class: 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-800' }
    case 'past_due': return { label: 'Past due', class: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' }
    case 'canceled': return { label: 'Canceled', class: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-surface-700' }
    default: return null
  }
})

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function priceLabel(planId: BillingPlanId): { amount: string; cadence: string } {
  const plan = getBillingPlan(planId)!
  if (billingAnnual.value && plan.annualPrice != null) {
    return { amount: `$${Math.round(plan.annualPrice / 12).toLocaleString('en-US')}`, cadence: '/month, billed yearly' }
  }
  return { amount: `$${plan.monthlyPrice}`, cadence: '/month' }
}

function isCurrent(planId: BillingPlanId): boolean {
  return hasActivePlan.value && current.value?.plan === planId
}

async function choosePlan(planId: BillingPlanId, cadence: BillingCadence = billingAnnual.value ? 'annual' : 'monthly') {
  if (isDemo.value) {
    openUpsell()
    return
  }
  if (!canManage.value || !orgId.value) return
  errorMsg.value = ''
  billingAnnual.value = cadence === 'annual'
  isProcessing.value = planId
  try {
    const subscriptionId = hasStripeManagedPlan.value
      ? current.value?.stripeSubscriptionId ?? undefined
      : undefined
    if (hasStripeManagedPlan.value && !subscriptionId) {
      errorMsg.value = 'Could not switch plans because the current Stripe subscription was not found. Please open the billing portal or contact support.'
      return
    }
    const res = await startBillingCheckout({
      planId,
      cadence,
      orgId: orgId.value,
      subscriptionId,
    })
    if (!res.ok) {
      errorMsg.value = res.error || 'Could not start checkout. Please try again.'
    }
  }
  catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not start checkout. Please try again.'
  }
  finally {
    isProcessing.value = null
  }
}

const autoCheckoutStarted = ref(false)

watch(
  [pendingCheckoutIntent, orgId, () => status.value, fetchStatus, canManage, isPermissionLoading],
  async ([intent, activeOrgId, billingStatus, loadState, allowed, permissionLoading]) => {
    if (
      autoCheckoutStarted.value
      || checkoutResult.value
      || !intent
      || !activeOrgId
      || !billingStatus
      || loadState === 'pending'
      || permissionLoading
    ) {
      return
    }

    billingAnnual.value = intent.cadence === 'annual'

    if (!billingStatus.enabled) return

    if (!allowed) {
      errorMsg.value = 'Only organization owners and admins can change the plan.'
      return
    }

    if (isCurrent(intent.planId)) return

    autoCheckoutStarted.value = true
    await choosePlan(intent.planId, intent.cadence)
  },
  { immediate: true },
)

async function manageBilling() {
  if (isDemo.value) {
    openUpsell()
    return
  }
  if (!canManage.value || !orgId.value) return
  errorMsg.value = ''
  isProcessing.value = 'portal'
  try {
    const res = await authClient.subscription.billingPortal({
      referenceId: orgId.value,
      customerType: 'organization',
      returnUrl: '/dashboard/settings/billing',
    })
    if (res?.error) {
      errorMsg.value = res.error.message || 'Could not open the billing portal.'
      return
    }
    if (res?.data && 'url' in res.data && res.data.url) {
      window.location.href = res.data.url as string
    }
  }
  catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not open the billing portal.'
  }
  finally {
    isProcessing.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <div class="mb-2">
      <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Billing &amp; Plans</h1>
      <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
        Manage your organization's subscription. Pricing is flat and org-wide — never per seat.
      </p>
    </div>

    <!-- Checkout result banners -->
    <div v-if="checkoutSuccessConfirmed" class="rounded-lg border border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-950 px-4 py-3 text-sm text-success-700 dark:text-success-400">
      Payment received — your plan is now active. It may take a few seconds to appear below.
    </div>
    <div v-else-if="checkoutSuccessPending" class="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
      Checkout completed — waiting for Stripe confirmation. Your plan will update as soon as the payment is confirmed.
    </div>
    <div v-else-if="checkoutResult === 'cancelled'" class="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60 px-4 py-3 text-sm text-surface-600 dark:text-surface-300">
      Checkout was cancelled. You haven't been charged.
    </div>

    <div v-if="errorMsg" class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 px-4 py-3 text-sm text-danger-700 dark:text-danger-400">
      {{ errorMsg }}
    </div>

    <!-- Billing not configured on this instance (self-hosted without Stripe keys) -->
    <section
      v-if="status && !status.enabled"
      class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-4 sm:px-6 py-8 text-center"
    >
      <div class="mx-auto flex items-center justify-center size-10 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-400">
        <CreditCard class="size-5" />
      </div>
      <h2 class="mt-4 text-base font-semibold text-surface-900 dark:text-surface-100">Billing isn't enabled on this instance</h2>
      <p class="mx-auto mt-1 max-w-md text-sm text-surface-500 dark:text-surface-400">
        This instance has no payment provider configured. In production, paid features stay limited to the workspace's stored plan tier.
        To enable paid cloud plans, an operator must set the Stripe environment variables.
      </p>
    </section>

    <template v-else>
      <!-- Current plan -->
      <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
        <div class="px-4 sm:px-6 py-5 flex items-start justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <div class="flex items-center justify-center size-10 shrink-0 rounded-lg bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">
              <CreditCard class="size-5" />
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Current plan: {{ currentPlanName }}</h2>
                <span v-if="statusBadge" class="shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium" :class="statusBadge.class">
                  {{ statusBadge.label }}
                </span>
              </div>
              <p v-if="fetchStatus === 'pending'" class="text-sm text-surface-400 mt-0.5 flex items-center gap-1.5">
                <Loader2 class="size-3.5 animate-spin" /> Loading…
              </p>
              <p v-else-if="hasActivePlan && current?.cancelAtPeriodEnd" class="text-sm text-amber-600 dark:text-amber-400 mt-0.5">
                Cancels on {{ formatDate(current.periodEnd) }} — access continues until then.
              </p>
              <p v-else-if="hasActivePlan && current?.periodEnd" class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
                Renews on {{ formatDate(current.periodEnd) }}.
              </p>
              <p v-else-if="isGrandfatheredPlan" class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
                Your workspace keeps Team access for free with BYOK. AI runs use your configured provider key, not Reqcore's platform key.
              </p>
              <p v-else class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
                You're on the free plan. Upgrade any time below.
              </p>
            </div>
          </div>

          <button
            v-if="hasStripeManagedPlan && canManage"
            :disabled="isProcessing === 'portal'"
            class="shrink-0 inline-flex items-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm font-medium text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-700 disabled:opacity-50 transition-colors"
            @click="manageBilling"
          >
            <Loader2 v-if="isProcessing === 'portal'" class="size-4 animate-spin" />
            <ExternalLink v-else class="size-4" />
            Manage billing
          </button>
        </div>
      </section>

      <!-- Free-plan usage + upsell -->
      <FreePlanUpsellCard
        v-if="freeUsage"
        :active-roles="freeUsage.activeRoles"
        :ai-analysis="freeUsage.aiAnalysis"
        :ai-assistant="freeUsage.aiAssistant"
        :candidate-conversations="freeUsage.candidateConversations"
        :can-manage="canManage"
        :processing="isProcessing === 'solo'"
        @upgrade="choosePlan('solo')"
      />

      <!-- Cadence toggle -->
      <div class="flex items-center justify-center">
        <div class="inline-flex rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 p-0.5 text-sm">
          <button
            class="rounded-md px-4 py-1.5 font-medium transition-colors"
            :class="!billingAnnual ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm' : 'text-surface-500 dark:text-surface-400'"
            @click="billingAnnual = false"
          >
            Monthly
          </button>
          <button
            class="rounded-md px-4 py-1.5 font-medium transition-colors"
            :class="billingAnnual ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm' : 'text-surface-500 dark:text-surface-400'"
            @click="billingAnnual = true"
          >
            Annual <span class="text-success-600 dark:text-success-400">· save ~2 months</span>
          </button>
        </div>
      </div>

      <!-- Plan cards -->
      <div class="grid gap-4 md:grid-cols-3">
        <section
          v-for="plan in BILLING_PLANS"
          :key="plan.id"
          class="flex flex-col rounded-xl border bg-white dark:bg-surface-900 p-5"
          :class="isCurrent(plan.id) ? 'border-brand-300 dark:border-brand-700 ring-1 ring-brand-200 dark:ring-brand-800' : 'border-surface-200 dark:border-surface-800'"
        >
          <div class="flex items-center gap-2.5">
            <div class="flex items-center justify-center size-9 rounded-lg bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">
              <component :is="planIcons[plan.id]" class="size-4.5" />
            </div>
            <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ plan.name }}</h3>
            <span v-if="isCurrent(plan.id)" class="ml-auto inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-950/40 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800">
              Current
            </span>
          </div>

          <div class="mt-4 flex items-end gap-1">
            <span class="text-3xl font-bold tracking-tight text-surface-900 dark:text-surface-50">{{ priceLabel(plan.id).amount }}</span>
            <span class="pb-1 text-sm text-surface-400">{{ priceLabel(plan.id).cadence }}</span>
          </div>
          <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ plan.tagline }}</p>

          <ul class="mt-4 space-y-2 flex-1">
            <li v-for="f in plan.features" :key="f" class="flex gap-2 text-sm text-surface-600 dark:text-surface-300">
              <Check class="mt-0.5 size-4 shrink-0 text-brand-500" />
              <span>{{ f }}</span>
            </li>
          </ul>

          <button
            :disabled="!canManage || isCurrent(plan.id) || isProcessing === plan.id"
            class="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="choosePlan(plan.id)"
          >
            <Loader2 v-if="isProcessing === plan.id" class="size-4 animate-spin" />
            <span v-if="isCurrent(plan.id)">Current plan</span>
            <span v-else-if="hasActivePlan">Switch to {{ plan.name }}</span>
            <span v-else>Upgrade to {{ plan.name }}</span>
          </button>
        </section>
      </div>

      <p v-if="!canManage" class="text-center text-xs text-surface-400">
        Only organization owners and admins can change the plan.
      </p>
      <p class="text-center text-xs text-surface-400">
        Secure checkout and card management are handled by Stripe. Cancel any time from “Manage billing”.
      </p>
    </template>
  </div>
</template>
