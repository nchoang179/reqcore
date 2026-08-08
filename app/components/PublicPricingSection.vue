<script setup lang="ts">
import {
  ArrowRight,
  Check,
  Cloud,
  LifeBuoy,
} from 'lucide-vue-next'
import {
  BILLING_PLANS,
  FREE_PLAN_CHATBOT_PROMPT_LIMIT,
  type BillingPlan,
  type BillingPlanId,
} from '~~/shared/billing'

type PlanCard = {
  id: string
  name: string
  tagline: string
  price: string
  cadence: string
  featuresHeading: string
  features: string[]
  icon?: typeof Cloud
  imageSrc?: string
  imageAlt?: string
  ctaLabel: string
  ctaTo?: string
  ctaHref?: string
  featured?: boolean
}

const props = defineProps<{
  headingTag?: 'h1' | 'h2'
  signedIn?: boolean
}>()

const localePath = useLocalePath()
const { track } = useTrack()
const annual = ref(false)

/**
 * Sign-up link for a plan card. Threads the chosen plan (and cadence for paid
 * plans) so the same value flows pricing → sign-up → create-org → the
 * onboarding survey, where it is stored on the user's PostHog account. Already
 * signed-in visitors are routed straight to checkout by the guest middleware,
 * which reads this same `?plan=` intent.
 */
function signUpTo(planId: string) {
  const query: Record<string, string> = { plan: planId }
  if (planId !== 'free') query.billing = annual.value ? 'annual' : 'monthly'
  return localePath({ path: '/auth/sign-up', query })
}

/** Records which plan button was clicked, tagged with the billing cadence. */
function trackPlanClick(planId: string) {
  track('pricing_plan_selected', {
    plan: planId,
    billing: annual.value ? 'annual' : 'monthly',
  })
}

const paidPlanImages: Record<BillingPlanId, { src: string; alt: string }> = {
  solo: {
    src: '/pricing-plan-solo.png',
    alt: 'Single person icon with one star',
  },
  team: {
    src: '/pricing-plan-team.png',
    alt: 'Team icon with two stars',
  },
  scale: {
    src: '/pricing-plan-scale.png',
    alt: 'Larger team icon with three stars',
  },
}

// Concrete, real feature lists shown on each plan card. Paid plans inherit the
// tier below them (Breezy-style "Everything in X, plus:"), so each list below
// holds only what that tier adds.
const paidPlanFeatures: Record<BillingPlanId, { heading: string; features: string[] }> = {
  solo: {
    heading: 'Everything in Free, plus:',
    features: [
      'Up to 2 active roles',
      'Unlimited AI shortlists on every role',
      'AI assistant — chat with your pipeline',
      'Unlimited hires per role',
      'Full shortlist workflow',
      'Custom scoring criteria',
      'Saved views and filters',
      'Source analytics dashboard',
      'Unlimited candidate messaging',
      'Share and export shortlists',
      'Email support',
    ],
  },
  team: {
    heading: 'Everything in Solo, plus:',
    features: [
      'Up to 8 active roles',
      'Deeper analysis on every shortlisted application',
      'Your own domain, no Reqcore branding',
      'Email and calendar integrations',
      'Recruiting pipelines',
      'Interview scheduling and templates',
      'Priority support',
    ],
  },
  scale: {
    heading: 'Everything in Team, plus:',
    features: [
      'Up to 24 active roles',
      'SSO, SAML and SCIM',
      'Audit log and retention controls',
      'DPA and SLA',
      'Dedicated onboarding',
    ],
  },
}

const primaryCta = computed(() => props.signedIn
  ? { to: localePath('/dashboard'), label: 'Go to dashboard' }
  : { to: localePath('/auth/sign-up'), label: 'Start free' })
const headingTag = computed(() => props.headingTag ?? 'h1')

function paidPlanPrice(plan: BillingPlan): { price: string; cadence: string } {
  if (annual.value && plan.annualPrice != null) {
    return { price: `$${Math.round(plan.annualPrice / 12).toLocaleString('en-US')}`, cadence: '/month, billed yearly' }
  }

  return { price: `$${plan.monthlyPrice}`, cadence: '/month' }
}

const plans = computed<PlanCard[]>(() => [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Rank your whole pile on one real role.',
    price: '$0',
    cadence: '',
    icon: Cloud,
    ctaLabel: 'Start free',
    ctaTo: signUpTo('free'),
    featuresHeading: 'Includes:',
    features: [
      '1 active role',
      'Unlimited applicants',
      'Unlimited team members',
      'AI shortlist ranking',
      'Your first AI shortlist free, no card',
      `${FREE_PLAN_CHATBOT_PROMPT_LIMIT} AI assistant prompts to try on your own pipeline`,
      'Branded application forms',
      'Resume parsing and candidate profiles',
      '5 candidate conversations, unlimited replies',
      'Source tracking',
      'Multi-language support',
    ],
  },
  ...BILLING_PLANS.map((plan) => {
    const price = paidPlanPrice(plan)
    const image = paidPlanImages[plan.id]

    return {
      id: plan.id,
      name: plan.name,
      tagline: plan.tagline,
      price: price.price,
      cadence: price.cadence,
      imageSrc: image.src,
      imageAlt: image.alt,
      ctaLabel: `Choose ${plan.name}`,
      ctaTo: signUpTo(plan.id),
      featured: plan.id === 'team',
      featuresHeading: paidPlanFeatures[plan.id].heading,
      features: paidPlanFeatures[plan.id].features,
    }
  }),
  {
    id: 'agency',
    name: 'Agency',
    tagline: 'For staffing-scale volume.',
    price: 'Custom',
    cadence: '',
    icon: LifeBuoy,
    ctaLabel: 'Contact us',
    ctaHref: 'mailto:sales@reqcore.com',
    featuresHeading: 'Everything in Scale, plus:',
    features: [
      'Unlimited active roles',
      'Custom contract and invoicing',
      'Security and legal review',
      'Dedicated support channel',
    ],
  },
])
</script>

<template>
  <section class="mx-auto max-w-6xl px-4 pb-20 pt-24 sm:px-6 sm:pt-28">
    <div class="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.55fr)] lg:items-end">
      <div>
        <div class="inline-flex items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 px-3 py-1.5 text-xs font-medium text-surface-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-surface-300">
          <img
            src="/reqcore-emoji-128-transparent.png"
            alt=""
            width="18"
            height="18"
            class="size-4.5 object-contain"
          />
          Free until your first AI shortlist
        </div>
        <component
          :is="headingTag"
          class="mt-6 max-w-3xl text-4xl font-bold leading-tight text-surface-950 dark:text-white sm:text-5xl lg:text-6xl"
        >
          Unlimited applicants. One price per role.
        </component>
        <p class="mt-5 max-w-2xl text-base leading-7 text-surface-600 dark:text-surface-300 sm:text-lg">
          Reqcore ranks every applicant — 500 or 50,000 — and hands you a shortlist you can trust. Priced by the roles you keep open, never by your volume. Start free on one role, no card.
        </p>
        <div class="mt-8 flex flex-wrap items-center gap-3">
          <NuxtLink
            :to="primaryCta.to"
            class="inline-flex items-center gap-2 rounded-lg bg-surface-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-surface-800 dark:bg-white dark:text-[#09090b] dark:hover:bg-white/90"
          >
            {{ primaryCta.label }}
            <ArrowRight class="size-4" />
          </NuxtLink>
          <NuxtLink
            :to="localePath('/auth/sign-in?live=1')"
            class="inline-flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-5 py-3 text-sm font-semibold text-surface-700 transition hover:bg-surface-50 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-surface-200 dark:hover:bg-white/[0.06]"
          >
            View demo
          </NuxtLink>
        </div>
      </div>

      <div class="rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
        <p class="text-sm font-semibold text-surface-900 dark:text-white">Billing period</p>
        <div class="mt-3 grid grid-cols-2 rounded-lg border border-surface-200 bg-white p-1 text-sm dark:border-white/[0.08] dark:bg-[#09090b]">
          <button
            class="rounded-md px-3 py-2 font-medium transition"
            :class="!annual ? 'bg-surface-950 text-white dark:bg-white dark:text-[#09090b]' : 'text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white'"
            @click="annual = false"
          >
            Monthly
          </button>
          <button
            class="rounded-md px-3 py-2 font-medium transition"
            :class="annual ? 'bg-surface-950 text-white dark:bg-white dark:text-[#09090b]' : 'text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white'"
            @click="annual = true"
          >
            Annual
          </button>
        </div>
        <p class="mt-3 text-sm leading-6 text-surface-500 dark:text-surface-400">
          Annual plans show the monthly equivalent. Stripe remains the source of truth at checkout.
        </p>
      </div>
    </div>

    <div class="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="plan in plans"
        :key="plan.id"
        class="flex min-h-[430px] flex-col rounded-lg border bg-white p-5 dark:bg-surface-950"
        :class="plan.featured ? 'border-brand-300 ring-1 ring-brand-200 dark:border-brand-700 dark:ring-brand-800' : 'border-surface-200 dark:border-white/[0.08]'"
      >
        <div class="flex items-start gap-3">
          <img
            v-if="plan.imageSrc"
            :src="plan.imageSrc"
            :alt="plan.imageAlt"
            width="86"
            height="86"
            class="-ml-1 -mt-1 size-20 shrink-0 rounded-lg object-cover"
          />
          <div
            v-else
            class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-surface-700 dark:bg-white/[0.06] dark:text-surface-200"
          >
            <component :is="plan.icon" class="size-4.5" />
          </div>
          <div class="min-w-0 pt-1">
            <h2 class="truncate text-sm font-semibold text-surface-950 dark:text-white">{{ plan.name }}</h2>
            <p v-if="plan.featured" class="text-xs font-medium text-brand-600 dark:text-brand-300">Popular</p>
          </div>
        </div>

        <div class="mt-5 flex min-h-12 items-end gap-1">
          <span class="text-3xl font-bold text-surface-950 dark:text-white">{{ plan.price }}</span>
          <span v-if="plan.cadence" class="pb-1 text-sm text-surface-400">{{ plan.cadence }}</span>
        </div>
        <p class="mt-3 min-h-12 text-sm leading-6 text-surface-500 dark:text-surface-400">{{ plan.tagline }}</p>

        <p class="mt-5 text-xs font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500">{{ plan.featuresHeading }}</p>
        <ul class="mt-3 flex-1 space-y-3">
          <li
            v-for="feature in plan.features"
            :key="feature"
            class="flex gap-2 text-sm leading-5 text-surface-600 dark:text-surface-300"
          >
            <Check class="mt-0.5 size-4 shrink-0 text-brand-500" />
            <span>{{ feature }}</span>
          </li>
        </ul>

        <NuxtLink
          v-if="plan.ctaTo"
          :to="plan.ctaTo"
          class="mt-6 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition"
          :class="plan.featured ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-surface-200 bg-white text-surface-800 hover:bg-surface-50 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-surface-100 dark:hover:bg-white/[0.06]'"
          @click="trackPlanClick(plan.id)"
        >
          {{ plan.ctaLabel }}
          <ArrowRight class="size-4" />
        </NuxtLink>
        <a
          v-else
          :href="plan.ctaHref"
          class="mt-6 inline-flex items-center justify-center gap-2 rounded-lg border border-surface-200 bg-white px-4 py-2.5 text-sm font-semibold text-surface-800 transition hover:bg-surface-50 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-surface-100 dark:hover:bg-white/[0.06]"
          @click="trackPlanClick(plan.id)"
        >
          {{ plan.ctaLabel }}
          <ArrowRight class="size-4" />
        </a>
      </article>
    </div>

    <div class="mt-14 border-t border-surface-200 pt-8 dark:border-white/[0.08]">
      <div class="grid gap-6 text-sm leading-6 text-surface-600 dark:text-surface-300 md:grid-cols-3">
        <p>
          <strong class="text-surface-950 dark:text-white">No per-seat pricing.</strong>
          Invite the whole hiring team without turning collaboration into a billable event.
        </p>
        <p>
          <strong class="text-surface-950 dark:text-white">Unlimited applicants, always.</strong>
          500 or 50,000, the price is the same — we never charge more when you get more applicants.
        </p>
        <p>
          <strong class="text-surface-950 dark:text-white">Priced by active roles.</strong>
          Pay for how many roles you keep open at once — plus custom branding, integrations, and compliance as you grow.
        </p>
      </div>
    </div>
  </section>
</template>
