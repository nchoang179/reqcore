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

/** The structured location columns a job carries. */
interface StoredJobLocation {
  locationCity?: string | null
  locationRegion?: string | null
  locationCountry?: string | null
}

/** The same columns as a PATCH supplies them — absent means "not touched". */
interface JobLocationPatch {
  locationCity?: string | null
  locationRegion?: string | null
  locationCountry?: string | null
  locationPostalCode?: string | null
}

/**
 * The derived columns a job update should write, given what is stored and what
 * the patch supplies.
 *
 * Only keys that should actually be written are returned; an empty object means
 * "leave the stored values alone". That distinction is the point of this
 * function. The job settings form always sends all four structured fields, so
 * "the patch has no country" is ambiguous on its own: for a job that had a
 * structured place it means *clear it*, but for a job created before the picker
 * existed it means nothing was picked — and its hand-typed `location` is the
 * only location that job has. Recomputing that one to NULL on an unrelated save
 * (a title edit, a salary change) silently loses it from the public job page,
 * the dashboard list and its search and sort.
 */
export function resolveDerivedLocation(
  stored: StoredJobLocation,
  patch: JobLocationPatch,
): { location?: string | null, locationPostalCode?: string | null } {
  const touchesLocation = patch.locationCity !== undefined
    || patch.locationRegion !== undefined
    || patch.locationCountry !== undefined
    || patch.locationPostalCode !== undefined

  if (!touchesLocation) return {}

  const country = patch.locationCountry === undefined ? stored.locationCountry : patch.locationCountry

  if (country) {
    return {
      location: formatJobLocation({
        city: patch.locationCity === undefined ? stored.locationCity : patch.locationCity,
        region: patch.locationRegion === undefined ? stored.locationRegion : patch.locationRegion,
        country,
      }),
    }
  }

  // No country on the result: a postal code left behind is unplaceable, and
  // sending one to a board only mis-pins the listing — so it always goes. The
  // display string only goes when there was a structured place to clear.
  return stored.locationCountry
    ? { location: null, locationPostalCode: null }
    : { locationPostalCode: null }
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
