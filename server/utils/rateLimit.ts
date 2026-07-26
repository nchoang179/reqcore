import type { H3Event } from 'h3'

// ─────────────────────────────────────────────
// In-memory sliding window rate limiter
// ─────────────────────────────────────────────

// Warn loudly at startup when the process appears to be running as one of
// several replicas. Each replica holds its own in-memory state, so the
// effective limit seen by any single client is maxRequests × replicaCount.
// Under horizontal scaling, terminate rate limiting at the edge instead:
// Cloudflare WAF, Caddy `rate_limit`, nginx `limit_req`, or a Redis-backed
// limiter.
const _replicaCount = Number(process.env.RAILWAY_REPLICA_COUNT ?? 0)
if (_replicaCount > 1) {
  console.warn(
    `[rateLimit] WARNING: RAILWAY_REPLICA_COUNT=${_replicaCount}. `
    + 'The in-memory rate limiter is NOT shared across replicas — effective limits are '
    + `${_replicaCount}× higher than configured. Move rate limiting to the edge.`,
  )
}

/**
 * Configuration for a rate limiter instance.
 *
 * @param windowMs - Time window in milliseconds
 * @param maxRequests - Maximum number of requests allowed within the window
 * @param message - Error message returned when the limit is exceeded
 */
interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  message?: string
}

interface RateLimitEntry {
  timestamps: number[]
}

/**
 * Create a reusable rate limiter scoped by client IP.
 *
 * Uses a sliding window algorithm — each request records a timestamp,
 * and only timestamps within the current window are counted.
 *
 * State is per-process and per-limiter: each call to createRateLimiter()
 * builds its own Map, so two limiters never share buckets even when their
 * window/max are identical.
 *
 * Reqcore is designed as a single-instance deployment (one Railway service,
 * or one Docker Compose container for self-hosters). If it ever runs
 * multiple replicas behind a load balancer, terminate rate limiting at the
 * edge instead — Cloudflare WAF, Caddy `rate_limit`, or nginx `limit_req`.
 *
 * @example
 * ```ts
 * const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 })
 *
 * export default defineEventHandler(async (event) => {
 *   await limiter(event)
 *   // ... handler logic
 * })
 * ```
 */
export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests, message = 'Too many requests, please try again later' } = config
  const store = new Map<string, RateLimitEntry>()

  // Periodically prune stale entries to prevent unbounded memory growth
  const PRUNE_INTERVAL = Math.max(windowMs * 2, 60_000)
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      // Remove entries with no timestamps within the window
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)
      if (entry.timestamps.length === 0) {
        store.delete(key)
      }
    }
  }, PRUNE_INTERVAL).unref() // .unref() prevents the timer from keeping the process alive

  /**
   * Check and enforce the rate limit for the current request.
   * Throws a 429 error if the limit is exceeded.
   * Sets standard rate limit headers on every response.
   */
  return async function rateLimit(event: H3Event): Promise<void> {
    const { key: ip, source } = resolveClientKey(event)
    const now = Date.now()

    let entry = store.get(ip)
    if (!entry) {
      entry = { timestamps: [] }
      store.set(ip, entry)
    }

    // Remove timestamps outside the current window
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)

    // Set rate limit headers (draft RFC 7.2 / common convention)
    const remaining = Math.max(0, maxRequests - entry.timestamps.length)
    const resetSeconds = entry.timestamps.length > 0
      ? Math.ceil((entry.timestamps[0]! + windowMs - now) / 1000)
      : Math.ceil(windowMs / 1000)

    setResponseHeaders(event, {
      'X-RateLimit-Limit': String(maxRequests),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(resetSeconds),
    })

    if (entry.timestamps.length >= maxRequests) {
      setResponseHeader(event, 'Retry-After', resetSeconds)
      // Log the resolved bucket key: a limit that trips for unrelated clients is
      // almost always an IP-resolution problem (see resolveClientKey), and that
      // is invisible without knowing which key was counted.
      logWarn('rate_limit.exceeded', {
        client_key: ip,
        client_key_source: source,
        path: getRequestURL(event).pathname,
        limit: maxRequests,
        window_ms: windowMs,
      })
      throw createError({
        statusCode: 429,
        statusMessage: message,
      })
    }

    // Record this request
    entry.timestamps.push(now)
  }
}

// ─────────────────────────────────────────────
// Client IP resolution
// ─────────────────────────────────────────────

/**
 * How far forwarding headers are trusted when resolving the client IP.
 *
 * - `cloudflare` — read `CF-Connecting-IP` (falling back to the leftmost
 *   `X-Forwarded-For` entry). Cloudflare overwrites both on ingress, so a
 *   client behind it cannot forge them.
 * - `hops` — N trusted proxies append to `X-Forwarded-For`; the client is the
 *   Nth entry counted from the right.
 * - `trusted-peer` — legacy `TRUSTED_PROXY_IP` mode: read `X-Forwarded-For`
 *   only when the socket peer equals that exact IP.
 * - `socket` — never trust headers; key on the socket remote address.
 */
type IpStrategy =
  | { kind: 'cloudflare' }
  | { kind: 'hops', hops: number }
  | { kind: 'trusted-peer', ip: string }
  | { kind: 'socket' }

export type ClientKeySource = 'cf-connecting-ip' | 'x-forwarded-for' | 'x-real-ip' | 'socket'

const MAX_TRUSTED_HOPS = 10

// Memoized on the raw env values so a config change (or a test) re-resolves,
// while the common case stays a string compare instead of a parse per request.
let strategyCache: { raw: string, strategy: IpStrategy } | undefined
let warnedSocketFallback = false

function resolveIpStrategy(): IpStrategy {
  // Read process.env directly rather than the parsed env schema: this runs from
  // global middleware, and one unrelated invalid variable must not turn every
  // API response into a generic 500 before its route can report the problem.
  const trustedProxy = process.env.TRUSTED_PROXY?.trim().toLowerCase() ?? ''
  const trustedPeer = process.env.TRUSTED_PROXY_IP?.trim() ?? ''
  const raw = `${trustedProxy}|${trustedPeer}|${process.env.NODE_ENV ?? ''}`
  if (strategyCache?.raw === raw) return strategyCache.strategy

  const strategy = parseIpStrategy(trustedProxy, trustedPeer)
  strategyCache = { raw, strategy }
  warnedSocketFallback = false
  logInfo('rate_limit.client_ip_strategy', { strategy: describeStrategy(strategy) })
  return strategy
}

function parseIpStrategy(trustedProxy: string, trustedPeer: string): IpStrategy {
  if (trustedProxy) {
    if (trustedProxy === 'none') return { kind: 'socket' }
    if (trustedProxy === 'cloudflare') return { kind: 'cloudflare' }

    const hops = Number(trustedProxy)
    if (Number.isInteger(hops) && hops >= 1 && hops <= MAX_TRUSTED_HOPS) {
      return { kind: 'hops', hops }
    }

    logWarn('rate_limit.trusted_proxy_invalid', {
      value: trustedProxy,
      hint: `Expected "cloudflare", "none", or a hop count 1-${MAX_TRUSTED_HOPS}`,
    })
  }

  if (trustedPeer) return { kind: 'trusted-peer', ip: trustedPeer }

  // Hosted reqcore serves every request through Cloudflare → Railway, so the
  // socket peer is the platform edge and is identical for all traffic. Keying on
  // it would put the entire internet in one bucket — the 6th applicant across
  // all orgs would get a 429. Default to the Cloudflare header in production;
  // deployments exposed directly to the internet must set TRUSTED_PROXY=none,
  // otherwise a client can pick its own bucket by sending CF-Connecting-IP.
  if (process.env.NODE_ENV === 'production') return { kind: 'cloudflare' }

  return { kind: 'socket' }
}

function describeStrategy(strategy: IpStrategy): string {
  return strategy.kind === 'hops' ? `hops:${strategy.hops}` : strategy.kind
}

/**
 * Resolve the rate-limit bucket key for a request, plus where it came from.
 *
 * The source is returned so callers can log it: a key resolved from `socket` in
 * production means every client behind the proxy shares one bucket, which looks
 * like a mysterious 429 rather than a configuration problem.
 */
export function resolveClientKey(event: H3Event): { key: string, source: ClientKeySource } {
  const strategy = resolveIpStrategy()
  const socketIp = normalizeIp(getRequestIP(event))

  switch (strategy.kind) {
    case 'cloudflare': {
      const cfIp = normalizeIp(getHeader(event, 'cf-connecting-ip'))
      if (cfIp) return { key: cfIp, source: 'cf-connecting-ip' }

      // Cloudflare also sets X-Forwarded-For to the client; later hops append to
      // it, so the client stays leftmost.
      const forwarded = leftmostForwardedIp(event)
      if (forwarded) return { key: forwarded, source: 'x-forwarded-for' }
      break
    }

    case 'hops': {
      const forwarded = forwardedIpFromRight(event, strategy.hops)
      if (forwarded) return { key: forwarded, source: 'x-forwarded-for' }
      break
    }

    case 'trusted-peer': {
      if (socketIp && socketIp === normalizeIp(strategy.ip)) {
        const forwarded = leftmostForwardedIp(event)
        if (forwarded) return { key: forwarded, source: 'x-forwarded-for' }

        const realIp = normalizeIp(getHeader(event, 'x-real-ip'))
        if (realIp) return { key: realIp, source: 'x-real-ip' }
      }
      break
    }

    case 'socket':
      break
  }

  if (!warnedSocketFallback && strategy.kind !== 'socket') {
    warnedSocketFallback = true
    logWarn('rate_limit.socket_ip_fallback', {
      strategy: describeStrategy(strategy),
      socket_ip: socketIp ?? null,
      hint: 'Forwarding headers were missing or malformed — all clients behind the proxy now share one bucket',
    })
  }

  return { key: socketIp ?? '0.0.0.0', source: 'socket' }
}

/** Extract the client IP from the request (see resolveClientKey). */
export function getClientIp(event: H3Event): string {
  return resolveClientKey(event).key
}

function forwardedEntries(event: H3Event): string[] {
  const header = getHeader(event, 'x-forwarded-for')
  if (!header) return []
  return header.split(',').map((part) => part.trim()).filter(Boolean)
}

function leftmostForwardedIp(event: H3Event): string | undefined {
  for (const entry of forwardedEntries(event)) {
    const ip = normalizeIp(entry)
    if (ip) return ip
  }
  return undefined
}

/**
 * Pick the client entry from X-Forwarded-For by trusted hop count.
 * With `hops` trusted proxies appending, the client is `hops` entries from the
 * right — everything to the right of it was written by infrastructure we trust,
 * everything to the left may have been sent by the client itself.
 */
function forwardedIpFromRight(event: H3Event, hops: number): string | undefined {
  const entries = forwardedEntries(event)
  if (entries.length === 0) return undefined

  const index = Math.max(0, entries.length - hops)
  return normalizeIp(entries[index])
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/

/**
 * Normalize an IP from a socket address or header into a stable bucket key,
 * rejecting anything that isn't an IP so untrusted header text can't create
 * unbounded keys in the limiter's Map.
 */
function normalizeIp(value: string | undefined | null): string | undefined {
  if (!value) return undefined

  let ip = value.trim()
  if (!ip) return undefined

  // "[2001:db8::1]:443" → "2001:db8::1"
  const bracketed = /^\[(.+?)\](?::\d+)?$/.exec(ip)
  if (bracketed) ip = bracketed[1]!
  // "203.0.113.7:54321" → "203.0.113.7"
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'))

  // IPv4-mapped IPv6 ("::ffff:203.0.113.7") — same client as the plain form, so
  // it must not get a second bucket.
  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7)

  if (IPV4_RE.test(ip)) {
    return ip.split('.').every((octet) => Number(octet) <= 255) ? ip : undefined
  }

  // IPv6: hex groups and colons only, optional zone id stripped.
  const zoneless = ip.split('%')[0]!
  if (zoneless.includes(':') && /^[0-9a-f:.]{2,45}$/i.test(zoneless)) return zoneless.toLowerCase()

  return undefined
}
