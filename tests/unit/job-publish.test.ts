import { describe, expect, it } from 'vitest'
import {
  MIN_DESCRIPTION_CHARS,
  isPublishReady,
  missingPublishRequirements,
} from '../../shared/job-publish'
import { hasPublishableLocation } from '../../shared/job-location'
import { assertPublishable, checkFeedEligibility } from '../../server/utils/jobFeed'

const LONG_DESCRIPTION = 'We are hiring a senior test engineer. '.repeat(10)
const NOW = new Date('2026-07-27T12:00:00Z')

/** A role that meets every requirement — each test breaks exactly one. */
const publishable = {
  description: LONG_DESCRIPTION,
  locationCountry: 'NO',
  remoteStatus: 'onsite',
  validThrough: null,
}

describe('missingPublishRequirements', () => {
  it('passes a complete role', () => {
    expect(missingPublishRequirements(publishable, NOW)).toEqual([])
    expect(isPublishReady(publishable, NOW)).toBe(true)
  })

  it('requires a country unless the role is fully remote', () => {
    const codes = (remoteStatus: string | null) =>
      missingPublishRequirements({ ...publishable, locationCountry: null, remoteStatus }, NOW).map(r => r.code)

    expect(codes('onsite')).toContain('missing_country')
    expect(codes('hybrid')).toContain('missing_country')
    expect(codes(null)).toContain('missing_country')
    expect(codes('remote')).toEqual([])
  })

  it('requires a description the boards will not reject as thin', () => {
    const short = missingPublishRequirements({ ...publishable, description: 'Great role, apply now.' }, NOW)
    expect(short.map(r => r.code)).toEqual(['description_too_short'])
    expect(short[0]?.field).toBe('description')
    expect(short[0]?.reason).toContain(String(MIN_DESCRIPTION_CHARS))

    expect(missingPublishRequirements({ ...publishable, description: null }, NOW).map(r => r.code))
      .toEqual(['description_too_short'])
  })

  it('measures the description as plain text, so markdown syntax cannot pad it', () => {
    // Well over the floor as raw markdown, a handful of words once the link
    // URLs and heading markers are stripped — which is all a board would show.
    const padded = '# [Apply](https://example.com/a-very-long-tracking-url-nobody-reads)\n'.repeat(5)
    expect(missingPublishRequirements({ ...publishable, description: padded }, NOW).map(r => r.code))
      .toEqual(['description_too_short'])
  })

  it('rejects a role whose expiry has already passed', () => {
    expect(missingPublishRequirements({ ...publishable, validThrough: new Date('2026-07-26') }, NOW).map(r => r.code))
      .toEqual(['expired'])
    expect(missingPublishRequirements({ ...publishable, validThrough: new Date('2026-08-26') }, NOW))
      .toEqual([])
  })

  it('reports every unmet requirement at once, so a form can flag them together', () => {
    const missing = missingPublishRequirements({
      description: '',
      locationCountry: null,
      remoteStatus: 'hybrid',
      validThrough: new Date('2020-01-01'),
    }, NOW)

    expect(missing.map(r => r.code)).toEqual(['expired', 'missing_country', 'description_too_short'])
    expect(missing.map(r => r.field)).toEqual(['validThrough', 'locationCountry', 'description'])
  })
})

describe('assertPublishable', () => {
  it('blocks publishing a role the job boards would drop', () => {
    expect(() => assertPublishable({ ...publishable, locationCountry: null }, NOW))
      .toThrow(/Add a country/)
    expect(() => assertPublishable({ ...publishable, description: 'too short' }, NOW))
      .toThrow(/at least 200 characters/)

    expect(() => assertPublishable(publishable, NOW)).not.toThrow()
    expect(() => assertPublishable({ ...publishable, locationCountry: null, remoteStatus: 'remote' }, NOW)).not.toThrow()
  })

  it('reports a 422 naming the field, so the form can surface it on that input', () => {
    try {
      assertPublishable({ ...publishable, description: '' }, NOW)
      expect.unreachable('should have thrown')
    } catch (error) {
      const err = error as { statusCode?: number, data?: { code?: string, field?: string } }
      expect(err.statusCode).toBe(422)
      expect(err.data).toEqual({ code: 'description_too_short', field: 'description' })
    }
  })
})

describe('feed eligibility agrees with the publish guard', () => {
  const org = { isDemo: false, ownerEmailVerified: true }
  const feedJob = { status: 'open', isTest: false, distributeToBoards: true, ...publishable }

  it('holds back exactly the roles publishing would have refused', () => {
    for (const locationCountry of [null, 'NO']) {
      for (const remoteStatus of [null, 'remote', 'hybrid', 'onsite']) {
        const job = { ...feedJob, locationCountry, remoteStatus }
        const blockedByCountry = checkFeedEligibility(job, org, NOW)?.code === 'missing_country'
        expect(blockedByCountry).toBe(!hasPublishableLocation(job))
      }
    }

    for (const description of ['', 'A short one.', LONG_DESCRIPTION]) {
      const job = { ...feedJob, description }
      const ineligible = checkFeedEligibility(job, org, NOW)
      expect(ineligible?.code === 'description_too_short').toBe(!isPublishReady(job, NOW))
    }
  })

  it('still applies the account-level rules the recruiter cannot edit away', () => {
    expect(checkFeedEligibility({ ...feedJob, status: 'draft' }, org, NOW)?.code).toBe('not_open')
    expect(checkFeedEligibility({ ...feedJob, distributeToBoards: false }, org, NOW)?.code).toBe('opted_out')
    expect(checkFeedEligibility(feedJob, { ...org, isDemo: true }, NOW)?.code).toBe('demo_org')
    expect(checkFeedEligibility(feedJob, { ...org, ownerEmailVerified: false }, NOW)?.code).toBe('org_unverified')
    expect(checkFeedEligibility(feedJob, org, NOW)).toBeNull()

    // A test role is held back on its own merits, not because it happens to be
    // incomplete — an otherwise perfect one must still never reach the feed.
    expect(checkFeedEligibility({ ...feedJob, isTest: true }, org, NOW)?.code).toBe('test_job')
    expect(checkFeedEligibility({ ...feedJob, isTest: true }, org, NOW)?.fixable).toBe(false)
  })
})
