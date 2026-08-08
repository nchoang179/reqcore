<script setup lang="ts">
/**
 * A single labelled usage meter: "used / limit" with a progress bar that shifts
 * brand → amber (≥80%) → red (at limit). Shared by the billing page upsell card
 * and the top-bar upgrade popover so both read identically. The default slot
 * receives the computed tone for any at-limit hint copy.
 */
import type { Component } from 'vue'

const props = defineProps<{
  label: string
  icon: Component
  used: number
  /** null/∞ means uncapped on this tier. */
  limit: number | null
  /**
   * Replaces the "used / limit" readout. The assistant meter is a percentage
   * rather than a count — showing "40 / 100" there would read as a message
   * tally, which it isn't.
   */
  valueLabel?: string
}>()

type Tone = 'ok' | 'near' | 'full'

const view = computed<{ limitLabel: string, pct: number, tone: Tone }>(() => {
  const limit = props.limit
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return { limitLabel: '∞', pct: 0, tone: 'ok' }
  }
  const pct = Math.min(100, Math.round((props.used / limit) * 100))
  const tone: Tone = props.used >= limit ? 'full' : pct >= 80 ? 'near' : 'ok'
  return { limitLabel: String(limit), pct, tone }
})

const barClass: Record<Tone, string> = {
  ok: 'bg-brand-500',
  near: 'bg-amber-500',
  full: 'bg-danger-500',
}

const valueClass: Record<Tone, string> = {
  ok: 'text-surface-900 dark:text-surface-100',
  near: 'text-amber-600 dark:text-amber-400',
  full: 'text-danger-600 dark:text-danger-400',
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between gap-3">
      <span class="flex items-center gap-1.5 text-sm font-medium text-surface-700 dark:text-surface-300">
        <component :is="icon" class="size-4 text-surface-400" />
        {{ label }}
      </span>
      <span class="text-sm font-semibold tabular-nums" :class="valueClass[view.tone]">
        {{ valueLabel ?? `${used} / ${view.limitLabel}` }}
      </span>
    </div>
    <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-surface-800">
      <div class="h-full rounded-full transition-all" :class="barClass[view.tone]" :style="{ width: `${view.pct}%` }" />
    </div>
    <slot :tone="view.tone" />
  </div>
</template>
