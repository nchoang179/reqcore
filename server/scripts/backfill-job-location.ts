/**
 * Fills structured location columns on jobs created before the location picker.
 *
 * Those jobs carry only a free-text `location` string, which means job boards
 * cannot place them and `/jobs.xml` drops them (see `missing_country` in
 * server/utils/jobFeed.ts). This resolves that text against the bundled
 * GeoNames dataset where it can do so confidently.
 *
 * Default is a dry-run:
 *   npx tsx server/scripts/backfill-job-location.ts
 *
 * Apply:
 *   npx tsx server/scripts/backfill-job-location.ts --apply
 *
 * Anything ambiguous is deliberately left alone — a wrong country on a live
 * posting is worse than no country, and the job settings page now prompts the
 * recruiter to fix what this cannot.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import * as schema from '../database/schema'
import { job } from '../database/schema'
import { formatJobLocation } from '../../shared/job-location'
import { resolvePlaceLabel } from '../utils/geo/search'

const processWithLoadEnv = process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }
if (!process.env.DATABASE_URL && typeof processWithLoadEnv.loadEnvFile === 'function') {
  try { processWithLoadEnv.loadEnvFile('.env') } catch {}
}

const apply = process.argv.includes('--apply')

const DATABASE_URL = process.env.DATABASE_URL ?? ''
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it in .env or export it.')
  process.exit(1)
}

const client = postgres(DATABASE_URL, { max: 1 })
const db = drizzle(client, { schema })

/**
 * Strip the noise recruiters append to a typed location — "(Hybrid)",
 * "- Remote", trailing punctuation — before trying to resolve it.
 */
function cleanLocationText(raw: string): string {
  return raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(remote|hybrid|on-?site|full[- ]time|part[- ]time)\b/gi, ' ')
    .replace(/[|/–—-]+\s*$/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/[\s,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  const rows = await db.select({
    id: job.id,
    title: job.title,
    location: job.location,
  })
    .from(job)
    .where(and(isNotNull(job.location), isNull(job.locationCountry)))

  console.log(`${rows.length} job(s) with free-text location and no country.\n`)

  const matched: { id: string, from: string, to: string }[] = []
  const unresolved: { id: string, title: string, location: string }[] = []

  for (const row of rows) {
    const raw = row.location?.trim()
    if (!raw) continue

    const cleaned = cleanLocationText(raw)
    // Try the whole string first, then progressively drop trailing segments:
    // "Berlin, Germany (Hybrid)" → "Berlin, Germany", "Oslo, Norway HQ" → "Oslo".
    const segments = cleaned.split(',').map(part => part.trim()).filter(Boolean)
    let place = null
    for (let take = segments.length; take > 0 && !place; take -= 1) {
      place = resolvePlaceLabel(segments.slice(0, take).join(', '))
    }

    if (!place) {
      unresolved.push({ id: row.id, title: row.title, location: raw })
      continue
    }

    const label = formatJobLocation(place)
    matched.push({ id: row.id, from: raw, to: label })

    if (apply) {
      await db.update(job).set({
        locationCity: place.city,
        locationRegion: place.region,
        locationCountry: place.country,
        location: label,
        updatedAt: new Date(),
      }).where(eq(job.id, row.id))
    }
  }

  for (const m of matched) console.log(`  ✓ ${JSON.stringify(m.from)} → ${JSON.stringify(m.to)}`)
  if (unresolved.length) {
    console.log('\nLeft alone (ambiguous or unknown — recruiter is prompted in job settings):')
    for (const u of unresolved) console.log(`  · ${JSON.stringify(u.location)}  (${u.title})`)
  }

  console.log(`\n${matched.length} matched, ${unresolved.length} unresolved.`)
  console.log(apply ? 'Applied.' : 'Dry run — re-run with --apply to write.')

  await client.end()
}

main().catch(async (err) => {
  console.error(err)
  await client.end().catch(() => {})
  process.exit(1)
})
