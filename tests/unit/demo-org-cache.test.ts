import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDemoOrgIdCache, getDemoOrgIds } from '../../server/utils/demoOrg'

/**
 * Regression cover for the reseed footgun: `npm run db:reseed` deletes the demo
 * org and recreates it under the same slug with a new id. A permanently cached
 * slug → id mapping left the running server pinned to the deleted id, which
 * made `/organization/list` filter out the demo org entirely and pushed the
 * demo account into "create an organization".
 */

/** Minimal drizzle-select stub returning `rows` for every query. */
function stubDb(rows: () => Array<{ id: string }>) {
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: async () => rows(),
      }),
    }),
  }))
  vi.stubGlobal('db', { select })
  return select
}

describe('demo org id cache', () => {
  beforeEach(() => {
    clearDemoOrgIdCache()
    vi.useFakeTimers()
    vi.stubGlobal('env', { DEMO_ORG_SLUG: 'reqcore-demo', RAILWAY_ENVIRONMENT_NAME: 'production' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    clearDemoOrgIdCache()
  })

  it('caches the lookup so repeat requests do not hit the database', async () => {
    const select = stubDb(() => [{ id: 'org-old' }])

    await expect(getDemoOrgIds(['reqcore-demo'])).resolves.toEqual(new Set(['org-old']))
    await expect(getDemoOrgIds(['reqcore-demo'])).resolves.toEqual(new Set(['org-old']))

    expect(select).toHaveBeenCalledTimes(1)
  })

  it('picks up the new org id after a reseed once the TTL expires', async () => {
    let current = 'org-old'
    stubDb(() => [{ id: current }])

    await expect(getDemoOrgIds(['reqcore-demo'])).resolves.toEqual(new Set(['org-old']))

    // Reseed: old org deleted, new one created under the same slug.
    current = 'org-new'
    await expect(getDemoOrgIds(['reqcore-demo'])).resolves.toEqual(new Set(['org-old']))

    vi.advanceTimersByTime(60_001)
    await expect(getDemoOrgIds(['reqcore-demo'])).resolves.toEqual(new Set(['org-new']))
  })

  it('drops the stale id when the org no longer exists', async () => {
    let rows: Array<{ id: string }> = [{ id: 'org-old' }]
    stubDb(() => rows)

    await getDemoOrgIds(['reqcore-demo'])

    // Mid-reseed: the org row is gone. Expiry alone must not resurrect it.
    rows = []
    vi.advanceTimersByTime(60_001)
    await expect(getDemoOrgIds(['reqcore-demo'])).resolves.toEqual(new Set())

    rows = [{ id: 'org-new' }]
    await expect(getDemoOrgIds(['reqcore-demo'])).resolves.toEqual(new Set(['org-new']))
  })
})
