import { describe, expect, it } from 'vitest'
import { boardDeliveryState } from '../../server/utils/jobFeed'

/**
 * Syndication is pull-based, so the Promote tab can only report what the feed
 * log can prove. These cases pin the boundary between the four claims it is
 * allowed to make — the panel previously showed one unconditional green check
 * for every board, which asserted delivery that had never been observed.
 */

const T = (iso: string) => new Date(iso)

const FETCHED = T('2026-08-10T12:00:00Z')
const PUBLISHED = T('2026-08-01T09:00:00Z')

describe('boardDeliveryState', () => {
  it('reports delivery when the job was in the board\'s latest pull', () => {
    expect(boardDeliveryState({
      lastFetchedAt: FETCHED,
      lastIncludedInFeedAt: FETCHED,
      eligibleSince: PUBLISHED,
    })).toBe('delivered')
  })

  it('treats a later inclusion as delivered too', () => {
    // The board pulled again after the timestamp we compare against; the job
    // went out in that newer response.
    expect(boardDeliveryState({
      lastFetchedAt: FETCHED,
      lastIncludedInFeedAt: T('2026-08-10T18:00:00Z'),
      eligibleSince: PUBLISHED,
    })).toBe('delivered')
  })

  it('is pending for a job published since the board last looked', () => {
    // The common case on the wizard's success screen: nothing has gone wrong,
    // there has simply been no pull yet to carry it.
    expect(boardDeliveryState({
      lastFetchedAt: FETCHED,
      lastIncludedInFeedAt: null,
      eligibleSince: T('2026-08-10T15:00:00Z'),
    })).toBe('pending')
  })

  it('reports dropped when the job existed but was left out of the last pull', () => {
    // Eligible well before the fetch and still not in it — either it was
    // ineligible at the time or something is wrong. Both need surfacing rather
    // than smoothing into "pending".
    expect(boardDeliveryState({
      lastFetchedAt: FETCHED,
      lastIncludedInFeedAt: T('2026-08-05T12:00:00Z'),
      eligibleSince: PUBLISHED,
    })).toBe('dropped')
  })

  it('reports dropped for an old job that has never been included', () => {
    expect(boardDeliveryState({
      lastFetchedAt: FETCHED,
      lastIncludedInFeedAt: null,
      eligibleSince: PUBLISHED,
    })).toBe('dropped')
  })

  it('claims nothing about a board that has never fetched', () => {
    // Including the window before this logging existed: no receipt is not the
    // same as a failed delivery, and must not be shown as one.
    expect(boardDeliveryState({
      lastFetchedAt: null,
      lastIncludedInFeedAt: T('2026-08-09T12:00:00Z'),
      eligibleSince: PUBLISHED,
    })).toBe('never_fetched')
  })

  it('counts an exact timestamp match as delivered', () => {
    // The feed route stamps the fetch row and the jobs it emitted with one
    // `now`, so equality is the *normal* result for a job that went out in
    // that response — a strict comparison here would report every fresh
    // delivery as dropped.
    const t = T('2026-08-10T12:00:00.123Z')
    expect(boardDeliveryState({
      lastFetchedAt: t,
      lastIncludedInFeedAt: new Date(t),
      eligibleSince: PUBLISHED,
    })).toBe('delivered')
  })
})
