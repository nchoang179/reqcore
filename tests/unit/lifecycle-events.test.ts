import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sendEventMock, getResendClientMock, isDemoOrgIdMock, isDemoAccountEmailMock } = vi.hoisted(() => ({
  sendEventMock: vi.fn(),
  getResendClientMock: vi.fn(),
  isDemoOrgIdMock: vi.fn(),
  isDemoAccountEmailMock: vi.fn(),
}))

vi.mock('../../server/utils/email', async () => {
  const actual = await vi.importActual<typeof import('../../server/utils/email')>('../../server/utils/email')
  return {
    getResendClient: getResendClientMock,
    // The reserved-domain guard is real logic worth exercising, not a stub.
    isUndeliverableAddress: actual.isUndeliverableAddress,
  }
})

vi.mock('../../server/utils/demoOrg', () => ({
  isDemoOrgId: isDemoOrgIdMock,
  isDemoAccountEmail: isDemoAccountEmailMock,
}))

vi.mock('../../server/utils/logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}))

const { LIFECYCLE_EVENTS, emitLifecycleEvent } = await import('../../server/utils/lifecycle/events')

const baseParams = {
  event: LIFECYCLE_EVENTS.orgCreated,
  email: 'recruiter@acme.com',
  organizationId: 'org_1',
  payload: { organizationName: 'Acme' },
}

beforeEach(() => {
  vi.stubGlobal('env', { LIFECYCLE_EMAILS_ENABLED: true, RESEND_API_KEY: 're_test' })
  sendEventMock.mockResolvedValue({ data: { object: 'event' }, error: null })
  getResendClientMock.mockReturnValue({ events: { send: sendEventMock } })
  isDemoOrgIdMock.mockResolvedValue(false)
  isDemoAccountEmailMock.mockReturnValue(false)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('emitLifecycleEvent', () => {
  it('sends the event with the org id folded into the payload', async () => {
    await expect(emitLifecycleEvent(baseParams)).resolves.toBe(true)

    expect(sendEventMock).toHaveBeenCalledWith({
      event: 'org.created',
      email: 'recruiter@acme.com',
      payload: { organizationName: 'Acme', organizationId: 'org_1' },
    })
  })

  // Fail-closed: a self-hoster must never ship their users' addresses to the
  // hosted Resend account just by upgrading.
  it('is inert when LIFECYCLE_EMAILS_ENABLED is unset', async () => {
    vi.stubGlobal('env', { LIFECYCLE_EMAILS_ENABLED: false, RESEND_API_KEY: 're_test' })

    await expect(emitLifecycleEvent(baseParams)).resolves.toBe(false)
    expect(sendEventMock).not.toHaveBeenCalled()
  })

  it('is inert without a Resend key even when the flag is on', async () => {
    vi.stubGlobal('env', { LIFECYCLE_EMAILS_ENABLED: true, RESEND_API_KEY: undefined })

    await expect(emitLifecycleEvent(baseParams)).resolves.toBe(false)
    expect(sendEventMock).not.toHaveBeenCalled()
  })

  it('skips the shared demo workspace', async () => {
    isDemoOrgIdMock.mockResolvedValue(true)

    await expect(emitLifecycleEvent(baseParams)).resolves.toBe(false)
    expect(sendEventMock).not.toHaveBeenCalled()
  })

  it('skips the demo account', async () => {
    isDemoAccountEmailMock.mockReturnValue(true)

    await expect(emitLifecycleEvent(baseParams)).resolves.toBe(false)
    expect(sendEventMock).not.toHaveBeenCalled()
  })

  it('skips reserved addresses that can only hard bounce', async () => {
    await expect(
      emitLifecycleEvent({ ...baseParams, email: 'sample.applicant@example.com' }),
    ).resolves.toBe(false)
    expect(sendEventMock).not.toHaveBeenCalled()
  })

  // The call sites are org creation and job creation. Neither may fail because
  // a marketing automation was unreachable.
  it('swallows a rejected Resend call', async () => {
    sendEventMock.mockRejectedValue(new Error('network down'))

    await expect(emitLifecycleEvent(baseParams)).resolves.toBe(false)
  })

  it('swallows a Resend error response', async () => {
    sendEventMock.mockResolvedValue({ data: null, error: { message: 'unknown event' } })

    await expect(emitLifecycleEvent(baseParams)).resolves.toBe(false)
  })
})
