import type { Ref } from 'vue'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'
import type { PropertyFilter } from '~~/shared/properties'

/**
 * Composable for managing the applications list with filtering, pagination, and mutations.
 * Wraps `useFetch('/api/applications')` with a singleton key for shared state.
 */
export function useApplications(options?: {
  page?: Ref<number | undefined> | number
  limit?: Ref<number | undefined> | number
  jobId?: Ref<string | undefined> | string
  candidateId?: Ref<string | undefined> | string
  status?: Ref<string | undefined> | string
  /** 'unviewed' | 'viewed' — read receipts for the signed-in user */
  viewed?: Ref<string | undefined> | string
  propertyFilters?: Ref<PropertyFilter[] | undefined> | PropertyFilter[]
}) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()

  const query = computed(() => {
    const pf = toValue(options?.propertyFilters)
    return {
      ...(toValue(options?.page) && { page: toValue(options?.page) }),
      ...(toValue(options?.limit) && { limit: toValue(options?.limit) }),
      ...(toValue(options?.jobId) && { jobId: toValue(options?.jobId) }),
      ...(toValue(options?.candidateId) && { candidateId: toValue(options?.candidateId) }),
      ...(toValue(options?.status) && { status: toValue(options?.status) }),
      ...(toValue(options?.viewed) && { viewed: toValue(options?.viewed) }),
      ...(pf && pf.length > 0 && { propertyFilters: JSON.stringify(pf) }),
    }
  })

  const { data, status: fetchStatus, error, refresh } = useFetch('/api/applications', {
    key: 'applications',
    query,
    headers: useRequestHeaders(['cookie']),
  })

  const applications = computed(() => data.value?.data ?? [])
  const total = computed(() => data.value?.total ?? 0)

  /** Create a new application (link candidate → job) and refresh the list */
  async function createApplication(payload: {
    candidateId: string
    jobId: string
    notes?: string
  }) {
    try {
      const created = await $fetch('/api/applications', {
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

  return {
    applications,
    total,
    fetchStatus,
    error,
    refresh,
    createApplication,
  }
}
