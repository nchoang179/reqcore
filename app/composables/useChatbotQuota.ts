/**
 * Assistant credit allowance, as the chat UI sees it.
 *
 * The allowance is enforced server-side (assertChatbotAllowance in
 * server/utils/ai/budget.ts); /api/billing/status reports how much of it the org
 * has spent. This wraps that meter so the chat page can warn *before* the last
 * credit is spent and swap the composer for an upsell once it is, instead of
 * letting the user type into a box that will only ever return a 429.
 *
 * Free usage is an exact prompt count. Paid usage remains a percentage because
 * the server deliberately never sends a raw credit balance or token count.
 *
 * `percentUsed` is null on a billing-disabled self-hosted instance — every
 * consumer must treat that as "uncapped", not "nothing left".
 */
import { useBillingStatus } from '~/composables/useBillingStatus'

/**
 * How little headroom is left before we say something. Below this the meter
 * stays hidden entirely: a limit nobody is near is just noise, and the fewer
 * times the number is on screen the less there is to reverse-engineer.
 */
export const CHATBOT_QUOTA_WARN_AT_PERCENT = 75

export function useChatbotQuota() {
  const { data: status, refresh } = useBillingStatus()

  const usage = computed(() => {
    const value = status.value
    return value?.enabled ? value.usage : null
  })

  const isFree = computed(() => usage.value?.tier === 'free')
  const used = computed(() => usage.value?.aiAssistant?.used ?? null)
  const limit = computed(() => usage.value?.aiAssistant?.limit ?? null)

  /** Exact remaining prompts on Free; null for paid/uncapped workspaces. */
  const promptsRemaining = computed<number | null>(() => {
    if (!isFree.value || used.value == null || limit.value == null) return null
    return Math.max(0, limit.value - used.value)
  })

  /** Percent of the allowance spent, or null when this org isn't capped. */
  const percentUsed = computed<number | null>(() => {
    const current = used.value
    const cap = limit.value
    if (typeof current !== 'number' || !Number.isFinite(current)) return null
    if (isFree.value) {
      if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) return null
      return Math.min(100, Math.max(0, Math.round((current / cap) * 100)))
    }
    return current
  })

  /** Percent of the allowance still available, or null when uncapped. */
  const percentRemaining = computed<number | null>(() =>
    percentUsed.value == null ? null : Math.max(0, 100 - percentUsed.value),
  )

  /** Allowance spent — the composer is replaced by the upsell. */
  const exhausted = computed(() => percentUsed.value != null && percentUsed.value >= 100)

  /** Close enough to the limit to be worth a heads-up, but not there yet. */
  const nearLimit = computed(() => {
    const used = percentUsed.value
    return used != null && used >= CHATBOT_QUOTA_WARN_AT_PERCENT && used < 100
  })

  /**
   * Free orgs get the upgrade path; paid orgs that run out are offered BYOK,
   * which is uncapped and costs us nothing to serve.
   */
  return {
    used,
    limit,
    promptsRemaining,
    percentUsed,
    percentRemaining,
    exhausted,
    nearLimit,
    isFree,
    refresh,
  }
}
