/**
 * Shared helpers for detecting the demo organization across the server.
 *
 * Used by:
 * - `server/middleware/demo-guard.ts` to block writes on the demo org
 * - `server/utils/trackEvent.ts` to tag PostHog events with `is_demo: true`
 *   so the demo session can be filtered out of funnels and dashboards.
 *
 * Demo-org IDs are cached after the first DB lookup, but only for
 * DEMO_ORG_ID_TTL_MS. Re-seeding deletes the demo org and recreates it under
 * the same slug with a fresh id, so a permanent cache would leave a long-lived
 * server pinned to a deleted org — the demo account would then see an empty
 * organization list and be pushed into onboarding. We never cache a negative
 * result either, so orgs created after server boot are picked up on the next
 * request.
 */
import { eq } from 'drizzle-orm'
import * as schema from '../database/schema'
import { isRailwayPreviewEnvironment } from './env'

interface CachedDemoOrgId {
  id: string
  expiresAt: number
}

const DEMO_ORG_ID_TTL_MS = 60_000
const demoOrgIdBySlug = new Map<string, CachedDemoOrgId>()
const DEFAULT_DEMO_ACCOUNT_EMAIL = 'demo@reqcore.com'
const DEFAULT_PREVIEW_DEMO_ORG_SLUG = 'reqcore-demo'

export interface DemoSlugsResult {
  slugs: string[]
  /** True only when DEMO_ORG_SLUG was explicitly set by the operator. */
  isExplicitlyConfigured: boolean
}

export function getConfiguredDemoSlugs(): DemoSlugsResult {
  const slugs = new Set<string>()
  let isExplicitlyConfigured = false

  if (env.DEMO_ORG_SLUG) {
    slugs.add(env.DEMO_ORG_SLUG)
    isExplicitlyConfigured = true
  }

  if (isRailwayPreviewEnvironment(env.RAILWAY_ENVIRONMENT_NAME)) {
    slugs.add(DEFAULT_PREVIEW_DEMO_ORG_SLUG)
  }

  return { slugs: [...slugs], isExplicitlyConfigured }
}

export function getConfiguredDemoEmail(): string {
  const email = process.env.LIVE_DEMO_EMAIL || process.env.DEMO_EMAIL || DEFAULT_DEMO_ACCOUNT_EMAIL

  // Guard against stale applirank.com domain from old env vars.
  if (email.endsWith('@applirank.com')) {
    return DEFAULT_DEMO_ACCOUNT_EMAIL
  }

  return email.toLowerCase()
}

export function isDemoAccountEmail(email: string | null | undefined): boolean {
  return email?.toLowerCase() === getConfiguredDemoEmail()
}

/**
 * Demo-account isolation is intentionally a little stricter than demo-org
 * write protection: the public demo identity should only ever operate in
 * the seeded demo workspace, even if it has accidentally accumulated other
 * memberships over time.
 */
export function getDemoAccountSlugs(): string[] {
  const slugs = new Set(getConfiguredDemoSlugs().slugs)
  slugs.add(env.DEMO_ORG_SLUG || DEFAULT_PREVIEW_DEMO_ORG_SLUG)
  return [...slugs]
}

export async function getDemoAccountOrgIds(): Promise<Set<string>> {
  return getDemoOrgIds(getDemoAccountSlugs())
}

export async function assertDemoAccountCanUseOrg(
  email: string | null | undefined,
  orgId: string | null | undefined,
): Promise<void> {
  if (!isDemoAccountEmail(email) || !orgId) return

  const demoOrgIds = await getDemoAccountOrgIds()
  if (demoOrgIds.has(orgId)) return

  throw createError({
    statusCode: 403,
    statusMessage: 'The demo account can only access the demo workspace.',
  })
}

/**
 * Resolve the configured demo slugs to organisation IDs.
 *
 * Falls back to a cached id when possible to avoid an extra DB hit on every
 * authenticated request. Entries expire after DEMO_ORG_ID_TTL_MS so a reseed
 * (which recreates the org with a new id under the same slug) heals itself
 * without a redeploy.
 */
export async function getDemoOrgIds(slugs?: string[]): Promise<Set<string>> {
  const slugList = slugs ?? getConfiguredDemoSlugs().slugs
  const ids = new Set<string>()
  const now = Date.now()

  for (const slug of slugList) {
    const cached = demoOrgIdBySlug.get(slug)
    if (cached && cached.expiresAt > now) {
      ids.add(cached.id)
      continue
    }

    const [org] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, slug))
      .limit(1)

    if (!org?.id) {
      // The org is gone (mid-reseed). Drop the stale entry rather than
      // serving a deleted id until the TTL runs out.
      demoOrgIdBySlug.delete(slug)
      continue
    }

    demoOrgIdBySlug.set(slug, { id: org.id, expiresAt: now + DEMO_ORG_ID_TTL_MS })
    ids.add(org.id)
  }

  return ids
}

/** Test seam: drops every cached slug → id mapping. */
export function clearDemoOrgIdCache(): void {
  demoOrgIdBySlug.clear()
}

/**
 * True when the given organisation id matches a configured demo org.
 *
 * Returns false (not null) when no demo org is configured or the org
 * cannot be resolved — callers can safely treat the result as a boolean
 * funnel filter.
 */
export async function isDemoOrgId(orgId: string | null | undefined): Promise<boolean> {
  if (!orgId) return false
  const ids = await getDemoOrgIds()
  return ids.has(orgId)
}
