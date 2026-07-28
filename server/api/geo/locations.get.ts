import { z } from 'zod'
import { PLACE_SEARCH_LIMIT, searchPlaces } from '../../utils/geo/search'

const geoQuerySchema = z.object({
  q: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(PLACE_SEARCH_LIMIT).default(PLACE_SEARCH_LIMIT),
})

/**
 * GET /api/geo/locations?q=oslo
 *
 * Typeahead for the job-location picker. Reads a static bundled dataset, so
 * there is no database access and nothing org-scoped here — but it is still
 * behind `job: ['create']` because it exists only to serve the job forms, and
 * an unauthenticated search endpoint is free scraping for anyone who wants the
 * dataset without the attribution.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { job: ['create'] })

  const { q, limit } = await getValidatedQuery(event, geoQuerySchema.parse)
  return searchPlaces(q, limit)
})
