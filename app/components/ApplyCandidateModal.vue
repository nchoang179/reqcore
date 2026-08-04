<script setup lang="ts">
import { Search, X, UserPlus, FileText, Loader2, UploadCloud } from 'lucide-vue-next'
import { z } from 'zod'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

const props = withDefaults(defineProps<{
  jobId: string
  teleportTarget?: string | HTMLElement
}>(), {
  teleportTarget: 'body',
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created'): void
}>()

const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const { formatCandidateName } = useOrgSettings()
const { uploadDocument } = useDocuments()
const { track } = useTrack()
const toast = useToast()

// Someone who isn't in the pool yet used to mean leaving the job, creating the
// candidate, coming back and searching for them. Both paths live here instead,
// and either one ends with the candidate on this job.
const mode = ref<'search' | 'new'>('search')

// ─────────────────────────────────────────────
// Search existing candidates
// ─────────────────────────────────────────────

const searchInput = ref('')
const debouncedSearch = ref<string | undefined>(undefined)

let debounceTimer: ReturnType<typeof setTimeout>
watch(searchInput, (val) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = val.trim() || undefined
  }, 300)
})

const { data: candidateData, status: searchStatus, refresh: refreshSearch } = useFetch('/api/candidates', {
  key: 'apply-candidate-search',
  query: computed(() => ({
    ...(debouncedSearch.value && { search: debouncedSearch.value }),
    limit: 20,
  })),
  headers: useRequestHeaders(['cookie']),
})

const candidates = computed(() => candidateData.value?.data ?? [])

// An empty pool has nothing to search — open straight on the form instead.
const hasChosenMode = ref(false)
watch([searchStatus, candidateData], () => {
  if (hasChosenMode.value || searchStatus.value !== 'success') return
  hasChosenMode.value = true
  if (!debouncedSearch.value && candidates.value.length === 0) mode.value = 'new'
}, { immediate: true })

function switchMode(next: 'search' | 'new') {
  hasChosenMode.value = true
  mode.value = next
}

// ─────────────────────────────────────────────
// Apply
// ─────────────────────────────────────────────

const isApplying = ref(false)
const applyError = ref('')

async function applyCandidate(candidateId: string) {
  isApplying.value = true
  applyError.value = ''
  try {
    await $fetch('/api/applications', {
      method: 'POST',
      body: { candidateId, jobId: props.jobId },
    })
    emit('created')
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    applyError.value = err.data?.statusMessage ?? 'Failed to apply candidate'
  } finally {
    isApplying.value = false
  }
}

// ─────────────────────────────────────────────
// New candidate
// ─────────────────────────────────────────────

const form = ref({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
})

const errors = ref<Record<string, string>>({})
const createError = ref<string | null>(null)
const duplicateEmail = ref<string | null>(null)
const isCreating = ref(false)

// Fill from CV — same deal as the standalone add-candidate page: the file is
// held client-side and only attached once the candidate record exists, so a bad
// extraction leaves no candidate and no orphaned upload behind.

const CV_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const CV_MAX_BYTES = 10 * 1024 * 1024

const cvFile = ref<File | null>(null)
const isExtracting = ref(false)
const cvError = ref<string | null>(null)
const isDraggingCv = ref(false)
const filledFields = ref<string[]>([])

/** `.doc` files report an empty or generic MIME type in some browsers. */
function looksLikeCv(file: File) {
  return CV_MIME_TYPES.includes(file.type) || /\.(pdf|docx?)$/i.test(file.name)
}

async function handleCvFile(file: File | null | undefined) {
  if (!file) return

  cvError.value = null
  filledFields.value = []

  if (!looksLikeCv(file)) {
    cvError.value = 'That file type isn\'t supported. Use a PDF, DOC, or DOCX.'
    return
  }
  if (file.size > CV_MAX_BYTES) {
    cvError.value = `That file is too large. Maximum size is ${CV_MAX_BYTES / 1024 / 1024} MB.`
    return
  }

  isExtracting.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)

    const extracted = await $fetch<{
      firstName: string | null
      lastName: string | null
      email: string | null
      phone: string | null
    }>('/api/candidates/extract-cv', { method: 'POST', body: formData })

    // Only overwrite fields the CV actually answered — anything already typed
    // stays put when the document is silent on it.
    const filled: string[] = []
    for (const field of ['firstName', 'lastName', 'email', 'phone'] as const) {
      const value = extracted[field]?.trim()
      if (value) {
        form.value[field] = value
        filled.push(field)
      }
    }

    cvFile.value = file
    filledFields.value = filled
    errors.value = {}
    track('candidate_cv_extracted', { fields_filled: filled.length, source: 'job_pipeline' })

    if (filled.length === 0) {
      cvError.value = 'Couldn\'t find contact details in that file. Fill the form in below — the CV will still be attached.'
    }
  } catch (err: any) {
    cvError.value = err.data?.statusMessage ?? 'Couldn\'t read that file. Fill the form in manually instead.'
  } finally {
    isExtracting.value = false
  }
}

function onCvDrop(event: DragEvent) {
  isDraggingCv.value = false
  handleCvFile(event.dataTransfer?.files?.[0])
}

function onCvSelected(event: Event) {
  const input = event.target as HTMLInputElement
  handleCvFile(input.files?.[0])
  // Reset so re-picking the same file fires `change` again.
  input.value = ''
}

function clearCv() {
  cvFile.value = null
  cvError.value = null
  filledFields.value = []
}

// ─────────────────────────────────────────────
// New candidate — create and apply
// ─────────────────────────────────────────────

const formSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().min(1, 'Email is required').email('Invalid email address').max(255),
  phone: z.string().max(50).optional(),
})

function validate(): boolean {
  const result = formSchema.safeParse({
    ...form.value,
    phone: form.value.phone || undefined,
  })
  if (!result.success) {
    errors.value = {}
    for (const issue of result.error.issues) {
      const field = issue.path[0]?.toString()
      if (field) errors.value[field] = issue.message
    }
    return false
  }
  errors.value = {}
  return true
}

/** Take the duplicate email over to the search tab so they can be applied. */
function findDuplicate() {
  if (!duplicateEmail.value) return
  searchInput.value = duplicateEmail.value
  duplicateEmail.value = null
  switchMode('search')
}

async function createAndApply() {
  createError.value = null
  duplicateEmail.value = null
  if (!validate()) return

  isCreating.value = true
  try {
    const created = await $fetch('/api/candidates', {
      method: 'POST',
      body: {
        firstName: form.value.firstName,
        lastName: form.value.lastName,
        email: form.value.email,
        phone: form.value.phone || undefined,
      },
    })
    track('candidate_added', { from_cv: !!cvFile.value, source: 'job_pipeline' })

    // The candidate exists from here on. Neither a failed upload nor a failed
    // application should read as "nothing happened" — say what went wrong and
    // leave the record in place.
    if (cvFile.value) {
      try {
        await uploadDocument(created.id, cvFile.value, 'resume')
      } catch {
        toast.error('Candidate created, but the CV could not be attached', {
          message: 'Open the candidate and upload it again.',
        })
      }
    }

    try {
      await $fetch('/api/applications', {
        method: 'POST',
        body: { candidateId: created.id, jobId: props.jobId },
      })
    } catch (err: any) {
      // The candidate is in the pool either way — say so, and leave the search
      // tab as the way to finish the job.
      createError.value = `${created.firstName} ${created.lastName} was created, but adding them to this job failed: ${err.data?.statusMessage ?? 'unknown error'}. Find them under "From your pool" and try again.`
      await refreshSearch()
      return
    }

    await refreshNuxtData('candidates')
    emit('created')
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    const message = err.data?.statusMessage ?? 'Something went wrong'
    const statusCode = err.statusCode ?? err.data?.statusCode
    if (statusCode === 409 && message.includes('email')) {
      errors.value.email = message
      duplicateEmail.value = form.value.email
    } else {
      createError.value = message
    }
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <Teleport :to="teleportTarget">
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50" @click="emit('close')" />
      <div class="relative bg-white dark:bg-surface-900 rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-surface-200 dark:border-surface-800">
          <div class="flex items-center gap-2">
            <UserPlus class="size-5 text-brand-600 dark:text-brand-400" />
            <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Add Candidate</h3>
          </div>
          <button
            class="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
            @click="emit('close')"
          >
            <X class="size-5" />
          </button>
        </div>

        <!-- Mode tabs -->
        <div class="flex gap-1 px-5 pt-4">
          <button
            v-for="tab in [{ id: 'search', label: 'From your pool' }, { id: 'new', label: 'New candidate' }]"
            :key="tab.id"
            class="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="mode === tab.id
              ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
              : 'text-surface-500 hover:bg-surface-50 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200'"
            @click="switchMode(tab.id as 'search' | 'new')"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- ── From your pool ── -->
        <template v-if="mode === 'search'">
          <!-- Search -->
          <div class="px-5 pt-3">
            <div class="relative">
              <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-surface-400" />
              <input
                v-model="searchInput"
                type="text"
                placeholder="Search candidates by name or email…"
                class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 pl-10 pr-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              />
            </div>
          </div>

          <!-- Error -->
          <div v-if="applyError" class="mx-5 mt-3 rounded-lg border border-danger-200 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400">
            {{ applyError }}
          </div>

          <!-- Candidate list -->
          <div class="flex-1 overflow-y-auto px-5 py-3">
            <div v-if="searchStatus === 'pending'" class="text-center py-6 text-surface-400 text-sm">
              Searching…
            </div>

            <div v-else-if="candidates.length === 0" class="py-6 text-center">
              <p class="text-sm text-surface-400">
                {{ debouncedSearch ? 'No candidates found.' : 'No candidates in your org yet.' }}
              </p>
              <button
                class="mt-2 cursor-pointer text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                @click="switchMode('new')"
              >
                Add a new candidate instead
              </button>
            </div>

            <div v-else class="space-y-1">
              <button
                v-for="c in candidates"
                :key="c.id"
                :disabled="isApplying"
                class="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
                @click="applyCandidate(c.id)"
              >
                <div class="min-w-0">
                  <p class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                    {{ formatCandidateName(c) }}
                  </p>
                  <p class="text-xs text-surface-400 truncate">{{ c.email }}</p>
                </div>
                <span class="text-xs text-brand-600 dark:text-brand-400 font-medium shrink-0 ml-2">
                  Apply
                </span>
              </button>
            </div>
          </div>
        </template>

        <!-- ── New candidate ── -->
        <template v-else>
          <div class="flex-1 overflow-y-auto px-5 py-3">
            <!-- Server error -->
            <div
              v-if="createError"
              class="mb-4 rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400"
            >
              {{ createError }}
            </div>

            <!-- Fill from CV -->
            <div
              class="rounded-xl border border-dashed px-4 py-5 text-center transition-colors"
              :class="isDraggingCv
                ? 'border-brand-400 bg-brand-50/60 dark:border-brand-600 dark:bg-brand-950/30'
                : 'border-surface-300 bg-surface-50/60 dark:border-surface-700 dark:bg-surface-900/40'"
              @dragover.prevent="isDraggingCv = true"
              @dragleave.prevent="isDraggingCv = false"
              @drop.prevent="onCvDrop"
            >
              <!-- Extracting -->
              <div v-if="isExtracting" class="flex items-center justify-center gap-2 text-sm text-surface-600 dark:text-surface-300">
                <Loader2 class="size-4 animate-spin" />
                Reading the CV…
              </div>

              <!-- Attached -->
              <div v-else-if="cvFile" class="flex items-center justify-center gap-3">
                <FileText class="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
                <div class="min-w-0 text-left">
                  <p class="truncate text-sm font-medium text-surface-800 dark:text-surface-200">{{ cvFile.name }}</p>
                  <p class="text-xs text-surface-500 dark:text-surface-400">
                    {{ filledFields.length > 0
                      ? `Filled ${filledFields.length} field${filledFields.length === 1 ? '' : 's'} — check them below.`
                      : 'Will be attached as their résumé.' }}
                  </p>
                </div>
                <button
                  type="button"
                  class="ml-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200"
                  aria-label="Remove CV"
                  @click="clearCv"
                >
                  <X class="size-4" />
                </button>
              </div>

              <!-- Empty -->
              <div v-else>
                <UploadCloud class="mx-auto size-5 text-surface-400 dark:text-surface-500" />
                <p class="mt-2 text-sm font-medium text-surface-700 dark:text-surface-300">
                  Drop a CV to fill this in
                </p>
                <p class="mt-1 text-xs text-surface-500 dark:text-surface-400">
                  PDF, DOC, or DOCX — including a LinkedIn profile saved as PDF.
                </p>
                <label class="mt-3 inline-flex cursor-pointer items-center rounded-lg border border-surface-300 bg-white px-3 py-1.5 text-xs font-medium text-surface-700 transition-colors hover:bg-surface-50 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300 dark:hover:bg-surface-800">
                  Choose a file
                  <input type="file" accept=".pdf,.doc,.docx" class="sr-only" @change="onCvSelected" />
                </label>
              </div>
            </div>

            <p v-if="cvError" class="mt-2 text-xs text-warning-700 dark:text-warning-400">{{ cvError }}</p>

            <form id="new-candidate-form" class="mt-4 space-y-4" @submit.prevent="createAndApply">
              <!-- Name -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="apply-firstName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    First Name <span class="text-danger-500">*</span>
                  </label>
                  <input
                    id="apply-firstName"
                    v-model="form.firstName"
                    type="text"
                    placeholder="e.g. Jane"
                    class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    :class="errors.firstName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
                  />
                  <p v-if="errors.firstName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.firstName }}</p>
                </div>
                <div>
                  <label for="apply-lastName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    Last Name <span class="text-danger-500">*</span>
                  </label>
                  <input
                    id="apply-lastName"
                    v-model="form.lastName"
                    type="text"
                    placeholder="e.g. Doe"
                    class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    :class="errors.lastName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
                  />
                  <p v-if="errors.lastName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.lastName }}</p>
                </div>
              </div>

              <!-- Email -->
              <div>
                <label for="apply-email" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Email <span class="text-danger-500">*</span>
                </label>
                <input
                  id="apply-email"
                  v-model="form.email"
                  type="email"
                  placeholder="e.g. jane.doe@example.com"
                  class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  :class="errors.email ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
                />
                <p v-if="errors.email" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.email }}</p>
                <button
                  v-if="duplicateEmail"
                  type="button"
                  class="mt-1 cursor-pointer text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                  @click="findDuplicate"
                >
                  Find them in your pool and apply them instead
                </button>
              </div>

              <!-- Phone -->
              <div>
                <label for="apply-phone" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Phone
                </label>
                <input
                  id="apply-phone"
                  v-model="form.phone"
                  type="tel"
                  placeholder="e.g. +1 (555) 123-4567"
                  class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                />
              </div>
            </form>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-2 border-t border-surface-200 dark:border-surface-800 px-5 py-3">
            <button
              type="button"
              class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="emit('close')"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="new-candidate-form"
              :disabled="isCreating || isExtracting"
              class="inline-flex cursor-pointer items-center rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {{ isCreating ? 'Adding…' : 'Add to this job' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
