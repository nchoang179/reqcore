import { describe, expect, it } from 'vitest'
import { normalizePlaceQuery, resolvePlaceLabel, searchPlaces } from '../../server/utils/geo/search'

const labels = (query: string, limit?: number) => searchPlaces(query, limit).map(place => place.label)

describe('normalizePlaceQuery', () => {
  it('folds case, diacritics and whitespace', () => {
    expect(normalizePlaceQuery('  Zürich ')).toBe('zurich')
    expect(normalizePlaceQuery('SÃO   PAULO')).toBe('sao paulo')
  })
})

describe('searchPlaces', () => {
  it('returns nothing for an empty query', () => {
    expect(searchPlaces('')).toEqual([])
    expect(searchPlaces('   ')).toEqual([])
  })

  it('finds accented places typed without accents', () => {
    expect(labels('malmo')[0]).toBe('Malmö, Skåne, Sweden')
    expect(labels('zurich')[0]).toBe('Zürich, Switzerland')
  })

  it('ranks an exact match first', () => {
    expect(labels('oslo')[0]).toBe('Oslo, Norway')
    expect(labels('berlin')[0]).toBe('Berlin, Germany')
  })

  it('puts the bigger city first among places sharing a name', () => {
    const springfields = labels('springfield')
    expect(springfields[0]).toBe('Springfield, Missouri, United States')
  })

  it('surfaces the country when the query names one', () => {
    expect(labels('norway')[0]).toBe('Norway')
    expect(labels('india')[0]).toBe('India')
  })

  it('matches on a later word, so "york" finds New York', () => {
    expect(labels('york', 20)).toContain('New York City, New York, United States')
  })

  it('caps results at the requested limit', () => {
    expect(searchPlaces('san', 5)).toHaveLength(5)
    expect(searchPlaces('a').length).toBeLessThanOrEqual(20)
  })

  it('always returns a country code the feed can index', () => {
    for (const place of searchPlaces('paris', 10)) {
      expect(place.country).toMatch(/^[A-Z]{2}$/)
    }
  })
})

describe('resolvePlaceLabel', () => {
  it('resolves an unambiguous name or full label', () => {
    expect(resolvePlaceLabel('Oslo')?.country).toBe('NO')
    expect(resolvePlaceLabel('Berlin, Germany')?.country).toBe('DE')
    expect(resolvePlaceLabel('Austin, Texas, United States')?.country).toBe('US')
    expect(resolvePlaceLabel('Norway')?.country).toBe('NO')
  })

  it('resolves a shared name when one place decisively dominates', () => {
    expect(resolvePlaceLabel('London')?.country).toBe('GB')
  })

  it('resolves a bare country name to a place with no city', () => {
    // The dataset has no subnational regions, so a US state or province name
    // that a country also carries resolves to the country with nothing to be
    // ambiguous against. `backfill-job-location.ts` holds these back for a
    // human rather than writing "Georgia" the state as the country GE — the
    // absent city is what it keys on, so that property is pinned here.
    for (const [name, code] of [['Georgia', 'GE'], ['Jordan', 'JO'], ['Chad', 'TD']] as const) {
      const place = resolvePlaceLabel(name)
      expect(place?.country).toBe(code)
      expect(place?.city).toBeNull()
    }
  })

  it('refuses to guess when the name is ambiguous or unknown', () => {
    // Wrong country on a live posting is worse than no country.
    expect(resolvePlaceLabel('Springfield')).toBeNull()
    expect(resolvePlaceLabel('Nowhereville')).toBeNull()
    expect(resolvePlaceLabel('Remote')).toBeNull()
    expect(resolvePlaceLabel('')).toBeNull()
  })
})
