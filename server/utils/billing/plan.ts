/**
 * Org → billing tier resolution and active-role (open-job) limit enforcement.
 *
 * The plan persisted in `subscription.plan` is one of the Stripe-checkout ids
 * (solo/team/scale). Any org without an active subscription is `free`. Agency is
 * a custom contract and isn't reachable via self-serve checkout, but it's part
 * of the limit table so a manually-provisioned agency org gets the right cap.
 */
import { and, eq, sql } from 'drizzle-orm'
import { subscription, job } from '../../database/schema'
import {
  ACTIVE_ROLE_LIMITS,
  BILLING_PLAN_IDS,
  activeRoleLimitForTier,
  tierHasFeature,
  FEATURE_MIN_TIER,
  featureUpgradeMessage,
  type BillingTier,
  type PlanFeature,
} from '../../../shared/billing'
import { STRIPE_BILLING_ENV_KEYS, isStripeBillingConfigured } from '../env'

/**
 * Subscription statuses that keep paid features enabled.
 *
 * `past_due` is intentionally included as a dunning grace state: Stripe is still
 * trying to collect payment, so we avoid immediately locking teams out of active
 * work. Removing it here changes revenue/access policy and should be paired
 * with a product decision about grace periods or read-only downgrade behavior.
 */
const PAID_ENTITLEMENT_STATUSES = ['active', 'trialing', 'past_due']

function stripeBillingEnv(): Record<typeof STRIPE_BILLING_ENV_KEYS[number], string | undefined> {
  return Object.fromEntries(
    STRIPE_BILLING_ENV_KEYS.map(key => [key, process.env[key]]),
  ) as Record<typeof STRIPE_BILLING_ENV_KEYS[number], string | undefined>
}

/**
 * Whether billing was intentionally disabled by leaving every Stripe variable
 * unset. This is the normal self-hosted mode and is distinct from a partial
 * Stripe setup, which is configuration drift and must not unlock paid features.
 */
export function isBillingDisabled(): boolean {
  const config = stripeBillingEnv()
  return STRIPE_BILLING_ENV_KEYS.every(key => !config[key])
}

/**
 * Resolve an org's billing tier. Returns the persisted plan id for orgs with an
 * active subscription, otherwise `'free'`. Shared by the budget gate and the
 * active-role limit so both agree on what plan an org is on.
 */
export async function resolveOrgPlanId(orgId: string): Promise<BillingTier> {
  const rows = await db
    .select({ plan: subscription.plan, status: subscription.status })
    .from(subscription)
    .where(eq(subscription.referenceId, orgId))

  const entitlementRows = rows.filter(r => PAID_ENTITLEMENT_STATUSES.includes(r.status))
  const current =
    entitlementRows.find(r => BILLING_PLAN_IDS.includes(r.plan as typeof BILLING_PLAN_IDS[number]))
    ?? entitlementRows.find(r => r.plan === 'agency')
    ?? entitlementRows.find(r => r.plan === 'grandfathered')
  const plan = current?.plan
  return plan && plan in ACTIVE_ROLE_LIMITS ? (plan as BillingTier) : 'free'
}

/** Count an org's currently-open roles (jobs with status 'open'). */
// Test roles are excluded: they exist so someone can try the product, and
// billing them against the cap would make the walkthrough consume a free
// workspace's only slot.
async function countOpenJobs(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`count(*)` })
    .from(job)
    .where(and(eq(job.organizationId, orgId), eq(job.status, 'open'), eq(job.isTest, false)))
  return Number(row?.total ?? 0)
}

export class ActiveRoleLimitError extends Error {
  constructor(
    public readonly tier: BillingTier,
    public readonly limit: number,
    message: string,
  ) {
    super(message)
    this.name = 'ActiveRoleLimitError'
  }
}

/**
 * Assert the org can have one *more* open role. Call this right before opening a
 * job (creating with status 'open', or transitioning an existing job to 'open').
 * Throws an H3 402 when the plan's active-role cap is already reached.
 *
 * Caps are enforced at open-time ONLY. Downgrades and cancellations never
 * retroactively close existing open roles: an org that opens 2 roles on Solo
 * (cap 2) and cancels to Free (cap 1) keeps both open. This is intentional —
 * auto-closing on downgrade would take a live careers page / application form
 * down on *involuntary* churn (expired card → past_due → canceled), killing an
 * in-progress hire. Over-limit orgs instead simply can't open new roles until
 * they close back under the cap, which is a natural upgrade nudge. Do not "fix"
 * this by auto-closing roles.
 */
export async function assertActiveRoleLimit(orgId: string): Promise<void> {
  if (isBillingDisabled()) return // self-hosted (no Stripe): role cap not enforced
  const tier = await resolveOrgPlanId(orgId)
  const limit = activeRoleLimitForTier(tier)
  if (!Number.isFinite(limit)) return // agency / unlimited

  const openCount = await countOpenJobs(orgId)
  if (openCount >= limit) {
    throw createError({
      statusCode: 402,
      statusMessage:
        `Your plan allows ${limit} open role${limit === 1 ? '' : 's'} at a time. ` +
        `Close a role or upgrade to open more.`,
      data: { code: 'ACTIVE_ROLE_LIMIT', tier, limit },
    })
  }
}

/** The partial unique index that makes the one-test-role-per-org rule airtight. */
const TEST_ROLE_UNIQUE_INDEX = 'job_one_test_per_org_idx'

/**
 * Whether a failed insert was Postgres refusing a second test role.
 *
 * `assertTestRoleLimit` wins the common case, but it is a check-then-insert:
 * concurrent creates both pass it and one hits the index instead. The loser
 * should get the same 409 as everyone else rather than a 500.
 */
export function isDuplicateTestRoleError(error: unknown): boolean {
  const pgError = error as { code?: string, constraint_name?: string } | null
  return pgError?.code === '23505' && pgError.constraint_name === TEST_ROLE_UNIQUE_INDEX
}

/**
 * Assert the org may create a test role — i.e. that it has none already.
 *
 * A test role is exempt from the active-role cap (see `countOpenJobs`), and it
 * is otherwise a fully working job: public at `/jobs/<slug>`, taking real
 * applications, auto-scoring them. So the exemption itself has to be capped, or
 * `/dashboard/jobs/new?mode=test` is an unlimited supply of free open roles on a
 * product priced per active role.
 *
 * One is all the walkthrough needs, and the entry point is only offered to an
 * org with no jobs at all. Deleting the test role frees the slot, which is the
 * intended way to run the tour again. The `job_one_test_per_org_idx` index backs
 * this up in the database, where a concurrent second create cannot slip past.
 */
export async function assertTestRoleLimit(orgId: string): Promise<void> {
  const [existing] = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.organizationId, orgId), eq(job.isTest, true)))
    .limit(1)

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'You already have a test job. Delete it before creating another.',
      data: { code: 'TEST_ROLE_EXISTS', jobId: existing.id },
    })
  }
}

/**
 * Assert an already-resolved tier is entitled to a plan-gated feature. Throws an
 * H3 402 (`PLAN_FEATURE_REQUIRED`) otherwise. Use this when you already have the
 * tier in hand (e.g. to gate a sub-feature after a primary check) to avoid a
 * second subscription lookup; otherwise prefer assertPlanFeature.
 */
export function assertTierFeature(tier: BillingTier, feature: PlanFeature): void {
  if (tierHasFeature(tier, feature)) return
  throw createError({
    statusCode: 402,
    statusMessage: featureUpgradeMessage(feature),
    data: { code: 'PLAN_FEATURE_REQUIRED', feature, requiredTier: FEATURE_MIN_TIER[feature], tier },
  })
}

/**
 * Resolve the org's tier and assert it's entitled to `feature`, throwing an
 * H3 402 if not. Returns the resolved tier so the caller can reuse it for
 * further per-tier decisions without a second lookup.
 *
 * A completely absent Stripe configuration is the supported self-hosted mode,
 * so plan features are unlocked there even when NODE_ENV is production. A
 * partial Stripe configuration is drift: fail closed against the stored tier
 * and log loudly. The environment schema also rejects partial configuration at
 * startup, but keeping the distinction here makes the authorization boundary
 * safe on its own.
 */
export async function assertPlanFeature(orgId: string, feature: PlanFeature): Promise<BillingTier> {
  const billingEnv = stripeBillingEnv()

  if (STRIPE_BILLING_ENV_KEYS.every(key => !billingEnv[key])) return 'scale'

  if (!isStripeBillingConfigured(billingEnv)) {
    const missing = STRIPE_BILLING_ENV_KEYS.filter(key => !billingEnv[key])
    console.error(
      `[Reqcore] Stripe billing is partially configured (missing ${missing.join(', ')}); ` +
        'enforcing plan features by stored subscription tier instead of unlocking. ' +
        'Restore the missing Stripe variables to resume normal billing.',
    )
  }

  const tier = await resolveOrgPlanId(orgId)
  assertTierFeature(tier, feature)
  return tier
}
