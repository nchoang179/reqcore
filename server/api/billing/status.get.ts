import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { subscription as subscriptionTable } from '../../database/schema'
import { isStripeBillingConfigured } from '../../utils/env'
import { resolveStripePricePlan } from '../../utils/billing/stripe-plans'
import { BILLING_PLAN_IDS } from '../../../shared/billing'

/**
 * Billing status for the active organization.
 *
 * The Stripe plugin is only loaded when STRIPE_SECRET_KEY is set, so the client
 * cannot tell whether billing is available. This endpoint reports that, plus the
 * org's current subscription. The local row is maintained by Stripe webhooks,
 * and this endpoint best-effort reconciles it from Stripe when a subscription
 * id is present so the UI does not drift after plan renames or missed webhooks.
 * It also returns the org's usage vs. plan caps so the billing UI can show free
 * orgs how close they are to the limits the upsell lifts.
 */

// Statuses that mean the org currently has plan entitlements. `past_due` is an
// intentional dunning grace state and mirrors server/utils/billing/plan.ts.
const CURRENT_STATUSES = new Set(['active', 'trialing', 'past_due'])

type SubscriptionRow = {
  id: string
  plan: string
  stripeSubscriptionId: string | null
  status: string
  periodEnd: Date | null
  cancelAtPeriodEnd: boolean | null
  billingInterval: string | null
}

function unixDate(value: number | null | undefined): Date | null {
  return value ? new Date(value * 1000) : null
}

function getSubscriptionItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem | null {
  return subscription.items.data.find(item => item.price?.id) ?? null
}

async function reconcileFromStripe(row: SubscriptionRow): Promise<SubscriptionRow> {
  if (!row.stripeSubscriptionId || !env.STRIPE_SECRET_KEY) return row

  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY)
    const stripeSubscription = await stripe.subscriptions.retrieve(row.stripeSubscriptionId)
    const item = getSubscriptionItem(stripeSubscription)
    const priceMatch = resolveStripePricePlan(env, item?.price?.id)
    const nextPlan = priceMatch?.planId ?? row.plan
    const nextBillingInterval = priceMatch?.billingInterval ?? row.billingInterval
    const nextPeriodEnd = unixDate(
      item?.current_period_end
      ?? (stripeSubscription as Stripe.Subscription & { current_period_end?: number }).current_period_end,
    ) ?? row.periodEnd
    const nextCancelAtPeriodEnd = stripeSubscription.cancel_at_period_end ?? row.cancelAtPeriodEnd ?? false

    const nextRow: SubscriptionRow = {
      ...row,
      plan: nextPlan,
      status: stripeSubscription.status,
      periodEnd: nextPeriodEnd,
      cancelAtPeriodEnd: nextCancelAtPeriodEnd,
      billingInterval: nextBillingInterval,
    }

    const changed =
      nextRow.plan !== row.plan
      || nextRow.status !== row.status
      || nextRow.billingInterval !== row.billingInterval
      || nextRow.cancelAtPeriodEnd !== (row.cancelAtPeriodEnd ?? false)
      || nextRow.periodEnd?.getTime() !== row.periodEnd?.getTime()

    if (changed) {
      await db
        .update(subscriptionTable)
        .set({
          plan: nextRow.plan,
          status: nextRow.status,
          periodEnd: nextRow.periodEnd,
          cancelAtPeriodEnd: nextRow.cancelAtPeriodEnd,
          billingInterval: nextRow.billingInterval,
        })
        .where(eq(subscriptionTable.id, row.id))
    }

    return nextRow
  }
  catch (error) {
    logWarn('billing.stripe_reconcile_failed', {
      stripe_subscription_id: row.stripeSubscriptionId,
      error_message: error instanceof Error ? error.message : 'Unknown error',
    })
    return row
  }
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const enabled = isStripeBillingConfigured(env)
  if (!enabled) {
    // Billing-disabled self-hosted instances do not enforce SaaS usage quotas.
    // `usage: null` is therefore the client contract for uncapped, not hidden
    // usage; useChatbotQuota deliberately maps it to a null (unlimited) limit.
    return { enabled: false, subscription: null, usage: null }
  }

  const usage = await getOrgUsage(orgId)

  const rows = await db
    .select({
      id: subscriptionTable.id,
      plan: subscriptionTable.plan,
      stripeSubscriptionId: subscriptionTable.stripeSubscriptionId,
      status: subscriptionTable.status,
      periodEnd: subscriptionTable.periodEnd,
      cancelAtPeriodEnd: subscriptionTable.cancelAtPeriodEnd,
      billingInterval: subscriptionTable.billingInterval,
    })
    .from(subscriptionTable)
    .where(eq(subscriptionTable.referenceId, orgId))

  // One org normally has one subscription, but internal entitlement rows (e.g.
  // grandfathered free BYOK) can coexist with a later Stripe upgrade. Prefer a
  // current Stripe-managed self-serve plan when present, then internal current
  // entitlements, then the most recently relevant row (e.g. canceled).
  const currentRows = rows.filter(r => CURRENT_STATUSES.has(r.status))
  const current =
    currentRows.find(r => r.stripeSubscriptionId && BILLING_PLAN_IDS.includes(r.plan as typeof BILLING_PLAN_IDS[number]))
    ?? currentRows.find(r => r.plan === 'agency')
    ?? currentRows.find(r => r.plan === 'grandfathered')
    ?? currentRows[0]
    ?? rows[0]
    ?? null
  const reconciled = current ? await reconcileFromStripe(current) : null

  return {
    enabled: true,
    usage,
    subscription: reconciled
      ? {
          plan: reconciled.plan,
          stripeSubscriptionId: reconciled.stripeSubscriptionId,
          status: reconciled.status,
          periodEnd: reconciled.periodEnd ? reconciled.periodEnd.toISOString() : null,
          cancelAtPeriodEnd: reconciled.cancelAtPeriodEnd ?? false,
          billingInterval: reconciled.billingInterval ?? null,
        }
      : null,
  }
})
