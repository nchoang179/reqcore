import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, expect as baseExpect, type BrowserContext, type Page } from '@playwright/test'
import postgres from 'postgres'

/**
 * Shared test fixtures for Reqcore E2E tests.
 *
 * Provides a unique test account per worker so parallel runs
 * won't clash (currently single-worker, but future-proofed).
 */

export interface TestAccount {
  name: string
  email: string
  password: string
  orgName: string
  orgSlug: string
}

function generateTestAccount(workerId: number): TestAccount {
  const id = `${Date.now()}-${workerId}`
  return {
    name: `E2E Tester ${id}`,
    email: `e2e-${id}@test.local`,
    password: process.env.E2E_TEST_PASSWORD || 'TestPassword123!',
    orgName: `E2E Org ${id}`,
    orgSlug: `e2e-org-${id}`,
  }
}

type Fixtures = {
  testAccount: TestAccount
  authenticatedPage: Page
}

export function e2eDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const envFile = readFileSync(join(process.cwd(), '.env'), 'utf8')
  const line = envFile
    .split(/\r?\n/)
    .find(entry => entry.trim().startsWith('DATABASE_URL='))
  const value = line?.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2')

  if (!value) throw new Error('DATABASE_URL is required for authenticated E2E fixtures')
  return value
}

async function verifyTestAccountEmail(email: string): Promise<void> {
  const sql = postgres(e2eDatabaseUrl(), { max: 1 })
  try {
    const updated = await sql`
      update "user"
      set email_verified = true, updated_at = now()
      where email = ${email}
      returning id
    `
    if (updated.length !== 1) throw new Error(`Could not verify E2E account ${email}`)
  }
  finally {
    await sql.end()
  }
}

export async function declineAnalyticsConsent(context: BrowserContext) {
  await context.addCookies([{
    name: 'reqcore-consent',
    value: 'denied',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3333',
  }])
}

/**
 * A place the bundled GeoNames dataset resolves to exactly one result, so the
 * picker's option list is never ambiguous.
 */
const JOB_LOCATION_QUERY = 'Oslo'
export const JOB_LOCATION = 'Oslo, Norway'

/** The structured equivalent, for tests that create jobs through the API. */
export const JOB_LOCATION_PARTS = { locationCity: 'Oslo', locationCountry: 'NO' }

/**
 * Picks a real place in the job form's location combobox.
 *
 * Typing commits nothing — only choosing a result gives the role the ISO country
 * code publishing requires, so a test has to select the same way a recruiter
 * does.
 */
export async function selectJobLocation(page: Page) {
  const input = page.getByRole('combobox', { name: 'Location' })
  await input.fill(JOB_LOCATION_QUERY)
  await page.getByRole('option', { name: JOB_LOCATION, exact: true }).click()
  await baseExpect(input).toHaveValue(JOB_LOCATION)
}

/**
 * Pads a test's one-line summary past `MIN_DESCRIPTION_CHARS`.
 *
 * Job boards reject thin listings, so neither the wizard nor the publish guard
 * will let a role go live under that floor — every spec that publishes needs a
 * description of real length, not a sentence.
 */
export function publishableDescription(lead: string) {
  return `${lead} The role owns its area end to end: you will ship changes every week, `
    + 'review work from the rest of the team, and help set the standards we hold each other to. '
    + 'We care more about how you think than about the exact tools on your CV.'
}

/**
 * The apply URL of the role that was just published.
 *
 * The readonly field on the publish screen holds the public job page — that is
 * the link a recruiter shares — so the apply URL is derived from it rather than
 * read from a second field that no longer exists.
 */
export async function getPublishedApplicationLink(page: Page) {
  const jobUrlPattern = String.raw`^https?://[^/]+/jobs/[^/?#]+$`

  await page.waitForFunction((pattern) => {
    const jobUrl = new RegExp(pattern)
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[readonly]'))
      .some(input => jobUrl.test(input.value))
  }, jobUrlPattern, { timeout: 10_000 })

  const jobLink = await page.locator('input[readonly]').evaluateAll((inputs, pattern) => {
    const jobUrl = new RegExp(pattern)
    return inputs
      .map(input => (input as HTMLInputElement).value)
      .find(value => jobUrl.test(value))
  }, jobUrlPattern)

  if (!jobLink) throw new Error('Published job link input was not found')
  return `${jobLink}/apply`
}

export const test = base.extend<Fixtures>({
  testAccount: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const account = generateTestAccount(workerInfo.workerIndex)
      await use(account)
    },
    { scope: 'test' },
  ],

  authenticatedPage: async ({ page, testAccount }, use) => {
    await declineAnalyticsConsent(page.context())

    // Sign up
    await page.goto('/auth/sign-up')
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Name').fill(testAccount.name)
    await page.getByLabel('Email').fill(testAccount.email)
    await page.getByLabel('Password', { exact: true }).fill(testAccount.password)
    await page.getByLabel('Confirm password').fill(testAccount.password)

    // Click sign-up and wait for the auth API response before expecting navigation
    await Promise.all([
      page.waitForResponse(
        resp => resp.url().includes('/api/auth/sign-up') && resp.status() === 200,
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: 'Sign up' }).click(),
    ])

    // Outbound critical flows require a verified owner. The test environment
    // has no mailbox from which to consume Better Auth's verification link.
    await verifyTestAccountEmail(testAccount.email)

    // After sign-up the app navigates to /onboarding/create-org, but the
    // auth middleware may not yet recognise the freshly-set session cookie
    // and redirect to /auth/sign-in instead.  Handle both outcomes.
    await page.waitForURL(
      url => url.pathname.includes('/onboarding/') || url.pathname.includes('/auth/sign-in'),
      { waitUntil: 'commit', timeout: 30_000 },
    )

    // If we landed on sign-in, explicitly sign in with the new credentials
    if (page.url().includes('/auth/sign-in')) {
      await page.waitForLoadState('networkidle')
      await page.getByLabel('Email').fill(testAccount.email)
      await page.getByLabel('Password').fill(testAccount.password)

      await Promise.all([
        page.waitForResponse(
          resp => resp.url().includes('/api/auth/sign-in') && resp.status() === 200,
          { timeout: 30_000 },
        ),
        page.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ])

      // The API response confirms the session cookie is set. Navigate directly
      // instead of depending on the sign-in page's client redirect timing.
      await page.goto('/onboarding/create-org')
    }

    // Wait for the org-creation form to render (loading spinner may show first)
    await page.getByLabel('Organization name').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByLabel('Organization name').fill(testAccount.orgName)
    await page.getByRole('button', { name: 'Create organization' }).click()

    // Creating the org performs a hard navigation. Under load, the freshly
    // updated session can race that navigation and land on sign-in instead.
    // Brand-new orgs are redirected through /onboarding/welcome (survey) first.
    await page.waitForURL(
      url => url.pathname.includes('/dashboard') || url.pathname.includes('/auth/sign-in') || url.pathname.includes('/onboarding/welcome'),
      { waitUntil: 'commit', timeout: 30_000 },
    )

    // Skip the onboarding survey — navigate directly to the dashboard.
    if (page.url().includes('/onboarding/welcome')) {
      await page.goto('/dashboard')
    }

    if (page.url().includes('/auth/sign-in')) {
      await page.getByLabel('Email').fill(testAccount.email)
      await page.getByLabel('Password').fill(testAccount.password)
      await Promise.all([
        page.waitForResponse(
          resp => resp.url().includes('/api/auth/sign-in') && resp.status() === 200,
          { timeout: 30_000 },
        ),
        page.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ])
      await page.goto('/dashboard')
    }

    // Do not hand the page to the test while dashboard auth middleware is
    // still settling; otherwise the test's first navigation can race a
    // delayed redirect back to sign-in.
    await page.waitForLoadState('networkidle')
    if (page.url().includes('/auth/sign-in')) {
      await page.getByLabel('Email').fill(testAccount.email)
      await page.getByLabel('Password').fill(testAccount.password)
      await Promise.all([
        page.waitForResponse(
          resp => resp.url().includes('/api/auth/sign-in') && resp.status() === 200,
          { timeout: 30_000 },
        ),
        page.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ])
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')
    }

    await use(page)
  },
})

export { expect } from '@playwright/test'
