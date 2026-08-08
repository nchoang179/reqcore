import { randomBytes } from 'node:crypto'

/**
 * Nonce-based Content Security Policy middleware.
 *
 * Generates a cryptographically unique nonce per request and injects it into
 * the Content-Security-Policy header, replacing the build-time 'unsafe-inline'
 * directive for script-src.
 *
 * The nonce is stored in `event.context.nonce` so Nuxt's SSR renderer and
 * any `useHead()` calls can attach it to inline scripts without relying on
 * 'unsafe-inline' (which would negate XSS protection).
 *
 * Skipped for:
 *   - /api/*     — JSON endpoints; CSP does not apply to non-HTML responses
 *   - /_nuxt/*   — Nuxt build assets (JS/CSS bundles); external files don't need a nonce
 *   - /ingest/*  — PostHog reverse proxy; pass-through endpoint
 *   - Static file extensions — images, fonts, manifests, etc.
 */
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  if (
    path.startsWith('/api/') ||
    path.startsWith('/_nuxt/') ||
    path.startsWith('/ingest/') ||
    /\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|eot|webp|avif|gif|json|xml|txt|map)$/i.test(path)
  ) {
    return
  }

  const nonce = randomBytes(16).toString('base64url')
  event.context.nonce = nonce

  // Google Ads conversion tracking needs gtag.js plus the endpoints it pings.
  // Only widened when NUXT_PUBLIC_GOOGLE_ADS_ID is set (Reqcore Cloud), so a
  // self-hosted deployment keeps the stricter policy.
  const adsEnabled = !!process.env.NUXT_PUBLIC_GOOGLE_ADS_ID
  const adsScriptSrc = adsEnabled
    ? ' https://www.googletagmanager.com https://www.googleadservices.com'
    : ''
  const adsConnectSrc = adsEnabled
    ? ' https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com'
    : ''
  // gtag drops conversion iframes on the doubleclick domains; without this
  // they fall back to default-src 'self' and are blocked.
  const adsFrameSrc = adsEnabled
    ? "frame-src 'self' https://td.doubleclick.net https://googleads.g.doubleclick.net"
    : "frame-src 'self'"

  setResponseHeader(
    event,
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'${adsScriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      `connect-src 'self' https://eu.i.posthog.com https://eu.posthog.com${adsConnectSrc}`,
      adsFrameSrc,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  )
})
