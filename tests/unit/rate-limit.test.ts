import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { H3Event, EventHandlerRequest } from 'h3'

// ── Stub Nitro auto-imports BEFORE importing the module under test ───────────
// rateLimit.ts reads these globals lazily inside the returned closure, so
// stubbing them at top level (before the dynamic import) is enough.

interface FakeEvent {
  __ip: string
  __headers: Record<string, string>
  __resHeaders: Record<string, string>
}

vi.stubGlobal('getRequestIP', (event: FakeEvent) => event.__ip)
vi.stubGlobal('getRequestURL', () => new URL('http://localhost/api/public/jobs/x/apply'))
vi.stubGlobal('getHeader', (event: FakeEvent, name: string) => event.__headers[name.toLowerCase()])
vi.stubGlobal('setResponseHeaders', (event: FakeEvent, headers: Record<string, string | number>) => {
  for (const [k, v] of Object.entries(headers)) event.__resHeaders[k] = String(v)
})
vi.stubGlobal('setResponseHeader', (event: FakeEvent, name: string, value: string | number) => {
  event.__resHeaders[name] = String(value)
})
vi.stubGlobal('createError', (opts: { statusCode: number, statusMessage?: string }) => {
  const err = new Error(opts.statusMessage ?? 'error') as Error & { statusCode: number, statusMessage?: string }
  err.statusCode = opts.statusCode
  err.statusMessage = opts.statusMessage
  return err
})

const { createRateLimiter, getClientIp } = await import('../../server/utils/rateLimit')

function makeEvent(ip = '1.2.3.4', headers: Record<string, string> = {}): FakeEvent & H3Event<EventHandlerRequest> {
  return { __ip: ip, __headers: headers, __resHeaders: {} } as unknown as FakeEvent & H3Event<EventHandlerRequest>
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.TRUSTED_PROXY
  delete process.env.TRUSTED_PROXY_IP
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV
})

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV
})

describe('createRateLimiter', () => {
  it('admits requests up to maxRequests and blocks the next one', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 })
    const event = makeEvent()

    await limiter(event)
    await limiter(event)
    await limiter(event)

    await expect(limiter(event)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('isolates buckets per IP — one user blocked does not block another', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 })
    const a = makeEvent('10.0.0.1')
    const b = makeEvent('10.0.0.2')

    await limiter(a)
    await limiter(a)
    await expect(limiter(a)).rejects.toMatchObject({ statusCode: 429 })

    // Different IP — fresh bucket, must succeed.
    await expect(limiter(b)).resolves.toBeUndefined()
    await expect(limiter(b)).resolves.toBeUndefined()
  })

  it('isolates buckets per limiter instance — separate routes never share counters', async () => {
    // Each createRateLimiter() call builds its own Map, so two limiters with
    // identical window/max still have independent state.
    const a = createRateLimiter({ windowMs: 60_000, maxRequests: 1 })
    const b = createRateLimiter({ windowMs: 60_000, maxRequests: 1 })
    const ip = makeEvent('5.5.5.5')

    await a(ip)
    await expect(a(ip)).rejects.toMatchObject({ statusCode: 429 })

    // Same IP, same params, different limiter — must still be admitted.
    await expect(b(ip)).resolves.toBeUndefined()
  })

  it('emits standard rate-limit headers on every response', async () => {
    // Note: `remaining` is computed BEFORE recording the current request, so
    // the first call sees `maxRequests` remaining (the response describes the
    // pre-request budget, not the post-request budget). Subsequent calls see
    // the slot consumed by the previous request.
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 })
    const event1 = makeEvent('1.1.1.1')
    const event2 = makeEvent('1.1.1.1')

    await limiter(event1)
    expect(event1.__resHeaders['X-RateLimit-Limit']).toBe('5')
    expect(event1.__resHeaders['X-RateLimit-Remaining']).toBe('5')
    expect(Number(event1.__resHeaders['X-RateLimit-Reset'])).toBeGreaterThan(0)

    await limiter(event2)
    expect(event2.__resHeaders['X-RateLimit-Remaining']).toBe('4')
  })

  it('sets Retry-After when the limit is exceeded', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 })
    const event = makeEvent()
    await limiter(event)

    await expect(limiter(event)).rejects.toMatchObject({ statusCode: 429 })
    expect(event.__resHeaders['Retry-After']).toBeDefined()
    expect(Number(event.__resHeaders['Retry-After'])).toBeGreaterThan(0)
  })

  it('uses the custom error message when provided', async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      message: 'Slow down, partner.',
    })
    const event = makeEvent()
    await limiter(event)

    await expect(limiter(event)).rejects.toMatchObject({
      statusCode: 429,
      statusMessage: 'Slow down, partner.',
    })
  })

  it('admits a new request once the oldest timestamp falls out of the window', async () => {
    // Advance time so the original timestamps age past windowMs without us
    // having to actually wait. Uses Vitest fake timers around Date.now.
    const limiter = createRateLimiter({ windowMs: 1_000, maxRequests: 2 })
    const event = makeEvent('7.7.7.7')

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      await limiter(event)
      await limiter(event)
      await expect(limiter(event)).rejects.toMatchObject({ statusCode: 429 })

      // Slide forward past the window.
      vi.setSystemTime(new Date('2026-01-01T00:00:02Z'))
      await expect(limiter(event)).resolves.toBeUndefined()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('respects X-Forwarded-For only when TRUSTED_PROXY_IP matches the socket peer', async () => {
    process.env.TRUSTED_PROXY_IP = '127.0.0.1'
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 })

    // Request comes through the trusted proxy; XFF carries the real client IP.
    const trustedHop = makeEvent('127.0.0.1', { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    await limiter(trustedHop)

    // Same XFF but the socket peer is somebody else — header must be ignored.
    const spoofer = makeEvent('198.51.100.1', { 'x-forwarded-for': '203.0.113.7' })
    await expect(limiter(spoofer)).resolves.toBeUndefined()

    // Re-using the trusted hop with the same forwarded IP should now hit the limit.
    const trustedAgain = makeEvent('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' })
    await expect(limiter(trustedAgain)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('does not share one bucket across clients behind a proxy in production', async () => {
    // The regression this guards: with header trust misconfigured, every request
    // keys on the platform edge socket address, so the Nth applicant across all
    // orgs gets a 429 for somebody else's traffic.
    process.env.NODE_ENV = 'production'
    const limiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 5 })

    const edgeIp = '100.64.0.3'
    for (let i = 0; i < 5; i++) {
      await limiter(makeEvent(edgeIp, { 'cf-connecting-ip': `203.0.113.${i}` }))
    }

    // Sixth applicant, same proxy hop, different client — must still be admitted.
    await expect(
      limiter(makeEvent(edgeIp, { 'cf-connecting-ip': '203.0.113.99' })),
    ).resolves.toBeUndefined()

    // ...while a client that really did send 5 requests is blocked.
    const repeat = () => limiter(makeEvent(edgeIp, { 'cf-connecting-ip': '198.51.100.4' }))
    for (let i = 0; i < 5; i++) await repeat()
    await expect(repeat()).rejects.toMatchObject({ statusCode: 429 })
  })
})

describe('getClientIp', () => {
  it('defaults to CF-Connecting-IP in production', () => {
    process.env.NODE_ENV = 'production'
    expect(getClientIp(makeEvent('100.64.0.3', {
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '203.0.113.7, 172.16.0.1',
    }))).toBe('203.0.113.7')
  })

  it('falls back to the leftmost X-Forwarded-For entry in cloudflare mode', () => {
    process.env.TRUSTED_PROXY = 'cloudflare'
    expect(getClientIp(makeEvent('100.64.0.3', {
      'x-forwarded-for': '203.0.113.7, 172.16.0.1',
    }))).toBe('203.0.113.7')
  })

  it('ignores forwarding headers when TRUSTED_PROXY=none', () => {
    process.env.TRUSTED_PROXY = 'none'
    expect(getClientIp(makeEvent('100.64.0.3', {
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '203.0.113.7',
    }))).toBe('100.64.0.3')
  })

  it('counts X-Forwarded-For entries from the right with a hop count', () => {
    process.env.TRUSTED_PROXY = '2'
    // Client prepended a fake entry; two hops are trusted, so the third-from-left
    // (= second-from-right) entry is the real client.
    expect(getClientIp(makeEvent('10.0.0.1', {
      'x-forwarded-for': '1.1.1.1, 203.0.113.7, 172.16.0.1',
    }))).toBe('203.0.113.7')
  })

  it('falls back to the socket address when the trusted header is missing or junk', () => {
    process.env.TRUSTED_PROXY = 'cloudflare'
    expect(getClientIp(makeEvent('100.64.0.3', { 'cf-connecting-ip': 'not-an-ip' }))).toBe('100.64.0.3')
    expect(getClientIp(makeEvent('100.64.0.3'))).toBe('100.64.0.3')
  })

  it('normalizes ports and IPv4-mapped IPv6 so one client gets one bucket', () => {
    process.env.TRUSTED_PROXY = 'cloudflare'
    expect(getClientIp(makeEvent('10.0.0.1', { 'cf-connecting-ip': '203.0.113.7:54321' }))).toBe('203.0.113.7')
    expect(getClientIp(makeEvent('10.0.0.1', { 'cf-connecting-ip': '::ffff:203.0.113.7' }))).toBe('203.0.113.7')
    expect(getClientIp(makeEvent('10.0.0.1', { 'cf-connecting-ip': '[2001:db8::1]:443' }))).toBe('2001:db8::1')
  })

  it('ignores an invalid TRUSTED_PROXY value instead of trusting headers blindly', () => {
    process.env.TRUSTED_PROXY = 'yes-please'
    expect(getClientIp(makeEvent('100.64.0.3', { 'cf-connecting-ip': '203.0.113.7' }))).toBe('100.64.0.3')
  })
})
