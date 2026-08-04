<script setup lang="ts">
import { ArrowLeft, FileText, Loader2, UploadCloud, X } from 'lucide-vue-next'
import { z } from 'zod'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Add Candidate — Reqcore',
  description: 'Add a new candidate to your talent pool',
})

const localePath = useLocalePath()
const { createCandidate } = useCandidates()
const { uploadDocument } = useDocuments()
const { track } = useTrack()
const toast = useToast()

// Form state
const form = ref({
  firstName: '',
  lastName: '',
  displayName: '',
  email: '',
  phone: '',
  gender: '' as '' | 'male' | 'female' | 'other' | 'prefer_not_to_say',
  dateOfBirth: '',
})

const isSubmitting = ref(false)
const errors = ref<Record<string, string>>({})
const submitError = ref<string | null>(null)

// ─────────────────────────────────────────────
// Fill from CV
// ─────────────────────────────────────────────
// Drop a CV and the form is filled from it. The file is held client-side and
// attached to the candidate as their résumé once the record exists — so a bad
// extraction leaves nothing behind, and the recruiter always confirms before
// anything is written. Works with LinkedIn's own "Save to PDF" profile export.

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
    track('candidate_cv_extracted', { fields_filled: filled.length })

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

const formSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  displayName: z.string().max(200).optional(),
  email: z.string().min(1, 'Email is required').email('Invalid email address').max(255),
  phone: z.string().max(50).optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .refine((v) => {
      const d = new Date(v)
      return !isNaN(d.getTime()) && d.getFullYear() >= 1900 && d <= new Date()
    }, 'Must be a valid past date')
    .optional(),
})

function validate(): boolean {
  const result = formSchema.safeParse({
    ...form.value,
    gender: form.value.gender || undefined,
    dateOfBirth: form.value.dateOfBirth || undefined,
    displayName: form.value.displayName || undefined,
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

async function handleSubmit() {
  submitError.value = null
  if (!validate()) return

  isSubmitting.value = true
  try {
    const created = await createCandidate({
      firstName: form.value.firstName,
      lastName: form.value.lastName,
      displayName: form.value.displayName || undefined,
      email: form.value.email,
      phone: form.value.phone || undefined,
      gender: (form.value.gender as 'male' | 'female' | 'other' | 'prefer_not_to_say') || undefined,
      dateOfBirth: form.value.dateOfBirth || undefined,
    })
    track('candidate_added', { from_cv: !!cvFile.value })

    // The candidate exists either way — a failed attachment is worth saying out
    // loud, but it must not look like the candidate wasn't created.
    if (cvFile.value && created?.id) {
      try {
        await uploadDocument(created.id, cvFile.value, 'resume')
      } catch {
        toast.error('Candidate created, but the CV could not be attached', {
          message: 'Open the candidate and upload it again.',
        })
      }
    }

    await navigateTo(localePath('/dashboard/candidates'))
  } catch (err: any) {
    const message = err.data?.statusMessage ?? 'Something went wrong'
    // Show email conflict as a field-level error
    if (err.statusCode === 409 || err.data?.statusCode === 409) {
      errors.value.email = message
    } else {
      submitError.value = message
    }
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <!-- Back link -->
    <NuxtLink
      :to="$localePath('/dashboard/candidates')"
      class="inline-flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 mb-6 transition-colors"
    >
      <ArrowLeft class="size-4" />
      Back to Candidates
    </NuxtLink>

    <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-6">Add Candidate</h1>

    <!-- Server error -->
    <div
      v-if="submitError"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mb-4"
    >
      {{ submitError }}
    </div>

    <!-- Fill from CV -->
    <div class="mb-6">
      <div
        class="rounded-xl border border-dashed px-5 py-6 text-center transition-colors"
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
    </div>

    <form class="space-y-5" @submit.prevent="handleSubmit">
      <!-- First Name -->
      <div>
        <label for="firstName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          First Name <span class="text-danger-500">*</span>
        </label>
        <input
          id="firstName"
          v-model="form.firstName"
          type="text"
          placeholder="e.g. Jane"
          class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          :class="errors.firstName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
        />
        <p v-if="errors.firstName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.firstName }}</p>
      </div>

      <!-- Last Name -->
      <div>
        <label for="lastName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Last Name <span class="text-danger-500">*</span>
        </label>
        <input
          id="lastName"
          v-model="form.lastName"
          type="text"
          placeholder="e.g. Doe"
          class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          :class="errors.lastName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
        />
        <p v-if="errors.lastName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.lastName }}</p>
      </div>

      <!-- Display Name (optional) -->
      <div>
        <label for="displayName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Display Name
          <span class="ml-1 text-xs font-normal text-surface-400">(optional — overrides default name format)</span>
        </label>
        <input
          id="displayName"
          v-model="form.displayName"
          type="text"
          placeholder="e.g. Nguyễn Văn A"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        />
        <p v-if="errors.displayName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.displayName }}</p>
      </div>

      <!-- Email -->
      <div>
        <label for="email" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Email <span class="text-danger-500">*</span>
        </label>
        <input
          id="email"
          v-model="form.email"
          type="email"
          placeholder="e.g. jane.doe@example.com"
          class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          :class="errors.email ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
        />
        <p v-if="errors.email" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.email }}</p>
      </div>

      <!-- Phone -->
      <div>
        <label for="phone" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Phone
        </label>
        <input
          id="phone"
          v-model="form.phone"
          type="tel"
          placeholder="e.g. +1 (555) 123-4567"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        />
      </div>

      <!-- Gender + Date of Birth (side-by-side on wider screens) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <!-- Gender -->
        <div>
          <label for="gender" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
            Gender
          </label>
          <select
            id="gender"
            v-model="form.gender"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          >
            <option value="">Not specified</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </div>

        <!-- Date of Birth -->
        <div>
          <label for="dateOfBirth" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
            Date of Birth
          </label>
          <input
            id="dateOfBirth"
            v-model="form.dateOfBirth"
            type="date"
            :max="new Date().toISOString().split('T')[0]"
            class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            :class="errors.dateOfBirth ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
          />
          <p v-if="errors.dateOfBirth" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.dateOfBirth }}</p>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="isSubmitting"
          class="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {{ isSubmitting ? 'Adding…' : 'Add Candidate' }}
        </button>
        <NuxtLink
          :to="$localePath('/dashboard/candidates')"
          class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
