/**
 * Composable for the recruiter dashboard — fetches aggregated stats,
 * pipeline breakdown, recent applications, and top active jobs.
 * Read-only: no mutation methods needed.
 */
export function useDashboard() {
  const { data, status: fetchStatus, error, refresh } = useFetch('/api/dashboard/stats', {
    key: 'dashboard-stats',
    headers: useRequestHeaders(['cookie']),
  })

  /**
   * Summary counts. `unviewedApplications` is per signed-in user — applicants
   * this person has never opened, not the size of the `new` stage.
   */
  const counts = computed(() => data.value?.counts ?? {
    openJobs: 0,
    totalCandidates: 0,
    totalApplications: 0,
    unviewedApplications: 0,
    unansweredReplies: 0,
  })

  /** Application count per status */
  const pipeline = computed(() => data.value?.pipeline ?? {
    new: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    hired: 0,
    rejected: 0,
  })

  /** Job count per status */
  const jobsByStatus = computed(() => data.value?.jobsByStatus ?? {
    draft: 0,
    open: 0,
    closed: 0,
    archived: 0,
  })

  /** Last 10 applications with candidate + job info */
  const recentApplications = computed(() => data.value?.recentApplications ?? [])

  /** Top 5 open jobs sorted by application count */
  const topJobs = computed(() => data.value?.topJobs ?? [])

  /**
   * Up to 5 candidate threads whose newest message is inbound — replies nobody
   * has answered yet. `counts.unansweredReplies` is the untruncated total.
   */
  const unansweredReplies = computed(() => data.value?.unansweredReplies ?? [])

  return {
    counts,
    pipeline,
    jobsByStatus,
    recentApplications,
    topJobs,
    unansweredReplies,
    fetchStatus,
    error,
    refresh,
  }
}
