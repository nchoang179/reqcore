/**
 * Nitro plugin: warm the GeoNames place index shortly after boot.
 *
 * Parsing the bundled city dataset and building the search index is a few
 * hundred milliseconds of synchronous work. Left lazy, that cost lands on the
 * first location-picker keystroke after a deploy, stalling every other request
 * in flight while it runs. Doing it here instead moves it to a point where the
 * server has no traffic to stall.
 *
 * `setImmediate` (plus a dynamic import, so the dataset is not parsed while the
 * module graph loads) keeps it off the boot path itself — startup finishes and
 * the port opens first, then the index builds on an otherwise idle event loop.
 */
export default defineNitroPlugin(() => {
  // Skip during build-time prerendering — nothing prerendered searches places,
  // and the build should not pay for the index.
  if (import.meta.prerender) return

  setImmediate(async () => {
    try {
      const startedAt = performance.now()
      const { warmPlaceIndex } = await import('../utils/geo/search')
      warmPlaceIndex()
      logInfo('geo.index_warmed', { duration_ms: Math.round(performance.now() - startedAt) })
    }
    catch (error) {
      // Not fatal — the index just stays lazy and the first search rebuilds it.
      logError('geo.index_warm_failed', {
        error_message: error instanceof Error ? error.message : String(error),
      })
    }
  })
})
