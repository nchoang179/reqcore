import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Railway PR environments are cloned from the base environment, so they
 * inherit its BETTER_AUTH_URL (production). Auth must ignore that inherited
 * value and use the PR deployment's own generated domain instead.
 */

async function loadIsStale(envStub: Record<string, unknown>) {
  vi.resetModules()
  vi.stubGlobal('env', envStub)
  const mod = await import('../../server/utils/auth')
  return mod.isStaleInheritedPreviewUrl
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isStaleInheritedPreviewUrl', () => {
  it('ignores an inherited production URL in a PR environment', async () => {
    const isStale = await loadIsStale({
      RAILWAY_ENVIRONMENT_NAME: 'pr-264',
    })

    expect(isStale('https://app.reqcore.com', 'reqcore-pr-264.up.railway.app')).toBe(true)
  })

  it('keeps an explicit URL that already matches the PR domain', async () => {
    const isStale = await loadIsStale({
      RAILWAY_ENVIRONMENT_NAME: 'pr-264',
    })

    expect(
      isStale('https://reqcore-pr-264.up.railway.app', 'reqcore-pr-264.up.railway.app'),
    ).toBe(false)
  })

  it('never overrides an explicit URL in production', async () => {
    const isStale = await loadIsStale({
      RAILWAY_ENVIRONMENT_NAME: 'production',
    })

    expect(isStale('https://app.reqcore.com', 'reqcore-production.up.railway.app')).toBe(false)
  })

  it('keeps the explicit URL when no Railway domain exists', async () => {
    const isStale = await loadIsStale({
      RAILWAY_ENVIRONMENT_NAME: 'pr-264',
    })

    expect(isStale('https://app.reqcore.com', undefined)).toBe(false)
  })

  it('fires on RAILWAY_GIT_PR_NUMBER even when the env is named after the branch', async () => {
    const isStale = await loadIsStale({
      RAILWAY_ENVIRONMENT_NAME: 'fix/inbound-reply-address-history',
      RAILWAY_GIT_PR_NUMBER: '265',
    })

    expect(isStale('https://app.reqcore.com', 'applirank-reqcore-pr-265.up.railway.app')).toBe(
      true,
    )
  })

  // Real values observed in the applirank project: the environment is named
  // "reqcore-pr-<N>" (not "pr-<N>"), and RAILWAY_GIT_PR_NUMBER is NOT injected,
  // so detection has to survive on the environment name alone.
  it('detects the real Railway PR environment naming without RAILWAY_GIT_PR_NUMBER', async () => {
    const isStale = await loadIsStale({
      RAILWAY_ENVIRONMENT_NAME: 'reqcore-pr-266',
    })

    expect(
      isStale('https://app.reqcore.com', 'applirank-reqcore-pr-266.up.railway.app'),
    ).toBe(true)
  })

  it('discards an unparseable inherited value in a PR environment', async () => {
    const isStale = await loadIsStale({
      RAILWAY_ENVIRONMENT_NAME: 'pr-264',
    })

    expect(isStale('not-a-url', 'reqcore-pr-264.up.railway.app')).toBe(true)
  })
})
