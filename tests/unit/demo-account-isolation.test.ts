import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('demo account organization isolation', () => {
  it('forces server API auth helpers to reject non-demo active organizations', () => {
    expect(read('server/utils/demoOrg.ts')).toMatch(/export async function assertDemoAccountCanUseOrg/)
    expect(read('server/utils/requireAuth.ts')).toMatch(/assertDemoAccountCanUseOrg\(session\.user\.email,\s*activeOrganizationId\)/)
    expect(read('server/utils/requirePermission.ts')).toMatch(/assertDemoAccountCanUseOrg\(session\.user\.email,\s*activeOrganizationId\)/)
  })

  it('guards Better Auth organization routes for the shared demo identity', () => {
    const authRoute = read('server/api/auth/[...all].ts')

    expect(authRoute).toMatch(/normalizeDemoActiveOrganization/)
    expect(authRoute).toMatch(/filterDemoOrganizationResponse/)
    expect(authRoute).toMatch(/authPath !== '\/organization\/set-active'/)
    expect(authRoute).toMatch(/authPath !== '\/organization\/list'/)
    expect(authRoute).toMatch(/The demo account cannot modify organization memberships or settings/)
  })

  it('blocks demo users from discovering or joining real organizations', () => {
    expect(read('server/api/org-search/index.get.ts')).toMatch(/isDemoAccountEmail\(session\.user\.email\)/)
    expect(read('server/api/invite-links/accept.post.ts')).toMatch(/The demo account cannot join other organizations/)
    expect(read('server/api/join-requests/index.post.ts')).toMatch(/The demo account cannot request access/)
  })

  it('suppresses the onboarding survey (and its re-prompt banner) for the demo account', () => {
    const surveyGet = read('server/api/onboarding-survey/index.get.ts')

    expect(surveyGet).toMatch(/isDemoAccountEmail\(session\.user\.email\)/)
    expect(surveyGet).toMatch(/return \{ completed: true \}/)
  })

  it('keeps demo account email notification preferences disabled', () => {
    const seed = read('server/scripts/seed.ts')

    expect(seed).toMatch(/disableDemoEmailNotifications\(userId, existingOrg\.id\)/)
    expect(seed).toMatch(/disableDemoEmailNotifications\(userId, orgId\)/)
    expect(seed).toMatch(/set: \{ channelMode: "off", updatedAt: now \}/)
    expect(read('server/api/notification-preferences/index.get.ts')).toMatch(/isDemoAccountEmail\(session\.user\.email\)/)
    expect(read('server/api/notification-preferences/index.patch.ts')).toMatch(/isDemoAccountEmail\(session\.user\.email\)/)
  })

  it('opens the account upsell before the demo account can write in chat', () => {
    const chatPage = read('app/pages/dashboard/chatbot/[[id]].vue')

    expect(chatPage).toMatch(/@beforeinput="handleDemoChatAttempt"/)
    expect(chatPage).toMatch(/if \(handleDemoChatAttempt\(\)\) return/)
    expect(chatPage).toMatch(/Create your own account to start a private workspace/)
  })

  it('directs read-only demo users to create an account instead of self-hosting', () => {
    const previewError = read('server/utils/previewReadOnly.ts')

    expect(previewError).toMatch(/Create your own account/)
    expect(previewError).not.toMatch(/self-host/i)
  })
})
