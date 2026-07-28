/**
 * Regenerates the bundled place dataset used by the job-location picker.
 *
 *   npx tsx server/scripts/generate-geo-dataset.ts
 *
 * Source is GeoNames (https://www.geonames.org), CC BY 4.0. The generated JSON
 * is committed so neither the build nor the running server needs network access
 * — this script only runs when we want to refresh the data.
 *
 * `cities15000` (population > 15,000, ~26k rows) is the smallest cut that still
 * covers everywhere a recruiter is realistically hiring. Going down to
 * cities5000 quadruples the file for places that would mostly add ambiguity.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInflateRaw } from 'node:zlib'

const BASE = 'https://download.geonames.org/export/dump'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** ~1.5 MB — server-only, must never reach the client bundle. */
const CITIES_OUT = join(ROOT, 'server', 'utils', 'geo', 'data', 'cities.json')
/** ~5 KB — shared, because the client formats ISO codes back into country names. */
const COUNTRIES_OUT = join(ROOT, 'shared', 'countries.json')

/** GeoNames column indexes we read out of cities15000.txt. */
const COL = {
  name: 1,
  asciiName: 2,
  countryCode: 8,
  admin1Code: 10,
  population: 14,
} as const

async function fetchText(file: string): Promise<string> {
  const res = await fetch(`${BASE}/${file}`)
  if (!res.ok) throw new Error(`Failed to download ${file}: ${res.status} ${res.statusText}`)
  return res.text()
}

/**
 * cities15000 is only published as a zip. Rather than pull in a zip dependency
 * for one file, read the single stored entry out of the archive by hand — the
 * central directory tells us where the entry's data starts and how it is
 * compressed (always deflate for these dumps).
 */
async function fetchZippedText(file: string): Promise<string> {
  const res = await fetch(`${BASE}/${file}`)
  if (!res.ok) throw new Error(`Failed to download ${file}: ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())

  // Local file header: signature(4) version(2) flags(2) method(2) time(2)
  // date(2) crc(4) compressed(4) uncompressed(4) nameLen(2) extraLen(2)
  if (buf.readUInt32LE(0) !== 0x04034B50) throw new Error(`${file} is not a zip archive`)
  const method = buf.readUInt16LE(8)
  const nameLen = buf.readUInt16LE(26)
  const extraLen = buf.readUInt16LE(28)
  const start = 30 + nameLen + extraLen
  const compressed = buf.readUInt32LE(18)
  const body = compressed > 0
    ? buf.subarray(start, start + compressed)
    : buf.subarray(start, buf.indexOf(Buffer.from([0x50, 0x4B, 0x01, 0x02]), start))

  if (method === 0) return body.toString('utf8')
  if (method !== 8) throw new Error(`${file} uses unsupported zip compression method ${method}`)

  const inflate = createInflateRaw()
  const chunks: Buffer[] = []
  inflate.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => {
    inflate.on('end', resolve)
    inflate.on('error', reject)
  })
  inflate.end(body)
  await done
  return Buffer.concat(chunks).toString('utf8')
}

function tsvRows(text: string): string[][] {
  return text
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => line.split('\t'))
}

async function main() {
  console.log('Downloading GeoNames dumps…')
  const [citiesText, admin1Text, countryText] = await Promise.all([
    fetchZippedText('cities15000.zip'),
    fetchText('admin1CodesASCII.txt'),
    fetchText('countryInfo.txt'),
  ])

  // countryInfo.txt: ISO(0) ISO3(1) ISO-numeric(2) fips(3) Country(4) …
  const countries: [string, string][] = []
  for (const row of tsvRows(countryText)) {
    const code = row[0]?.trim()
    const name = row[4]?.trim()
    if (code?.length === 2 && name) countries.push([code, name])
  }
  countries.sort((a, b) => a[1].localeCompare(b[1]))
  console.log(`  ${countries.length} countries`)

  // admin1CodesASCII.txt: "CC.ADMIN1"(0) name(1) asciiName(2) geonameId(3)
  const regions = new Map<string, string>()
  for (const row of tsvRows(admin1Text)) {
    const key = row[0]?.trim()
    const name = row[1]?.trim()
    if (key && name) regions.set(key, name)
  }

  // Emit as tuples rather than objects: the field names would otherwise repeat
  // ~26,000 times and roughly double the file.
  const cities: [string, string, string, string, number][] = []
  for (const row of tsvRows(citiesText)) {
    const name = row[COL.name]?.trim()
    const countryCode = row[COL.countryCode]?.trim()
    if (!name || !countryCode) continue

    const asciiName = row[COL.asciiName]?.trim() ?? name
    const region = regions.get(`${countryCode}.${row[COL.admin1Code]?.trim()}`) ?? ''
    const population = Number.parseInt(row[COL.population] ?? '0', 10) || 0

    // asciiName is stored only when it differs, so the common case costs 2 bytes.
    cities.push([name, asciiName === name ? '' : asciiName, region, countryCode, population])
  }
  cities.sort((a, b) => b[4] - a[4])
  console.log(`  ${cities.length} cities`)

  await mkdir(dirname(CITIES_OUT), { recursive: true })
  await writeFile(COUNTRIES_OUT, `${JSON.stringify(countries)}\n`)
  await writeFile(CITIES_OUT, `${JSON.stringify(cities)}\n`)
  console.log(`Wrote ${COUNTRIES_OUT}\nWrote ${CITIES_OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
