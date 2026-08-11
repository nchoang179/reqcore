import type { Ref } from 'vue'

/**
 * Composable for managing the jobs list with filtering, pagination, and mutations.
 * Wraps `useFetch('/api/jobs')` with a singleton key for shared state.
 */
export function useJobs(options?: {
  status?: Ref<string | undefined> | string
}) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()

  const query = computed(() => ({
    ...(toValue(options?.status) && { status: toValue(options?.status) }),
  }))

  const { data, status: fetchStatus, error, refresh } = useFetch('/api/jobs', {
    key: 'jobs',
    query,
    headers: useRequestHeaders(['cookie']),
  })

  const jobs = computed(() => data.value?.data ?? [])
  const total = computed(() => data.value?.total ?? 0)

  /** Create a new job and refresh the list */
  async function createJob(payload: {
    title: string
    description?: string
    locationCity?: string | null
    locationRegion?: string | null
    locationCountry?: string | null
    locationPostalCode?: string | null
    type?: 'full_time' | 'part_time' | 'contract' | 'internship'
    experienceLevel?: 'junior' | 'mid' | 'senior' | 'lead'
    remoteStatus?: 'remote' | 'hybrid' | 'onsite'
    /** Pay range, as the boards index it. Omitted or null means "not stated". */
    salaryMin?: number | null
    salaryMax?: number | null
    salaryCurrency?: string | null
    salaryUnit?: 'YEAR' | 'MONTH' | 'HOUR' | null
    salaryNegotiable?: boolean
    phoneRequirement?: 'hidden' | 'optional' | 'required'
    requireResume?: boolean
    requireCoverLetter?: boolean
    autoScoreOnApply?: boolean
    status?: 'draft' | 'open'
    /** Whether to syndicate this role to external job boards. Defaults on. */
    distributeToBoards?: boolean
    /** Marks a role created to try the product out — kept off all public surfaces. */
    isTest?: boolean
    questions?: Array<{
      label: string
      type: 'short_text' | 'long_text' | 'single_select' | 'multi_select' | 'number' | 'date' | 'url' | 'checkbox' | 'file_upload'
      description?: string
      required: boolean
      options?: string[]
      displayOrder: number
    }>
    criteria?: Array<{
      key: string
      name: string
      description?: string
      category: 'technical' | 'experience' | 'soft_skills' | 'education' | 'culture' | 'custom'
      maxScore: number
      weight: number
      displayOrder: number
    }>
  }) {
    try {
      const created = await $fetch('/api/jobs', {
        method: 'POST',
        body: payload,
      })
      await refresh()
      return created
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
  }

  /** Delete a job by ID and refresh the list */
  async function deleteJob(id: string) {
    try {
      await $fetch(`/api/jobs/${id}`, { method: 'DELETE' })
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
    await refresh()
  }

  return {
    jobs,
    total,
    fetchStatus,
    error,
    refresh,
    createJob,
    deleteJob,
  }
}
