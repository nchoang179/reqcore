import { and, eq, exists, desc, sql } from 'drizzle-orm'
import { job, orgSettings, organization, member, user } from '../database/schema'
import { markdownToFeedHtml } from '../../shared/job-description'
import {
  checkFeedEligibility,
  feedValidThrough,
  isFeedBoard,
  type FeedBoard,
} from '../utils/jobFeed'

/**
 * GET /jobs.xml — the platform-wide job board feed.
 *
 * One feed for every organization's open roles, submitted to aggregators
 * (Jooble, Adzuna, Careerjet, Talent.com, Jobsora, Jora, WhatJobs) under
 * Reqcore's own publisher account. Customers get syndication by publishing a
 * role and doing nothing else.
 *
 * `?board=<name>` stamps `utm_source` onto every job URL, so applications
 * arriving from a board are attributed through the existing source-tracking
 * path (`mapUtmToChannel` in the public apply handler) with no extra wiring.
 * Each aggregator is given its own tagged feed URL at submission time.
 *
 * Which jobs qualify is decided by `checkFeedEligibility` — see the note there
 * on why the bar is deliberately high.
 */

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Wrap in CDATA. The payload is escaped first, so a description containing
 * `]]>` cannot terminate the section early and break the whole feed.
 */
function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, ']]&gt;')}]]>`
}

function tag(name: string, value: string | null | undefined): string {
  if (!value) return ''
  return `    <${name}>${cdata(value)}</${name}>\n`
}

/** Feed convention for employment type, as read by the target aggregators. */
const JOB_TYPE_LABELS: Record<string, string> = {
  full_time: 'fulltime',
  part_time: 'parttime',
  contract: 'contract',
  internship: 'internship',
}

const EXPERIENCE_LABELS: Record<string, string> = {
  junior: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior level',
  lead: 'Lead',
}

function formatSalary(row: {
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryUnit: string | null
  salaryNegotiable: boolean
}): string | null {
  // A negotiable range is a starting point for a conversation, not a published
  // figure — the public job page hides it, so the feed must too.
  if (row.salaryNegotiable) return null
  if (!row.salaryMin && !row.salaryMax) return null

  const currency = row.salaryCurrency || 'USD'
  const unit = (row.salaryUnit || 'YEAR').toLowerCase()
  const amount = row.salaryMin && row.salaryMax
    ? `${row.salaryMin} - ${row.salaryMax}`
    : `${row.salaryMin ?? row.salaryMax}`

  return `${amount} ${currency} per ${unit}`
}

export default defineEventHandler(async (event) => {
  const origin = getRequestURL(event).origin
  const boardParam = getQuery(event).board
  const board: FeedBoard | null
    = typeof boardParam === 'string' && isFeedBoard(boardParam) ? boardParam : null

  // The demo workspace is seeded with fictional roles. Resolve its id once so
  // the eligibility check can exclude it without a per-job lookup.
  const demoOrgId = env.DEMO_ORG_SLUG
    ? (await db.query.organization.findFirst({
        where: eq(organization.slug, env.DEMO_ORG_SLUG),
        columns: { id: true },
      }))?.id ?? null
    : null

  // An org qualifies only if a verified owner stands behind it. Expressed as a
  // correlated EXISTS so one query answers both "which jobs" and "whose org is
  // vouched for", rather than loading every membership to filter in memory.
  const hasVerifiedOwner = exists(
    db
      .select({ ok: sql`1` })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(
        eq(member.organizationId, job.organizationId),
        eq(member.role, 'owner'),
        eq(user.emailVerified, true),
      )),
  )

  const rows = await db
    .select({
      id: job.id,
      slug: job.slug,
      title: job.title,
      description: job.description,
      type: job.type,
      status: job.status,
      isTest: job.isTest,
      department: job.department,
      experienceLevel: job.experienceLevel,
      location: job.location,
      locationCity: job.locationCity,
      locationRegion: job.locationRegion,
      locationCountry: job.locationCountry,
      locationPostalCode: job.locationPostalCode,
      remoteStatus: job.remoteStatus,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryCurrency: job.salaryCurrency,
      salaryUnit: job.salaryUnit,
      salaryNegotiable: job.salaryNegotiable,
      validThrough: job.validThrough,
      publishedAt: job.publishedAt,
      createdAt: job.createdAt,
      distributeToBoards: job.distributeToBoards,
      organizationId: job.organizationId,
      organizationName: organization.name,
      companyWebsite: orgSettings.websiteUrl,
      ownerVerified: hasVerifiedOwner,
    })
    .from(job)
    .innerJoin(organization, eq(organization.id, job.organizationId))
    .leftJoin(orgSettings, eq(orgSettings.organizationId, job.organizationId))
    .where(and(
      eq(job.status, 'open'),
      eq(job.isTest, false),
      eq(job.distributeToBoards, true),
    ))
    .orderBy(desc(job.publishedAt))

  const now = new Date()
  const items: string[] = []

  for (const row of rows) {
    const ineligible = checkFeedEligibility(row, {
      isDemo: demoOrgId !== null && row.organizationId === demoOrgId,
      ownerEmailVerified: Boolean(row.ownerVerified),
    }, now)
    if (ineligible) continue

    const postedAt = row.publishedAt ?? row.createdAt
    const url = new URL(`${origin}/jobs/${row.slug}`)
    if (board) {
      url.searchParams.set('utm_source', board)
      url.searchParams.set('utm_medium', 'jobboard')
    }

    // A fully remote role often has no city. Boards need *something* placeable
    // in the location slot or they drop the listing from location searches.
    const city = row.locationCity
      ?? (row.remoteStatus === 'remote' ? 'Remote' : row.location)

    items.push(
      '  <job>\n'
      + tag('title', row.title)
      + tag('date', postedAt.toUTCString())
      + tag('referencenumber', row.id)
      + tag('url', url.toString())
      + tag('company', row.organizationName)
      + tag('companyurl', row.companyWebsite)
      + tag('city', city)
      + tag('state', row.locationRegion)
      + tag('country', row.locationCountry)
      // Lets a board geocode to the postal district instead of the city
      // centroid, which is what radius search ("within 10 miles") ranks on.
      + tag('postalcode', row.locationPostalCode)
      + tag('jobtype', JOB_TYPE_LABELS[row.type] ?? 'fulltime')
      + tag('category', row.department)
      + tag('experience', row.experienceLevel ? EXPERIENCE_LABELS[row.experienceLevel] : null)
      + tag('remote', row.remoteStatus === 'remote' ? 'Yes' : null)
      + tag('salary', formatSalary(row))
      + tag('expirationdate', feedValidThrough(row, postedAt).toUTCString())
      + tag('description', markdownToFeedHtml(row.description))
      + '  </job>\n',
    )
  }

  const body
    = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<source>\n'
      + `  <publisher>${xmlEscape('Reqcore')}</publisher>\n`
      + `  <publisherurl>${xmlEscape(origin)}</publisherurl>\n`
      + `  <lastBuildDate>${xmlEscape(now.toUTCString())}</lastBuildDate>\n`
      + items.join('')
      + '</source>\n'

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  // Boards poll every few hours; an hour of edge cache costs nothing and keeps
  // a crawler burst off the database. Mirrors sitemap.xml.
  setHeader(event, 'Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
  // No X-Robots-Tag here: the catch-all rule in nuxt.config.ts already serves
  // `noindex, nofollow`, which is right for a feed. Aggregators fetch this URL
  // directly from their publisher config, they don't discover it by crawling.
  return body
})
