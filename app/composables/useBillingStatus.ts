/**
 * Shared billing status + usage for the active org.
 *
 * Wraps /api/billing/status behind a fixed useFetch key so every consumer
 * (billing page, top-bar upgrade pill, …) shares one request and one cache
 * entry. The endpoint returns whether Stripe billing is enabled, the current
 * subscription, and the org's usage against the count-based plan caps.
 */
import { tierUsesFreeAllowances, type BillingTier } from '~~/shared/billing'

export interface UsageMeter {
  used: number
  /** Hard cap on this tier, or null when there's no fixed count limit. */
  limit: number | null
}

export interface BillingUsage {
  tier: BillingTier
  activeRoles: UsageMeter
  aiAnalysis: UsageMeter
  aiAssistant: UsageMeter
  candidateConversations: UsageMeter
}

export interface BillingStatus {
  enabled: boolean
  usage: BillingUsage | null
  subscription: null | {
    plan: string
    stripeSubscriptionId: string | null
    status: string
    periodEnd: string | null
    cancelAtPeriodEnd: boolean
    billingInterval: string | null
  }
}

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due']

export function useBillingStatus() {
  return useFetch<BillingStatus>('/api/billing/status', {
    key: 'billing-status',
    headers: useRequestHeaders(['cookie']),
  })
}

/**
 * The org's usage, but only when it's still on the free tier (no active paid
 * subscription). Returns null otherwise — the signal for "show the upsell".
 */
export function freePlanUsage(status: BillingStatus | null | undefined): BillingUsage | null {
  if (!status?.enabled || !status.usage) return null
  const sub = status.subscription
  const onPaidPlan = !!sub && ACTIVE_STATUSES.includes(sub.status)
  if (onPaidPlan || !tierUsesFreeAllowances(status.usage.tier)) return null
  return status.usage
}
