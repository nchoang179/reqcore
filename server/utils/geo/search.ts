/**
 * Place search over the bundled GeoNames dataset.
 *
 * This backs the job-location picker. It exists so a recruiter can type freely
 * and still end up with a place the job board feed can actually index — the
 * picker only ever commits a value that came out of here, so an invalid or
 * misspelled location cannot reach the database.
 *
 * The dataset is ~34k cities (GeoNames `cities15000`, CC BY 4.0) plus 252
 * countries. It is server-only and deliberately never imported from `app/` —
 * 1.5 MB has no business in the client bundle when a debounced fetch does.
 */
import { COUNTRIES, countryName, foldPlaceName, formatJobLocation } from '../../../shared/job-location'
import cityData from './data/cities.json'

/** `[name, asciiName (empty when identical), region, countryCode, population]` */
type CityTuple = [string, string, string, string, number]

export interface GeoPlace {
  /** Stable across requests so the client can key list items. */
  id: string
  city: string | null
  region: string | null
  /** ISO 3166-1 alpha-2. */
  country: string
  countryName: string
  /** What the picker shows, and what gets stored as `job.location`. */
  label: string
}

interface IndexEntry {
  place: GeoPlace
  /** Lowercased, diacritic-stripped name, so "malmo" finds "Malmö". */
  needle: string
  /** Same, for the GeoNames ASCII spelling when it differs. */
  asciiNeedle: string
  /** The full "City, Region, Country" label, folded — used by exact lookup. */
  labelNeedle: string
  population: number
  isCountry: boolean
}

/**
 * Fold to a comparable form: lowercase, strip diacritics, collapse whitespace.
 * "Zürich" and "Zurich" must be the same string, or half of Europe is
 * unsearchable for anyone typing on a US keyboard.
 */
export function normalizePlaceQuery(value: string): string {
  return foldPlaceName(value).replace(/\s+/g, ' ').trim()
}

let index: IndexEntry[] | null = null

/**
 * Built once per process. The build walks ~34k cities and is a few hundred
 * milliseconds of uninterruptible synchronous work, so whichever request
 * triggers it stalls every other request in flight. It stays lazy — scripts and
 * tests should not pay for it — but the server warms it at boot via
 * `warmPlaceIndex()` so that cost never lands on a live typeahead keystroke.
 */
function getIndex(): IndexEntry[] {
  if (index) return index

  const entries: IndexEntry[] = []

  for (const { code, name } of COUNTRIES) {
    entries.push({
      place: { id: `country:${code}`, city: null, region: null, country: code, countryName: name, label: name },
      needle: normalizePlaceQuery(name),
      asciiNeedle: '',
      labelNeedle: normalizePlaceQuery(name),
      population: 0,
      isCountry: true,
    })
  }

  for (const [name, asciiName, region, country, population] of cityData as CityTuple[]) {
    const resolvedCountry = countryName(country)
    // Same formatter the job record uses, so a picked place and the stored
    // `job.location` string are always literally the same text.
    const label = formatJobLocation({ city: name, region, country })

    entries.push({
      place: {
        id: `city:${name}|${region}|${country}`,
        city: name,
        region: region || null,
        country,
        countryName: resolvedCountry,
        label,
      },
      needle: normalizePlaceQuery(name),
      asciiNeedle: asciiName ? normalizePlaceQuery(asciiName) : '',
      labelNeedle: normalizePlaceQuery(label),
      population,
      isCountry: false,
    })
  }

  index = entries
  return entries
}

/**
 * Build the index now, if it is not built already. Idempotent and safe to call
 * from anywhere; the server calls it from a boot plugin.
 */
export function warmPlaceIndex(): void {
  getIndex()
}

/** Lower is better. `null` means the entry does not match at all. */
function matchTier(entry: IndexEntry, query: string): number | null {
  for (const needle of [entry.needle, entry.asciiNeedle]) {
    if (!needle) continue
    if (needle === query) return 0
    if (needle.startsWith(query)) return 1
    // Word-prefix, so "york" finds "New York" and "angeles" finds "Los Angeles".
    if (needle.includes(` ${query}`)) return 2
  }
  return null
}

export const PLACE_SEARCH_LIMIT = 20

/**
 * Ranking, in order: match quality, then countries ahead of cities, then
 * population. Putting countries first within a tier means typing "norway" or
 * "ind" surfaces the country rather than burying it under same-prefix cities —
 * a country-wide role is a real thing recruiters post.
 */
export function searchPlaces(rawQuery: string, limit = PLACE_SEARCH_LIMIT): GeoPlace[] {
  const query = normalizePlaceQuery(rawQuery)
  if (!query) return []

  const hits: { entry: IndexEntry, tier: number }[] = []
  for (const entry of getIndex()) {
    const tier = matchTier(entry, query)
    if (tier !== null) hits.push({ entry, tier })
  }

  hits.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.entry.isCountry !== b.entry.isCountry) return a.entry.isCountry ? -1 : 1
    if (a.entry.population !== b.entry.population) return b.entry.population - a.entry.population
    return a.entry.place.label.localeCompare(b.entry.place.label)
  })

  return hits.slice(0, limit).map(hit => hit.entry.place)
}

/**
 * Exact lookup, used by the backfill script to resolve legacy free-text
 * locations. Matches either the bare place name ("Oslo") or the full label
 * ("Oslo, Norway"). Returns `null` when the text is ambiguous or unknown — a
 * wrong country on a live posting is worse than no country.
 */
export function resolvePlaceLabel(rawText: string): GeoPlace | null {
  const query = normalizePlaceQuery(rawText)
  if (!query) return null

  // A full-label hit is unambiguous by construction, so it wins outright.
  const labelled = getIndex().filter(entry => entry.labelNeedle === query)
  if (labelled.length === 1) return labelled[0]!.place

  const exact = getIndex().filter(entry => matchTier(entry, query) === 0)
  if (exact.length === 0) return null
  if (exact.length === 1) return exact[0]!.place

  // Several places share the name. Only accept it when one is decisively the
  // biggest — "Springfield" stays unresolved, "London" resolves to the UK one.
  const sorted = [...exact].sort((a, b) => b.population - a.population)
  const [first, second] = sorted
  if (first && second && first.population >= second.population * 10) return first.place
  return null
}
