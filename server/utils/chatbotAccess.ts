/**
 * Server-side gate for the chatbot feature.
 *
 * Performs auth, scope, and plan-entitlement checks in one helper so every
 * chatbot endpoint agrees on who may reach it.
 *
 * The assistant is currently entitled on *every* tier, so this passes for
 * everyone; the Free limit is a lifetime turn count enforced at spend time in
 * utils/ai/budget.ts, not an entitlement. The call stays here because
 * FEATURE_MIN_TIER is the single source of truth — raising `chatbot` back above
 * `free` re-gates every endpoint without touching this file.
 */
import type { H3Event } from 'h3'
import { assertPlanFeature } from './billing/plan'

export async function requireChatbotAccess(event: H3Event) {
  // Minimal permission set — chatbot reads jobs/candidates/applications/docs.
  const session = await requirePermission(event, {
    job: ['read'],
    candidate: ['read'],
    application: ['read'],
    document: ['read'],
  })

  await assertPlanFeature(session.session.activeOrganizationId, 'chatbot')

  return session
}
