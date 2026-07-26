import { markdownToPlainText } from '../../shared/job-description'

/**
 * Eligibility rules for the platform-wide job board feed (`/jobs.xml`).
 *
 * Every organization's open roles share ONE feed submitted under Reqcore's own
 * publisher account. That is what makes distribution free and zero-click for
 * customers — and it is also the risk: aggregators suspend a publisher for the
 * whole feed, not per job. One org posting spam or empty listings would take
 * distribution away from every paying customer at once.
 *
 * So this gate is deliberately conservative. It runs on the way into the feed
 * and its reasons are surfaced in the Promote tab, so a recruiter whose job is
 * held back is told exactly what to fix rather than silently getting nothing.
 */

/** Aggregators that ingest the feed. `?board=` selects which one is being served. */
export const FEED_BOARDS = [
  'jooble',
  'adzuna',
  'careerjet',
  'talent_com',
  'jobsora',
  'jora',
  'whatjobs',
] as const

export type FeedBoard = (typeof FEED_BOARDS)[number]

export const FEED_BOARD_LABELS: Record<FeedBoard, string> = {
  jooble: 'Jooble',
  adzuna: 'Adzuna',
  careerjet: 'Careerjet',
  talent_com: 'Talent.com',
  jobsora: 'Jobsora',
  jora: 'Jora',
  whatjobs: 'WhatJobs',
}

export function isFeedBoard(value: string): value is FeedBoard {
  return (FEED_BOARDS as readonly string[]).includes(value)
}

/**
 * Boards reject thin listings. This floor is low enough that a genuinely short
 * real posting passes and high enough to exclude a title typed into the body.
 */
const MIN_DESCRIPTION_CHARS = 200

/** Emitted as <date>/validThrough when a job has no explicit expiry. */
export const DEFAULT_FEED_VALIDITY_DAYS = 60

export type FeedIneligibilityCode =
  | 'not_open'
  | 'opted_out'
  | 'expired'
  | 'missing_country'
  | 'description_too_short'
  | 'demo_org'
  | 'org_unverified'

export interface FeedIneligibility {
  code: FeedIneligibilityCode
  /** Shown to the recruiter in the Promote tab. */
  reason: string
  /** Whether the recruiter can fix this themselves by editing the job. */
  fixable: boolean
}

export interface FeedJobInput {
  status: string
  distributeToBoards: boolean
  description: string | null
  locationCountry: string | null
  remoteStatus: string | null
  validThrough: Date | null
}

export interface FeedOrgInput {
  isDemo: boolean
  ownerEmailVerified: boolean
}

/**
 * Returns `null` when the job belongs in the feed, otherwise the first reason
 * it does not. Order matters: the most actionable reasons come first so the
 * Promote tab shows a recruiter something they can act on rather than an
 * account-level condition they cannot.
 */
export function checkFeedEligibility(
  job: FeedJobInput,
  org: FeedOrgInput,
  now: Date = new Date(),
): FeedIneligibility | null {
  if (job.status !== 'open') {
    return {
      code: 'not_open',
      reason: 'Only open roles are sent to job boards.',
      fixable: true,
    }
  }

  if (!job.distributeToBoards) {
    return {
      code: 'opted_out',
      reason: 'This role is marked confidential and is kept off external job boards.',
      fixable: true,
    }
  }

  if (job.validThrough && job.validThrough.getTime() <= now.getTime()) {
    return {
      code: 'expired',
      reason: 'This role\'s expiry date has passed. Extend it to keep it on job boards.',
      fixable: true,
    }
  }

  // Fully remote roles legitimately have no country. Everything else needs one:
  // aggregators index by location and drop or bury postings they cannot place.
  if (!job.locationCountry && job.remoteStatus !== 'remote') {
    return {
      code: 'missing_country',
      reason: 'Add a country so job boards can place this role in their search results.',
      fixable: true,
    }
  }

  if (markdownToPlainText(job.description).length < MIN_DESCRIPTION_CHARS) {
    return {
      code: 'description_too_short',
      reason: `Job boards reject thin listings. Write at least ${MIN_DESCRIPTION_CHARS} characters of description.`,
      fixable: true,
    }
  }

  if (org.isDemo) {
    return {
      code: 'demo_org',
      reason: 'Demo workspace roles are never sent to external job boards.',
      fixable: false,
    }
  }

  if (!org.ownerEmailVerified) {
    return {
      code: 'org_unverified',
      reason: 'Verify your account email to start syndicating roles to job boards.',
      fixable: false,
    }
  }

  return null
}

/** Convenience wrapper for callers that only need a yes/no. */
export function isFeedEligible(job: FeedJobInput, org: FeedOrgInput, now?: Date): boolean {
  return checkFeedEligibility(job, org, now) === null
}

/**
 * The expiry a job is advertised with. Boards drop postings with no expiry and
 * flag ones that never age out, so a job without an explicit `validThrough` is
 * given a rolling window from its publication date.
 */
export function feedValidThrough(job: { validThrough: Date | null }, postedAt: Date): Date {
  if (job.validThrough) return job.validThrough
  const fallback = new Date(postedAt)
  fallback.setDate(fallback.getDate() + DEFAULT_FEED_VALIDITY_DAYS)
  return fallback
}
