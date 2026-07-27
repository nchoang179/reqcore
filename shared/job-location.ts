/**
 * Job location: structured parts, and the display string derived from them.
 *
 * A job's location is stored twice on purpose. `location_city` /
 * `location_region` / `location_country` are what job board aggregators index
 * on — they place a listing by ISO country code and drop or bury anything they
 * cannot place. The free-text `location` column is the *derived* human string,
 * and it stays because a lot of surfaces read it directly: career page filters,
 * dashboard search and sort, SEO meta, and the AI share-copy prompt.
 *
 * Deriving it here rather than letting recruiters type it is what keeps those
 * two in sync — and is why the career page's location filter can group roles at
 * all, instead of listing "Oslo" and "oslo, norway" as two separate places.
 */
import countryData from './countries.json'

/** ISO 3166-1 alpha-2 → English country name. */
export const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  countryData as [string, string][],
)

export const COUNTRIES: { code: string, name: string }[] = (countryData as [string, string][])
  .map(([code, name]) => ({ code, name }))

/**
 * A place the user picked. `country` is always present — a selection without a
 * country is not a selection, and is exactly what the feed cannot place.
 * `city` and `region` are absent when the user picked a whole country.
 */
export interface JobLocationParts {
  city?: string | null
  region?: string | null
  country: string
}

export function countryName(code?: string | null): string {
  if (!code) return ''
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase()
}

/**
 * Lowercase and strip accents, so "Zürich" and "Zurich" compare equal — the
 * dataset spells the same place both ways across its name and region columns.
 */
export function foldPlaceName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Whether a region name adds nothing over the city name.
 *
 * GeoNames names a lot of admin1 regions after their city — Oslo is in "Oslo",
 * Berlin is in "Land Berlin" — and "Berlin, Land Berlin, Germany" reads as a
 * bug. The test is deliberately one-directional: the region may swallow the
 * city, but not the reverse, because "Kansas City, Kansas" is a real
 * disambiguation from "Kansas City, Missouri" and must survive.
 */
function regionIsRedundant(city: string, region: string): boolean {
  const c = foldPlaceName(city)
  const r = foldPlaceName(region)
  if (c === r) return true
  return new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(r)
}

/**
 * The display string written to `job.location`.
 *
 * "Oslo, Norway" · "Austin, Texas, United States" · "Norway"
 */
export function formatJobLocation(parts: JobLocationParts | null | undefined): string {
  if (!parts?.country) return ''

  const country = countryName(parts.country)
  const city = parts.city?.trim()
  const region = parts.region?.trim()
  const keepRegion = region && (!city || !regionIsRedundant(city, region))

  return [city, keepRegion ? region : null, country].filter(Boolean).join(', ')
}

/**
 * Postal code characters that survive normalization.
 *
 * Deliberately narrow. The picker gives no way to enter a street, so this field
 * is the obvious place for a recruiter to paste one — and a street in the
 * `<postalcode>` slot makes an aggregator's geocoder place the job worse than
 * sending nothing. Letters, digits, spaces and hyphens cover every national
 * format (SW1A 1AA, K1A 0B1, 12345-6789, 0150) and exclude prose.
 */
const POSTAL_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]*$/

export const POSTAL_CODE_MAX_LENGTH = 12

/**
 * Canonical form of a postal code: trimmed, inner whitespace collapsed,
 * uppercased. "sw1a  1aa" and "SW1A 1AA" are the same place and must store
 * identically, the same reason country codes are uppercased.
 *
 * Returns `null` for blank input so a cleared field writes NULL rather than ''.
 */
export function normalizePostalCode(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/\s+/g, ' ').toUpperCase()
  return cleaned ? cleaned : null
}

export function isValidPostalCode(value: string): boolean {
  return value.length <= POSTAL_CODE_MAX_LENGTH && POSTAL_CODE_PATTERN.test(value)
}

/**
 * Whether a job can be placed by job board aggregators.
 *
 * Mirrors the `missing_country` rule in `server/utils/jobFeed.ts` so the create
 * form, the API publish guard and the feed itself cannot drift apart. Fully
 * remote roles legitimately have no country.
 */
export function hasPublishableLocation(job: {
  locationCountry?: string | null
  remoteStatus?: string | null
}): boolean {
  return Boolean(job.locationCountry) || job.remoteStatus === 'remote'
}
