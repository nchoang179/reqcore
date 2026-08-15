import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  recordApplicationView,
  unviewedApplicationCount,
  unviewedCountsByJob,
  viewedAtByApplication,
} from '../../server/utils/applicationViews'

afterEach(() => vi.unstubAllGlobals())

/**
 * Chainable drizzle stub. Every builder method returns the same thenable, so it
 * works both where the query is awaited and where it's handed to inArray() as a
 * subquery.
 */
function stubQuery(rows: unknown[]) {
  const chain: any = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    then: (resolve: (value: unknown) => void) => resolve(rows),
  }
  return chain
}

describe('application read receipts', () => {
  it('upserts on (application, user) so re-opening only bumps viewedAt', async () => {
    const onConflictDoUpdate = vi.fn(async () => undefined)
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    vi.stubGlobal('db', { insert: vi.fn(() => ({ values })) })

    await recordApplicationView({
      organizationId: 'org-1',
      applicationId: 'app-1',
      userId: 'user-1',
    })

    expect(values).toHaveBeenCalledWith({
      organizationId: 'org-1',
      applicationId: 'app-1',
      userId: 'user-1',
    })
    // Bumped with the database clock, not a JS Date, so re-opens stay
    // comparable to the `defaultNow()` timestamp written on first open.
    const conflict = onConflictDoUpdate.mock.calls[0]![0] as { target: unknown[], set: { viewedAt: any } }
    expect(conflict.target).toHaveLength(2)
    expect(conflict.set.viewedAt).not.toBeInstanceOf(Date)
    expect(JSON.stringify(conflict.set.viewedAt.queryChunks)).toContain('now()')
  })

  it('never lets a failed receipt break the request that logged it', async () => {
    const logWarn = vi.fn()
    vi.stubGlobal('logWarn', logWarn)
    vi.stubGlobal('db', {
      insert: vi.fn(() => {
        throw new Error('db down')
      }),
    })

    await expect(recordApplicationView({
      organizationId: 'org-1',
      applicationId: 'app-1',
      userId: 'user-1',
    })).resolves.toBeUndefined()
    expect(logWarn).toHaveBeenCalledWith('application_view.record_failed', expect.objectContaining({
      application_id: 'app-1',
    }))
  })

  it('maps receipts by application and leaves unseen ids out', async () => {
    const viewedAt = new Date('2026-08-09T10:00:00Z')
    vi.stubGlobal('db', stubQuery([{ applicationId: 'app-1', viewedAt }]))

    const map = await viewedAtByApplication({
      userId: 'user-1',
      applicationIds: ['app-1', 'app-2'],
    })

    expect(map.get('app-1')).toBe(viewedAt)
    expect(map.has('app-2')).toBe(false)
  })

  it('skips the query entirely when there is nothing to look up', async () => {
    const db = stubQuery([])
    vi.stubGlobal('db', db)

    await expect(viewedAtByApplication({ userId: 'user-1', applicationIds: [] })).resolves.toEqual(new Map())
    await expect(unviewedCountsByJob({ organizationId: 'org-1', userId: 'user-1', jobIds: [] })).resolves.toEqual(new Map())
    expect(db.select).not.toHaveBeenCalled()
  })

  // The demo is a single shared account and is advertised as read-only, but the
  // receipt is written from a GET, which demo-guard never inspects.
  describe('demo organization', () => {
    it('records nothing, and raises no error the visitor would see', async () => {
      const insert = vi.fn()
      vi.stubGlobal('env', { DEMO_ORG_SLUG: 'reqcore-demo', RAILWAY_ENVIRONMENT_NAME: 'production' })
      vi.stubGlobal('db', {
        insert,
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [{ id: 'demo-org' }]),
            })),
          })),
        })),
      })

      await expect(recordApplicationView({
        organizationId: 'demo-org',
        applicationId: 'app-1',
        userId: 'demo-user',
      })).resolves.toBeUndefined()

      expect(insert).not.toHaveBeenCalled()
    })

    it('still records for a non-demo org', async () => {
      const onConflictDoUpdate = vi.fn(async () => undefined)
      const values = vi.fn(() => ({ onConflictDoUpdate }))
      vi.stubGlobal('env', { DEMO_ORG_SLUG: 'reqcore-demo', RAILWAY_ENVIRONMENT_NAME: 'production' })
      vi.stubGlobal('db', {
        insert: vi.fn(() => ({ values })),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [{ id: 'demo-org' }]),
            })),
          })),
        })),
      })

      await recordApplicationView({
        organizationId: 'real-org',
        applicationId: 'app-1',
        userId: 'user-1',
      })

      expect(values).toHaveBeenCalled()
    })
  })

  it('returns unviewed counts per job, omitting jobs with none', async () => {
    vi.stubGlobal('db', stubQuery([{ jobId: 'job-1', count: 224 }]))

    const counts = await unviewedCountsByJob({
      organizationId: 'org-1',
      userId: 'user-1',
      jobIds: ['job-1', 'job-2'],
    })

    expect(counts.get('job-1')).toBe(224)
    expect(counts.has('job-2')).toBe(false)
  })

  // The dashboard's "To Review" tile. It spans every job — including closed and
  // archived ones — because an applicant nobody has opened is still waiting on
  // you regardless of what happened to the job they applied to.
  it('counts unviewed applicants org-wide, without scoping to a job', async () => {
    const chain = stubQuery([])
    const $count = vi.fn(async () => 7)
    vi.stubGlobal('db', { ...chain, $count })

    await expect(unviewedApplicationCount({
      organizationId: 'org-1',
      userId: 'user-1',
    })).resolves.toBe(7)

    // No jobId ever reaches the query — the only arguments are the table and the
    // shared unviewed condition.
    expect($count).toHaveBeenCalledTimes(1)
    expect($count.mock.calls[0]).toHaveLength(2)
  })
})
