/**
 * Client-side mirror of the per-user application read receipts.
 *
 * The receipt itself is written server-side by `GET /api/applications/:id`, so
 * nothing here is the source of truth — this only lets a list drop the "not
 * viewed" marker the moment the recruiter opens a candidate, instead of waiting
 * for the next list refetch. Session-scoped and additive: it can hide a marker
 * early, never resurrect one.
 */
export function useApplicationViews() {
  const viewedIds = useState<Set<string>>('application-viewed-ids', () => new Set())

  /** Call when an application's detail has been opened. */
  function markViewedLocally(applicationId: string | null | undefined) {
    if (!applicationId) return
    viewedIds.value.add(applicationId)
  }

  /** True once this user has opened the application — per the server or this session. */
  function isViewed(app: { id: string, viewedAt?: string | Date | null } | null | undefined) {
    if (!app) return false
    return app.viewedAt != null || viewedIds.value.has(app.id)
  }

  return { viewedIds, markViewedLocally, isViewed }
}
