/**
 * Free-plan assistant message quota, as the chat UI sees it.
 *
 * The cap itself lives server-side (FREE_PLAN_CHATBOT_TURN_LIMIT, enforced in
 * server/utils/ai/budget.ts); /api/billing/status reports the org's usage
 * against it. This wraps that meter so the chat page can warn *before* the last
 * message is spent and swap the composer for an upsell once it is, instead of
 * letting the user type into a box that will only ever return a 429.
 *
 * `limit` is null on any paid tier or billing-disabled self-hosted instance —
 * every consumer must treat that as "uncapped", not "zero left".
 */
import { freePlanUsage, useBillingStatus } from '~/composables/useBillingStatus'

/** How many messages left before we start nudging. */
export const CHATBOT_QUOTA_WARN_AT = 5

export function useChatbotQuota() {
  const { data: status, refresh } = useBillingStatus()

  const meter = computed(() => freePlanUsage(status.value)?.aiAssistant ?? null)

  /** The free-tier cap, or null when this org isn't count-capped. */
  const limit = computed<number | null>(() => {
    const value = meter.value?.limit
    return value != null && Number.isFinite(value) && value > 0 ? value : null
  })

  const used = computed(() => meter.value?.used ?? 0)

  /** Messages left, or null when uncapped. */
  const remaining = computed<number | null>(() =>
    limit.value == null ? null : Math.max(0, limit.value - used.value),
  )

  /** Allowance spent — the composer is replaced by the upsell. */
  const exhausted = computed(() => remaining.value === 0)

  /** Close enough to the cap to be worth a heads-up, but not there yet. */
  const nearLimit = computed(() => {
    const left = remaining.value
    return left != null && left > 0 && left <= CHATBOT_QUOTA_WARN_AT
  })

  return { limit, used, remaining, exhausted, nearLimit, refresh }
}
