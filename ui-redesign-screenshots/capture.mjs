/**
 * One-off: capture every Reqcore screen for UI redesign reference.
 * Usage: node ui-redesign-screenshots/capture.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = __dirname
const BASE = process.env.BASE_URL || 'http://localhost:3000'

const JOB_ID = '104b3186-23da-4c44-8519-0ceaba280b38'
const JOB_SLUG = 'product-designer-104b3186'
const CANDIDATE_ID = 'eb75969d-9612-4ea7-bc66-944690e904ec'
const APPLICATION_ID = '34ccce95-fba8-459d-8798-5ff39aac9f43'
const INTERVIEW_ID = '9d73cc92-5e0c-4c27-b4b2-231d02cb26ee'
const AI_CONFIG_ID = '5268f1cb-b396-46af-b056-eb28cdbc36c9'
const TRACKING_ID = '373a97ed-0d03-4bf5-ba20-1fb5ef3d90c9'
const ORG_SLUG = 'reqcore-demo'

const PUBLIC_ROUTES = [
  ['00-home', '/'],
  ['01-pricing', '/pricing'],
  ['02-jobs-board', '/jobs'],
  ['03-job-detail', `/jobs/${JOB_SLUG}`],
  ['04-job-apply', `/jobs/${JOB_SLUG}/apply`],
  ['05-job-confirmation', `/jobs/${JOB_SLUG}/confirmation`],
  ['06-career-page', `/career/${ORG_SLUG}`],
  ['07-auth-sign-in', '/auth/sign-in'],
  ['08-auth-sign-up', '/auth/sign-up'],
  ['09-auth-forgot-password', '/auth/forgot-password'],
  ['10-auth-reset-password', '/auth/reset-password'],
  ['11-auth-fresh-signup', '/auth/fresh-signup'],
  ['12-onboarding-welcome', '/onboarding/welcome'],
  ['13-onboarding-create-org', '/onboarding/create-org'],
  ['14-interview-respond', '/interview/respond'],
]

const AUTH_ROUTES = [
  ['20-dashboard', '/dashboard'],
  ['21-dashboard-jobs', '/dashboard/jobs'],
  ['22-dashboard-jobs-new', '/dashboard/jobs/new'],
  ['23-dashboard-jobs-preview', '/dashboard/jobs/preview'],
  ['24-dashboard-job-detail', `/dashboard/jobs/${JOB_ID}`],
  ['25-dashboard-job-settings', `/dashboard/jobs/${JOB_ID}/settings`],
  ['26-dashboard-job-application-form', `/dashboard/jobs/${JOB_ID}/application-form`],
  ['27-dashboard-job-candidates', `/dashboard/jobs/${JOB_ID}/candidates`],
  ['28-dashboard-job-ai-analysis', `/dashboard/jobs/${JOB_ID}/ai-analysis`],
  ['29-dashboard-job-promote', `/dashboard/jobs/${JOB_ID}/promote`],
  ['30-dashboard-job-rules', `/dashboard/jobs/${JOB_ID}/rules`],
  ['31-dashboard-job-source-tracking', `/dashboard/jobs/${JOB_ID}/source-tracking`],
  ['32-dashboard-job-import', `/dashboard/jobs/${JOB_ID}/import`],
  ['33-dashboard-candidates', '/dashboard/candidates'],
  ['34-dashboard-candidates-new', '/dashboard/candidates/new'],
  ['35-dashboard-candidates-import', '/dashboard/candidates/import'],
  ['36-dashboard-candidate-detail', `/dashboard/candidates/${CANDIDATE_ID}`],
  ['37-dashboard-applications', '/dashboard/applications'],
  ['38-dashboard-application-detail', `/dashboard/applications/${APPLICATION_ID}`],
  ['39-dashboard-interviews', '/dashboard/interviews'],
  ['40-dashboard-interview-detail', `/dashboard/interviews/${INTERVIEW_ID}`],
  ['41-dashboard-interview-templates', '/dashboard/interviews/templates'],
  ['42-dashboard-interview-templates-new', '/dashboard/interviews/templates/new'],
  ['43-dashboard-source-tracking', '/dashboard/source-tracking'],
  ['44-dashboard-source-tracking-detail', `/dashboard/source-tracking/${TRACKING_ID}`],
  ['45-dashboard-ai-analysis', '/dashboard/ai-analysis'],
  ['46-dashboard-chatbot', '/dashboard/chatbot'],
  ['47-dashboard-timeline', '/dashboard/timeline'],
  ['48-dashboard-updates', '/dashboard/updates'],
  ['49-dashboard-settings', '/dashboard/settings'],
  ['50-dashboard-settings-account', '/dashboard/settings/account'],
  ['51-dashboard-settings-members', '/dashboard/settings/members'],
  ['52-dashboard-settings-notifications', '/dashboard/settings/notifications'],
  ['53-dashboard-settings-billing', '/dashboard/settings/billing'],
  ['54-dashboard-settings-integrations', '/dashboard/settings/integrations'],
  ['55-dashboard-settings-localization', '/dashboard/settings/localization'],
  ['56-dashboard-settings-retention', '/dashboard/settings/retention'],
  ['57-dashboard-settings-sso', '/dashboard/settings/sso'],
  ['58-dashboard-settings-career-page', '/dashboard/settings/career-page'],
  ['59-dashboard-settings-ai', '/dashboard/settings/ai'],
  ['60-dashboard-settings-ai-new', '/dashboard/settings/ai/new'],
  ['61-dashboard-settings-ai-detail', `/dashboard/settings/ai/${AI_CONFIG_ID}`],
]

function slugify(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-')
}

async function shot(page, name) {
  const file = path.join(OUT, `${slugify(name)}.png`)
  await page.waitForTimeout(800)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

async function captureMany(page, routes, results) {
  for (const [name, route] of routes) {
    const url = `${BASE}${route}`
    process.stdout.write(`→ ${name} ${route} ... `)
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 })
      // settle animations / client fetches
      await page.waitForTimeout(1200)
      const file = await shot(page, name)
      const status = res?.status() ?? 0
      results.push({ name, route, status, file, ok: true })
      console.log(`ok (${status})`)
    } catch (err) {
      results.push({ name, route, ok: false, error: String(err) })
      console.log(`FAIL: ${err.message || err}`)
      try {
        await shot(page, `${name}-error`)
      } catch {
        /* ignore */
      }
    }
  }
}

async function login(page) {
  await page.goto(`${BASE}/auth/sign-in`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill('demo@reqcore.com')
  await page.locator('input[type="password"]').fill('demo1234')
  await Promise.all([
    page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 }),
    page.locator('button[type="submit"]').click(),
  ])
  await page.waitForTimeout(1000)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  const results = []

  console.log(`Base: ${BASE}`)
  console.log(`Out:  ${OUT}`)
  console.log('\n=== Public / auth screens ===')
  await captureMany(page, PUBLIC_ROUTES, results)

  console.log('\n=== Login ===')
  await login(page)
  console.log('Logged in as demo@reqcore.com')

  console.log('\n=== Authenticated screens ===')
  await captureMany(page, AUTH_ROUTES, results)

  await browser.close()

  const manifest = {
    baseUrl: BASE,
    capturedAt: new Date().toISOString(),
    viewport: { width: 1440, height: 900 },
    credentials: 'demo@reqcore.com / demo1234',
    results,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  }
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nDone: ${manifest.ok} ok, ${manifest.failed} failed → ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
