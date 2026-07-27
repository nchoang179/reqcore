import { describe, expect, it } from 'vitest'
import { countryName, formatJobLocation, hasPublishableLocation, isValidPostalCode, normalizePostalCode } from '../../shared/job-location'

describe('formatJobLocation', () => {
  it('builds the display string from the structured parts', () => {
    expect(formatJobLocation({ city: 'Austin', region: 'Texas', country: 'US' }))
      .toBe('Austin, Texas, United States')
    expect(formatJobLocation({ city: 'Oslo', region: null, country: 'NO' }))
      .toBe('Oslo, Norway')
    expect(formatJobLocation({ city: null, region: null, country: 'NO' }))
      .toBe('Norway')
  })

  it('drops a region that only repeats the city', () => {
    // GeoNames names a lot of admin1 regions after their city.
    expect(formatJobLocation({ city: 'Oslo', region: 'Oslo', country: 'NO' }))
      .toBe('Oslo, Norway')
    expect(formatJobLocation({ city: 'Berlin', region: 'Land Berlin', country: 'DE' }))
      .toBe('Berlin, Germany')
  })

  it('keeps a region the city merely contains, because it disambiguates', () => {
    // "Kansas City, Kansas" and "Kansas City, Missouri" are different places.
    expect(formatJobLocation({ city: 'Kansas City', region: 'Kansas', country: 'US' }))
      .toBe('Kansas City, Kansas, United States')
  })

  it('returns an empty string without a country', () => {
    expect(formatJobLocation(null)).toBe('')
    expect(formatJobLocation({ city: 'Nowhere', region: null, country: '' })).toBe('')
  })

  it('falls back to the raw code for an unknown country', () => {
    expect(countryName('ZZ')).toBe('ZZ')
    expect(countryName('no')).toBe('Norway')
  })
})

describe('hasPublishableLocation', () => {
  it('requires a country unless the role is fully remote', () => {
    expect(hasPublishableLocation({ locationCountry: 'NO', remoteStatus: 'onsite' })).toBe(true)
    expect(hasPublishableLocation({ locationCountry: null, remoteStatus: 'remote' })).toBe(true)
    expect(hasPublishableLocation({ locationCountry: null, remoteStatus: 'hybrid' })).toBe(false)
    expect(hasPublishableLocation({ locationCountry: null, remoteStatus: null })).toBe(false)
  })
})

describe('normalizePostalCode', () => {
  it('uppercases and collapses whitespace so one place stores one way', () => {
    expect(normalizePostalCode('  sw1a  1aa ')).toBe('SW1A 1AA')
    expect(normalizePostalCode('k1a0b1')).toBe('K1A0B1')
    expect(normalizePostalCode('12345-6789')).toBe('12345-6789')
  })

  it('treats a blank field as cleared', () => {
    expect(normalizePostalCode('')).toBeNull()
    expect(normalizePostalCode('   ')).toBeNull()
    expect(normalizePostalCode(null)).toBeNull()
    expect(normalizePostalCode(undefined)).toBeNull()
  })
})

describe('isValidPostalCode', () => {
  it('accepts the national formats', () => {
    // Norway, UK, Canada, US ZIP+4, Japan, Poland.
    for (const code of ['0150', 'SW1A 1AA', 'K1A 0B1', '12345-6789', '100-0001', '00-001']) {
      expect(isValidPostalCode(code)).toBe(true)
    }
  })

  it('rejects a street address, which is what a recruiter would otherwise paste here', () => {
    expect(isValidPostalCode('Storgata 1, 0155 Oslo')).toBe(false)
    expect(isValidPostalCode('221B Baker St.')).toBe(false)
    expect(isValidPostalCode('')).toBe(false)
    expect(isValidPostalCode('012345678901234')).toBe(false)
  })
})
