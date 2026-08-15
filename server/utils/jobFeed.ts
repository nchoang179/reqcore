import { createError } from 'h3'
import { lt } from 'drizzle-orm'
import { feedFetch } from '../database/schema'
import { missingPublishRequirements } from '../../shared/job-publish'
import type { PublishRequirementInput } from '../../shared/job-publish'

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

/** Emitted as <date>/validThrough when a job has no explicit expiry. */
export const DEFAULT_FEED_VALIDITY_DAYS = 60

/**
 * Characters XML 1.0 forbids outright. There is no escape for them and CDATA
 * does not exempt them, so one anywhere in the document makes the *whole* feed
 * unparseable to a strict ingester — every job is lost, not just the one that
 * carried it. Lenient parsers accept them, which is why this has to be
 * prevented at write time rather than caught by spot-checking the output.
 *
 * They arrive routinely: vertical tab and form feed are what a description
 * pasted out of Word or a PDF brings with it. Same set the resume parser
 * strips in `normalizeText` — tab, newline and carriage return stay.
 */
const XML_ILLEGAL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

/**
 * Wrap a value for the feed. Illegal characters are dropped first, then `]]>`
 * is neutralised so the payload cannot terminate the section early — that
 * order matters, since stripping can join `]]` and `>` into a terminator.
 */
export function feedCdata(value: string): string {
  return `<![CDATA[${value.replace(XML_ILLEGAL_CHARS, '').replace(/]]>/g, ']]&gt;')}]]>`
}

export type FeedIneligibilityCode =
  | 'not_open'
  | 'test_job'
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
  isTest: boolean
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
 * Refuses to publish a role the boards would reject or could not place.
 *
 * The feed gate alone would let a recruiter open a role and only discover in
 * the Promote tab that it is invisible. Blocking at publish time instead means
 * a live role is always distributable — drafts stay unrestricted, because
 * that is where a half-filled job legitimately lives.
 *
 * The failing field travels in `data` so the form that submitted can attach the
 * message to the input that fixes it.
 */
export function assertPublishable(job: PublishRequirementInput, now?: Date): void {
  const [unmet] = missingPublishRequirements(job, now)
  if (!unmet) return
  throw createError({
    statusCode: 422,
    statusMessage: unmet.reason,
    data: { code: unmet.code, field: unmet.field },
  })
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

  // Ahead of the fixable reasons on purpose: a test role isn't a job that needs
  // improving, so telling its creator to lengthen the description would be
  // advice about a listing that is never going anywhere.
  if (job.isTest) {
    return {
      code: 'test_job',
      reason: 'This is a test role. It stays inside your workspace and is never sent to job boards.',
      fixable: false,
    }
  }

  if (!job.distributeToBoards) {
    return {
      code: 'opted_out',
      reason: 'This role is marked confidential and is kept off external job boards.',
      fixable: true,
    }
  }

  // Everything a recruiter can fix by editing the job — the same rules the
  // publish guard enforces, so the two ends cannot drift apart.
  const [unmet] = missingPublishRequirements(job, now)
  if (unmet) {
    return { code: unmet.code, reason: unmet.reason, fixable: true }
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

/** How much fetch history is kept. Well past any board's polling interval. */
export const FEED_FETCH_RETENTION_DAYS = 90

/**
 * Trims the fetch log.
 *
 * `/jobs.xml` is public and unauthenticated, so the row count is set by whoever
 * decides to crawl it, not by the seven boards it exists for. Only the newest
 * fetch per board is ever read, so old rows are pure carrying cost.
 */
export async function pruneFeedFetchLog(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - FEED_FETCH_RETENTION_DAYS)
  const deleted = await db.delete(feedFetch).where(lt(feedFetch.fetchedAt, cutoff)).returning({ id: feedFetch.id })
  return deleted.length
}

/**
 * What we can honestly say about one board's copy of one job.
 *
 * Deliberately narrow. A pull-based feed can prove delivery — the board asked,
 * this job was in the answer — and nothing beyond it. None of these states
 * means "live on the board": ingestion happens on the board's own schedule and
 * by its own rules, and a listing can be rejected after collection without
 * telling us. `delivered` is the ceiling of what this evidence supports, and
 * the UI must not phrase it as more.
 */
export type BoardDeliveryState =
  /** This board fetched a feed containing the job. The strongest claim available. */
  | 'delivered'
  /** The job became eligible after this board's last fetch — it goes out next pull. */
  | 'pending'
  /** The board's most recent fetch did not include the job, though it existed by then. */
  | 'dropped'
  /** No fetch from this board has ever been recorded. */
  | 'never_fetched'

export interface BoardDelivery {
  board: FeedBoard
  label: string
  state: BoardDeliveryState
  /** When this board last pulled the feed, tagged or not. */
  lastFetchedAt: Date | null
}

/**
 * Compares a board's last pull against when the job was last put in the feed.
 *
 * Both timestamps come from the same clock — the feed route stamps the
 * `feed_fetch` row and the jobs it emitted with one `now` — so equality means
 * "was in that exact response" rather than a race the comparison has to
 * tolerate.
 *
 * Only meaningful for a job that is currently feed-eligible. For one that
 * isn't, the ineligibility reason is the answer and this would describe the
 * history of a job that is no longer going anywhere.
 */
export function boardDeliveryState(input: {
  lastFetchedAt: Date | null
  lastIncludedInFeedAt: Date | null
  /** When the job first became distributable — `publishedAt ?? createdAt`. */
  eligibleSince: Date
}): BoardDeliveryState {
  const { lastFetchedAt, lastIncludedInFeedAt, eligibleSince } = input

  if (!lastFetchedAt) return 'never_fetched'
  if (lastIncludedInFeedAt && lastIncludedInFeedAt >= lastFetchedAt) return 'delivered'

  // Published since the board last looked. Not a fault — there is simply
  // nothing this board could have collected yet.
  if (eligibleSince > lastFetchedAt) return 'pending'

  // The job existed and qualified, the board pulled, and it wasn't in the
  // response. Either it was ineligible at the time or something is wrong —
  // both are worth showing rather than smoothing into "pending".
  return 'dropped'
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
