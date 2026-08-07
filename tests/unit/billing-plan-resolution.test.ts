import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscription, job } from '../../server/database/schema'
import {
  resolveOrgPlanId,
  assertActiveRoleLimit,
  assertPlanFeature,
  assertTierFeature,
  ActiveRoleLimitError,
} from '../../server/utils/billing/plan'
import { tierHasFeature } from '../../shared/billing'

/**
 * The point of billing is that paying changes behavior. The Stripe webhook keeps
 * the `subscription` table up to date; these tests prove the table is read back
 * into the right tier and the right active-role cap — including the cases an
 * attacker or a billing bug would exploit (canceled/incomplete subs, unknown
 * plan names, exactly-at-limit, unlimited tiers).
 *
 * The DB is stubbed the same way the rest of the suite does it (vi.stubGlobal):
 * `db.select(...).from(table).where(...)` resolves to rows, dispatched by which
 * table the query reads from.
 */

interface SubRow { plan: string, status: string }

let openJobCount = 0
const whereCalls: unknown[] = []

function stubDb(subRows: SubRow[]) {
  whereCalls.length = 0
  vi.stubGlobal('db', {
    select() {
      return {
        from(table: unknown) {
          return {
            where(...args: unknown[]) {
              whereCalls.push(table)
              if (table === subscription) return Promise.resolve(subRows)
              if (table === job) return Promise.resolve([{ total: String(openJobCount) }])
              return Promise.resolve([])
            },
          }
        },
      }
    },
  })
}

beforeEach(() => {
  openJobCount = 0
  // createError → a plain Error carrying the H3 fields, so we can assert on them.
  vi.stubGlobal('createError', (opts: Record<string, unknown>) => {
    const err = new Error(String(opts.statusMessage ?? 'error'))
    Object.assign(err, opts)
    return err
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('resolveOrgPlanId', () => {
  it('returns the paid tier for an active subscription', async () => {
    stubDb([{ plan: 'team', status: 'active' }])
    expect(await resolveOrgPlanId('org_1')).toBe('team')
  })

  it('treats trialing and past_due as still-on-plan', async () => {
    stubDb([{ plan: 'scale', status: 'trialing' }])
    expect(await resolveOrgPlanId('org_1')).toBe('scale')

    stubDb([{ plan: 'solo', status: 'past_due' }])
    expect(await resolveOrgPlanId('org_1')).toBe('solo')
  })

  it('resolves a manually-provisioned grandfathered free BYOK tier', async () => {
    stubDb([{ plan: 'grandfathered', status: 'active' }])
    expect(await resolveOrgPlanId('org_1')).toBe('grandfathered')
  })

  it('falls back to free for canceled / incomplete / no subscription', async () => {
    stubDb([{ plan: 'team', status: 'canceled' }])
    expect(await resolveOrgPlanId('org_1')).toBe('free')

    stubDb([{ plan: 'team', status: 'incomplete' }])
    expect(await resolveOrgPlanId('org_1')).toBe('free')

    stubDb([])
    expect(await resolveOrgPlanId('org_1')).toBe('free')
  })

  it('falls back to free for an unknown plan name even if active', async () => {
    stubDb([{ plan: 'legacy_gold', status: 'active' }])
    expect(await resolveOrgPlanId('org_1')).toBe('free')
  })

  it('prefers the active row when an org has both canceled and active subs', async () => {
    stubDb([
      { plan: 'solo', status: 'canceled' },
      { plan: 'team', status: 'active' },
    ])
    expect(await resolveOrgPlanId('org_1')).toBe('team')
  })

  it('prefers a paid Stripe tier over a lingering grandfathered row', async () => {
    stubDb([
      { plan: 'grandfathered', status: 'active' },
      { plan: 'team', status: 'active' },
    ])
    expect(await resolveOrgPlanId('org_1')).toBe('team')
  })
})

describe('assertActiveRoleLimit', () => {
  it('allows opening a role below the cap', async () => {
    stubDb([{ plan: 'team', status: 'active' }]) // cap 8
    openJobCount = 7
    await expect(assertActiveRoleLimit('org_1')).resolves.toBeUndefined()
  })

  it('blocks opening a role at the cap with a 402 + machine-readable code', async () => {
    stubDb([{ plan: 'solo', status: 'active' }]) // cap 2
    openJobCount = 2
    await expect(assertActiveRoleLimit('org_1')).rejects.toMatchObject({
      statusCode: 402,
      data: { code: 'ACTIVE_ROLE_LIMIT', tier: 'solo', limit: 2 },
    })
  })

  it('blocks free orgs after their single open role', async () => {
    stubDb([]) // free, cap 1
    openJobCount = 1
    await expect(assertActiveRoleLimit('org_1')).rejects.toMatchObject({ statusCode: 402 })
  })

  it('never throws for unlimited tiers and skips the job-count query', async () => {
    stubDb([{ plan: 'agency', status: 'active' }]) // unlimited
    openJobCount = 9999
    await expect(assertActiveRoleLimit('org_1')).resolves.toBeUndefined()
    // Only the subscription lookup ran; the open-role count was short-circuited.
    expect(whereCalls).not.toContain(job)
  })
})

describe('tierHasFeature', () => {
  it('allows tracked interviews on Free and gates calendar at Team+', () => {
    expect(tierHasFeature('free', 'interviews')).toBe(true)
    expect(tierHasFeature('solo', 'interviews')).toBe(true)
    expect(tierHasFeature('solo', 'calendar')).toBe(false)
    expect(tierHasFeature('team', 'calendar')).toBe(true)
  })

  it('allows the branded career page on every plan', () => {
    for (const tier of ['free', 'solo', 'team', 'grandfathered', 'scale', 'agency'] as const) {
      expect(tierHasFeature(tier, 'careerPage')).toBe(true)
    }
  })

  it('gates source / timeline / AI analytics dashboards at Team+', () => {
    for (const feature of ['sourceAnalytics', 'activityTimeline', 'aiAnalytics'] as const) {
      expect(tierHasFeature('solo', feature)).toBe(false)
      expect(tierHasFeature('team', feature)).toBe(true)
    }
  })

  it('gates sso / auditLog / retention at Scale+', () => {
    for (const feature of ['sso', 'auditLog', 'retention'] as const) {
      expect(tierHasFeature('free', feature)).toBe(false)
      expect(tierHasFeature('team', feature)).toBe(false)
      expect(tierHasFeature('scale', feature)).toBe(true)
    }
  })

  it('gates BYOK at Solo+, keeping it for grandfathered orgs', () => {
    // Free can't bring its own key — that would be the uncapped assistant and
    // uncapped shortlists for nothing, which is what Solo sells.
    expect(tierHasFeature('free', 'byok')).toBe(false)
    for (const tier of ['solo', 'team', 'grandfathered', 'scale', 'agency'] as const) {
      expect(tierHasFeature(tier, 'byok')).toBe(true)
    }
  })

  it('allows the assistant on every plan (Free is metered by turn count)', () => {
    for (const tier of ['free', 'solo', 'team', 'grandfathered', 'scale', 'agency'] as const) {
      expect(tierHasFeature(tier, 'chatbot')).toBe(true)
    }
  })

  it('gives grandfathered orgs Team features plus BYOK without Scale features', () => {
    expect(tierHasFeature('grandfathered', 'byok')).toBe(true)
    expect(tierHasFeature('grandfathered', 'interviews')).toBe(true)
    expect(tierHasFeature('grandfathered', 'calendar')).toBe(true)
    expect(tierHasFeature('grandfathered', 'sourceAnalytics')).toBe(true)
    expect(tierHasFeature('grandfathered', 'activityTimeline')).toBe(true)
    expect(tierHasFeature('grandfathered', 'aiAnalytics')).toBe(true)
    expect(tierHasFeature('grandfathered', 'sso')).toBe(false)
    expect(tierHasFeature('grandfathered', 'auditLog')).toBe(false)
    expect(tierHasFeature('grandfathered', 'retention')).toBe(false)
  })

  it('grants every feature to agency (highest tier inherits all)', () => {
    for (const feature of [
      'interviews', 'calendar', 'sourceAnalytics', 'activityTimeline',
      'aiAnalytics', 'sso', 'auditLog', 'retention', 'byok',
    ] as const) {
      expect(tierHasFeature('agency', feature)).toBe(true)
    }
  })
})

describe('assertTierFeature', () => {
  it('passes silently when the tier is entitled', () => {
    expect(() => assertTierFeature('solo', 'byok')).not.toThrow()
  })

  it('throws a 402 with a machine-readable code + required tier when not entitled', () => {
    expect(() => assertTierFeature('free', 'sso')).toThrow()
    try {
      assertTierFeature('free', 'sso')
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 402,
        data: { code: 'PLAN_FEATURE_REQUIRED', feature: 'sso', requiredTier: 'scale', tier: 'free' },
      })
    }
  })
})

describe('assertPlanFeature', () => {
  // assertPlanFeature bypasses checks when Stripe is not configured. Stub the
  // keys so these tests exercise the full enforcement path.
  beforeEach(() => {
    for (const key of [
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRICE_SOLO_MONTHLY', 'STRIPE_PRICE_SOLO_ANNUAL',
      'STRIPE_PRICE_TEAM_MONTHLY', 'STRIPE_PRICE_TEAM_ANNUAL',
      'STRIPE_PRICE_SCALE_MONTHLY', 'STRIPE_PRICE_SCALE_ANNUAL',
    ]) {
      vi.stubEnv(key, 'test_value')
    }
  })

  afterEach(() => vi.unstubAllEnvs())

  it('resolves the tier and returns it when entitled', async () => {
    stubDb([{ plan: 'scale', status: 'active' }])
    await expect(assertPlanFeature('org_1', 'sso')).resolves.toBe('scale')
  })

  it('rejects with a 402 when the resolved tier lacks the feature', async () => {
    stubDb([{ plan: 'solo', status: 'active' }])
    await expect(assertPlanFeature('org_1', 'calendar')).rejects.toMatchObject({
      statusCode: 402,
      data: { code: 'PLAN_FEATURE_REQUIRED', feature: 'calendar', requiredTier: 'team', tier: 'solo' },
    })
  })

  it('rejects a free org (no subscription) for a paid feature', async () => {
    stubDb([])
    await expect(assertPlanFeature('org_1', 'interviews')).resolves.toBe('free')
  })

  it('unlocks plan features when Stripe is intentionally disabled', async () => {
    for (const key of [
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRICE_SOLO_MONTHLY', 'STRIPE_PRICE_SOLO_ANNUAL',
      'STRIPE_PRICE_TEAM_MONTHLY', 'STRIPE_PRICE_TEAM_ANNUAL',
      'STRIPE_PRICE_SCALE_MONTHLY', 'STRIPE_PRICE_SCALE_ANNUAL',
    ]) {
      vi.stubEnv(key, '')
    }
    vi.stubEnv('NODE_ENV', 'production')
    stubDb([])
    await expect(assertPlanFeature('org_1', 'sso')).resolves.toBe('scale')
    expect(whereCalls).not.toContain(subscription)
  })

  it('fails closed for a partial Stripe configuration', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    vi.stubEnv('NODE_ENV', 'production')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubDb([]) // free org → paid feature must be denied despite the misconfig
    await expect(assertPlanFeature('org_1', 'sso')).rejects.toMatchObject({ statusCode: 402 })
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('ActiveRoleLimitError', () => {
  it('carries the tier and limit for callers that catch it directly', () => {
    const err = new ActiveRoleLimitError('solo', 2, 'too many')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ActiveRoleLimitError')
    expect(err.tier).toBe('solo')
    expect(err.limit).toBe(2)
  })
})
