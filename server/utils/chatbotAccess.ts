/**
 * Server-side gate for the chatbot feature.
 *
 * Performs auth, scope, feature flag AND plan-entitlement checks in one helper
 * so every chatbot endpoint agrees on who may reach it.
 *
 * Two gates, deliberately answering different questions:
 *   1. `chatbot-experience` flag — "has this shipped?" Off ⇒ 404, hiding that
 *      the endpoint exists at all. This is the rollout kill switch; once the
 *      assistant is fully released the flag's default flips to true.
 *   2. Plan entitlement (`chatbot`) — "is this org allowed?" Unentitled ⇒ 402
 *      PLAN_FEATURE_REQUIRED, which the UI turns into an upgrade prompt. A 404
 *      here would be wrong: the feature exists, the org just hasn't paid for
 *      it, and the client needs to tell them so.
 *
 * Order matters — the flag is checked first so a pre-release org never sees an
 * upgrade prompt for something we haven't launched.
 *
 * The assistant is currently entitled on *every* tier, so gate 2 passes for
 * everyone; the Free limit is a lifetime turn count enforced at spend time in
 * utils/ai/budget.ts, not an entitlement. The call stays here because
 * FEATURE_MIN_TIER is the single source of truth — raising `chatbot` back above
 * `free` re-gates every endpoint without touching this file.
 */
import type { H3Event } from 'h3'
import { resolveServerFeatureFlag } from './featureFlags'
import { assertPlanFeature } from './billing/plan'

export async function requireChatbotAccess(event: H3Event) {
  // Minimal permission set — chatbot reads jobs/candidates/applications/docs.
  const session = await requirePermission(event, {
    job: ['read'],
    candidate: ['read'],
    application: ['read'],
    document: ['read'],
  })

  const enabled = await resolveServerFeatureFlag('chatbot-experience', {
    distinctId: session.user.id,
    groups: { organization: session.session.activeOrganizationId },
  })

  if (!enabled) {
    // Hide existence of the endpoint when the flag is off.
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  await assertPlanFeature(session.session.activeOrganizationId, 'chatbot')

  return session
}
