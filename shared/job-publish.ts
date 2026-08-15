/**
 * What a role must have before it can go live.
 *
 * Publishing is the moment a job enters the platform-wide board feed, and
 * aggregators judge a publisher by its whole feed rather than by one listing
 * (see the note in `server/utils/jobFeed.ts`). A role that goes live missing any
 * of this is not just invisible itself — a feed full of thin or unplaceable
 * listings is what gets the shared publisher account suspended.
 *
 * So this is the fixable half of `checkFeedEligibility`, lifted out to where the
 * create form, the publish guard and the feed can all read the same rules. The
 * account-level conditions (demo workspace, unverified owner) stay in the feed
 * gate, because no amount of editing the job clears them.
 *
 * Drafts are deliberately exempt — a half-filled job is what a draft is for.
 */
import { markdownToPlainText } from './job-description'
import { hasPublishableLocation } from './job-location'

/**
 * Boards reject thin listings. This floor is low enough that a genuinely short
 * real posting passes and high enough to exclude a title typed into the body.
 */
export const MIN_DESCRIPTION_CHARS = 200

export type PublishRequirementCode = 'expired' | 'missing_country' | 'description_too_short'

/**
 * The form field a requirement points at, so a recruiter is sent to the input
 * that fixes it instead of a generic error.
 */
export type PublishRequirementField = 'validThrough' | 'locationCountry' | 'description'

export interface PublishRequirement {
  code: PublishRequirementCode
  field: PublishRequirementField
  /** Shown to the recruiter — in the job form, and in the Promote tab. */
  reason: string
}

export interface PublishRequirementInput {
  description?: string | null
  locationCountry?: string | null
  remoteStatus?: string | null
  validThrough?: Date | string | null
}

/**
 * Description length as the boards measure it: markdown syntax is not content,
 * so a body of bullet markers and headings does not buy its way past the floor.
 */
export function descriptionLength(description?: string | null): number {
  return markdownToPlainText(description).length
}

/**
 * Every requirement this job does not yet meet, most actionable first.
 *
 * Returns an array rather than the first failure so a form can flag all of them
 * at once — a recruiter who is missing two things should learn that in one go.
 */
export function missingPublishRequirements(
  job: PublishRequirementInput,
  now: Date = new Date(),
): PublishRequirement[] {
  const missing: PublishRequirement[] = []

  const validThrough = job.validThrough ? new Date(job.validThrough) : null
  if (validThrough && validThrough.getTime() <= now.getTime()) {
    missing.push({
      code: 'expired',
      field: 'validThrough',
      reason: 'This role\'s expiry date has passed. Extend it to keep it on job boards.',
    })
  }

  // Fully remote roles legitimately have no country. Everything else needs one:
  // aggregators index by location and drop or bury postings they cannot place.
  if (!hasPublishableLocation(job)) {
    missing.push({
      code: 'missing_country',
      field: 'locationCountry',
      reason: 'Add a country so job boards can place this role in their search results.',
    })
  }

  return missing
}

/** Convenience wrapper for callers that only need a yes/no. */
export function isPublishReady(job: PublishRequirementInput, now?: Date): boolean {
  return missingPublishRequirements(job, now).length === 0
}
