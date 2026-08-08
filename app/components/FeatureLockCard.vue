<script setup lang="ts">
import { Lock, ArrowRight, Sparkles, Check } from 'lucide-vue-next'
import type { PlanFeature } from '~~/shared/billing'
import { getBillingPlan } from '~~/shared/billing'

const props = withDefaults(defineProps<{
  feature: PlanFeature
  /** Override the heading; defaults to "Unlock <Feature>" */
  title?: string
  /** Override the body copy; defaults to the shared upgrade message. */
  description?: string
  /** Compact inline banner instead of the full card. */
  compact?: boolean
}>(), { compact: false })

const { featureMeta } = usePlanFeature()
const meta = computed(() => featureMeta(props.feature))
const plan = computed(() => getBillingPlan(meta.value.requiredTier as string))

const heading = computed(
  () => props.title ?? `Unlock ${meta.value.label}`,
)
const body = computed(
  () => props.description ?? `${meta.value.label} is available on the ${meta.value.requiredTierName} plan and above.`,
)

const priceLabel = computed(() => {
  if (!plan.value) return ''
  return `$${plan.value.monthlyPrice}/mo`
})

const planFeatures = computed(() => plan.value?.features.slice(0, 3) ?? [])
</script>

<template>
  <!-- Compact inline banner -->
  <div
    v-if="compact"
    class="flex items-start gap-3 rounded-lg border border-brand-200 dark:border-brand-900/60 bg-brand-50/60 dark:bg-brand-950/20 px-4 py-3"
  >
    <div class="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-violet-600 text-white">
      <Lock class="size-3.5" />
    </div>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-semibold text-surface-900 dark:text-surface-100">
        {{ heading }}
        <span v-if="priceLabel" class="ml-1.5 text-xs font-normal text-surface-500 dark:text-surface-400">
          — {{ meta.requiredTierName }} plan · {{ priceLabel }}
        </span>
      </p>
      <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">{{ body }}</p>
    </div>
    <NuxtLink
      :to="$localePath('/dashboard/settings/billing')"
      class="inline-flex shrink-0 items-center gap-1 self-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 no-underline"
    >
      Upgrade
      <ArrowRight class="size-3" />
    </NuxtLink>
  </div>

  <!-- Full card -->
  <section
    v-else
    class="relative overflow-hidden rounded-xl border border-brand-200 dark:border-brand-900/60 bg-white dark:bg-surface-900"
  >
    <div class="h-[2px] bg-gradient-to-r from-brand-400 via-violet-400 to-brand-500" />
    <div class="pointer-events-none absolute -top-24 -right-16 size-48 rounded-full bg-brand-500/10 blur-3xl dark:bg-brand-500/[0.07]" />

    <div class="relative p-6">
      <!-- Header row -->
      <div class="flex items-start gap-4">
        <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-sm shadow-brand-500/25">
          <Lock class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-base font-semibold text-surface-900 dark:text-surface-50">
              {{ heading }}
            </h3>
            <span class="inline-flex items-center rounded-full border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:text-brand-300">
              {{ meta.requiredTierName }} plan
            </span>
          </div>
          <p class="mt-1 text-sm leading-relaxed text-surface-500 dark:text-surface-400">
            {{ body }}
          </p>
        </div>
      </div>

      <!-- Plan features preview -->
      <div v-if="planFeatures.length" class="mt-5 rounded-lg border border-surface-100 dark:border-surface-800 bg-surface-50/80 dark:bg-surface-800/40 px-4 py-3">
        <p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
          What's included in {{ meta.requiredTierName }}
        </p>
        <ul class="space-y-1.5">
          <li
            v-for="f in planFeatures"
            :key="f"
            class="flex items-start gap-2 text-sm text-surface-600 dark:text-surface-300"
          >
            <Check class="mt-0.5 size-3.5 shrink-0 text-brand-500" />
            {{ f }}
          </li>
        </ul>
      </div>

      <!-- CTA row -->
      <div class="mt-5 flex flex-wrap items-center gap-3">
        <NuxtLink
          :to="$localePath('/dashboard/settings/billing')"
          class="group inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-500/20 transition-colors hover:bg-brand-700 no-underline"
        >
          <Sparkles class="size-4" />
          Upgrade to {{ meta.requiredTierName }}
          <span v-if="priceLabel" class="opacity-80">— {{ priceLabel }}</span>
          <ArrowRight class="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </NuxtLink>
        <NuxtLink
          :to="$localePath('/dashboard/settings/billing')"
          class="text-sm text-surface-400 transition-colors hover:text-surface-700 dark:text-surface-500 dark:hover:text-surface-300 no-underline"
        >
          Compare all plans
        </NuxtLink>
      </div>

      <slot />
    </div>
  </section>
</template>
