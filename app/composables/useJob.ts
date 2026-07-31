import type { MaybeRefOrGetter } from 'vue'

/**
 * Composable for a single job detail with update and delete mutations.
 * Wraps `useFetch('/api/jobs/:id')` with a reactive key.
 */
export function useJob(id: MaybeRefOrGetter<string>) {
  const localePath = useLocalePath()
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()
  const jobId = computed(() => toValue(id))

  const { data: job, status, error, refresh } = useFetch(
    () => `/api/jobs/${jobId.value}`,
    {
      key: computed(() => `job-${jobId.value}`),
      headers: useRequestHeaders(['cookie']),
    },
  )

  /** Update job fields (partial) and refresh both detail and list caches */
  async function updateJob(payload: Partial<{
    title: string
    /**
     * A deliberate rename of the public URL — the server moves the slug for any
     * value it receives here, published or not, with nothing redirecting the old
     * one. Send it only when the recruiter actually changed it, and send the
     * editable base without the generated `-a1b2c3d4` suffix.
     */
    slug: string
    description: string | null
    /** Derived from the structured parts server-side — send those, not this. */
    location: string | null
    locationCity: string | null
    locationRegion: string | null
    locationCountry: string | null
    locationPostalCode: string | null
    type: 'full_time' | 'part_time' | 'contract' | 'internship'
    status: 'draft' | 'open' | 'closed' | 'archived'
    salaryMin: number | null
    salaryMax: number | null
    salaryCurrency: string | null
    salaryUnit: 'YEAR' | 'MONTH' | 'HOUR' | null
    salaryNegotiable: boolean
    remoteStatus: 'remote' | 'hybrid' | 'onsite' | null
    validThrough: Date | null
    phoneRequirement: 'hidden' | 'optional' | 'required'
    requireResume: boolean
    requireCoverLetter: boolean
    autoScoreOnApply: boolean
    analysisContext: { coverLetter: boolean, screeningAnswers: boolean, recruiterNotes: boolean }
    experienceLevel: 'junior' | 'mid' | 'senior' | 'lead' | null
    /** Whether to syndicate this role to external job boards. */
    distributeToBoards: boolean
  }>) {
    try {
      const updated = await $fetch(`/api/jobs/${jobId.value}`, {
        method: 'PATCH',
        body: payload,
      })
      await refresh()
      await refreshNuxtData('jobs')
      return updated
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
  }

  /** Delete this job and navigate back to the list */
  async function deleteJob() {
    try {
      await $fetch(`/api/jobs/${jobId.value}`, { method: 'DELETE' })
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
    await refreshNuxtData('jobs')
    await navigateTo(localePath('/dashboard/jobs'))
  }

  return { job, status, error, refresh, updateJob, deleteJob }
}
