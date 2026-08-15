import { getResendClient, isUndeliverableAddress } from '../email'
import { isDemoAccountEmail, isDemoOrgId } from '../demoOrg'
import { logError, logInfo } from '../logger'

/**
 * Lifecycle events — the activation funnel, emitted to Resend Automations.
 *
 * These are *not* the recruiter notifications in `notificationOutbox`. That
 * engine answers "something happened in your workspace, come look"; this one
 * answers "you signed up and then stopped", which is a question about an
 * absence. Absences can't be enqueued at the moment they occur — there is no
 * moment — so the waiting lives in Resend: we emit the event that starts the
 * clock (`org.created`) and the event that stops it (`job.posted`), and a
 * "Wait for Event" step decides whether anyone gets mailed.
 *
 * Consequences of that split, both deliberate:
 *
 *   - The copy and the timing are not in this repo. They are edited in the
 *     Resend dashboard, without a deploy. At this stage that is the point.
 *   - These are marketing emails, not transactional. Unsubscribes and the
 *     List-Unsubscribe header are handled by Resend against the contact, not
 *     by `notificationPreference`, which is per-org and per-recruiter-event.
 */
export const LIFECYCLE_EVENTS = {
  /** An organization was created — the first step of the funnel. */
  orgCreated: 'org.created',
  /** A role was opened — the step that ends the "signed up, no job" wait. */
  jobPosted: 'job.posted',
} as const

export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[keyof typeof LIFECYCLE_EVENTS]

export interface LifecycleEventParams {
  event: LifecycleEvent
  /** Recipient. Becomes the Resend contact the automation run is attached to. */
  email: string
  /** Skips demo workspaces. Pass null only when the event has no org context. */
  organizationId: string | null
  /** Merge data available to every step of the automation (subject lines, links). */
  payload?: Record<string, unknown>
}

/**
 * Whether this instance may emit lifecycle events at all.
 *
 * Fail-closed, unlike NOTIFICATIONS_ENABLED. A recruiter notification is mail
 * the operator's own users asked for; a lifecycle event ships a user's email
 * address to *our* Resend account, which is the wrong default for someone
 * self-hosting Reqcore on their own infrastructure. Hosted sets it explicitly.
 */
export function lifecycleEventsEnabled(): boolean {
  return env.LIFECYCLE_EMAILS_ENABLED && Boolean(env.RESEND_API_KEY)
}

/**
 * Emit one lifecycle event. Resolves to whether it actually reached Resend.
 *
 * Never throws. Every call site is inside a flow the user cares about far more
 * than this — creating their workspace, opening their first role — and none of
 * them should fail, or even slow down, because a marketing automation was
 * unreachable. Failures are logged rather than retried; a dropped event costs
 * one nudge email, and building a durable queue for it would be a much larger
 * change than the funnel currently justifies.
 */
export async function emitLifecycleEvent(params: LifecycleEventParams): Promise<boolean> {
  const { event, email, organizationId, payload } = params

  try {
    if (!lifecycleEventsEnabled()) return false

    const resend = getResendClient()
    if (!resend) return false

    // The seeded demo workspace is shared and public: everyone who clicks
    // through the walkthrough would otherwise enter the funnel as a signup who
    // never posted a role, and start receiving nudges about it.
    if (isDemoAccountEmail(email)) return false
    if (organizationId && await isDemoOrgId(organizationId)) return false

    // @example.com sample data can't receive mail, and feeding it to Resend
    // creates contacts that only ever hard bounce.
    if (isUndeliverableAddress(email)) return false

    const { error } = await resend.events.send({
      event,
      email,
      payload: { ...payload, organizationId },
    })

    if (error) {
      logError('Lifecycle event rejected by Resend', {
        category: 'lifecycle_event',
        event,
        organizationId,
        error: error.message,
      })
      return false
    }

    logInfo('Lifecycle event emitted', {
      category: 'lifecycle_event',
      event,
      organizationId,
    })
    return true
  }
  catch (error) {
    logError('Lifecycle event failed to send', {
      category: 'lifecycle_event',
      event,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Fire-and-forget variant for request paths.
 *
 * Signup and job creation are both interactive, and neither should wait on a
 * round trip to a third party to return a response. `emitLifecycleEvent`
 * already swallows its own failures, so the floating promise cannot reject.
 */
export function emitLifecycleEventInBackground(params: LifecycleEventParams): void {
  void emitLifecycleEvent(params)
}
