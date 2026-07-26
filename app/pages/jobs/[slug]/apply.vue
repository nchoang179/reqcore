<script setup lang="ts">
import { Briefcase } from 'lucide-vue-next'

definePageMeta({
  layout: 'public',
})

const route = useRoute()
const jobSlug = route.params.slug as string
const { track } = useTrack()
const { t } = useI18n()

/**
 * Read a single value from a query param. Job boards and ad platforms re-append
 * tracking params (`?ref=a&ref=b`), which Vue Router surfaces as an array — send
 * one string so attribution never blocks the submission.
 */
function firstQueryValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value.find((v) => typeof v === 'string' && v.length > 0) : value
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

// Capture source tracking params from the URL
const sourceRef = firstQueryValue(route.query.ref)
const utmSource = firstQueryValue(route.query.utm_source)
const utmMedium = firstQueryValue(route.query.utm_medium)
const utmCampaign = firstQueryValue(route.query.utm_campaign)
const utmTerm = firstQueryValue(route.query.utm_term)
const utmContent = firstQueryValue(route.query.utm_content)

onMounted(() => track('application_started', { slug: jobSlug }))

// Fetch public job data (no auth needed)
const { data: job, status: fetchStatus, error: fetchError } = useFetch(
  `/api/public/jobs/${jobSlug}`,
  { key: `public-job-${jobSlug}` },
)

useSeoMeta({
  title: computed(() => job.value ? `${t('jobs.apply.metaApplyPrefix')} — ${job.value.title}` : t('jobs.apply.metaTitleFallback')),
  description: computed(() => job.value?.description?.slice(0, 160) ?? t('jobs.apply.metaDescriptionFallback')),
  robots: 'noindex, nofollow',
})

// ─────────────────────────────────────────────
// Form state
// ─────────────────────────────────────────────

const form = ref({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  website: '', // honeypot
})

// Dynamic question responses: questionId → value
const responses = ref<Record<string, string | string[] | number | boolean>>({})

// File uploads: questionId → File object
const fileUploads = ref<Record<string, File>>({})

// Built-in document uploads (resume) and cover letter text
const resumeFile = ref<File | null>(null)
const coverLetterText = ref('')

const isSubmitting = ref(false)
const errors = ref<Record<string, string>>({})
const submitError = ref<string | null>(null)

/** Whether the form has any file_upload type questions OR built-in document fields */
const hasFileQuestions = computed(() => {
  const hasCustomFileQ = job.value?.questions?.some((q: { type: string }) => q.type === 'file_upload') ?? false
  const hasBuiltInFiles = !!resumeFile.value
  return hasCustomFileQ || hasBuiltInFiles
})

/**
 * Handle file selection from DynamicField.
 * Stores the File object separately from the model value.
 */
function handleFileSelected(questionId: string, file: File | null) {
  if (file) {
    fileUploads.value[questionId] = file
  } else {
    delete fileUploads.value[questionId]
  }
}

function validate(): boolean {
  errors.value = {}
  const maxSize = 10 * 1024 * 1024

  if (!form.value.firstName.trim()) errors.value.firstName = t('jobs.apply.validation.firstNameRequired')
  if (!form.value.lastName.trim()) errors.value.lastName = t('jobs.apply.validation.lastNameRequired')
  if (!form.value.email.trim()) {
    errors.value.email = t('jobs.apply.validation.emailRequired')
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.email)) {
    errors.value.email = t('jobs.apply.validation.emailInvalid')
  }
  if (job.value?.phoneRequirement === 'required' && !form.value.phone.trim()) {
    errors.value.phone = t('jobs.apply.validation.phoneRequired')
  }

  // Validate required resume
  if (job.value?.requireResume && !resumeFile.value) {
    errors.value.resume = t('jobs.apply.validation.resumeRequired')
  }

  // Validate required cover letter
  if (job.value?.requireCoverLetter && !coverLetterText.value.trim()) {
    errors.value.coverLetter = t('jobs.apply.validation.coverLetterRequired')
  } else if (coverLetterText.value.length > 10_000) {
    errors.value.coverLetter = t('jobs.apply.validation.coverLetterTooLong')
  }

  // Validate resume file size
  if (resumeFile.value && resumeFile.value.size > maxSize) {
    errors.value.resume = t('jobs.apply.validation.fileTooLarge')
  }

  // Validate required custom questions
  if (job.value?.questions) {
    for (const q of job.value.questions) {
      if (q.required) {
        if (q.type === 'file_upload') {
          // For file uploads, check if a File was selected
          if (!fileUploads.value[q.id]) {
            errors.value[`q-${q.id}`] = t('jobs.apply.validation.fieldRequired')
          }
        } else {
          const val = responses.value[q.id]
          const isEmpty = val === undefined || val === null || val === '' ||
            (Array.isArray(val) && val.length === 0)

          if (isEmpty) {
            errors.value[`q-${q.id}`] = t('jobs.apply.validation.fieldRequired')
          }
        }
      }
    }
  }

  // Validate custom file upload sizes
  for (const [questionId, file] of Object.entries(fileUploads.value)) {
    if (file.size > maxSize) {
      errors.value[`q-${questionId}`] = t('jobs.apply.validation.fileTooLarge')
    }
  }

  return Object.keys(errors.value).length === 0
}

async function handleSubmit() {
  submitError.value = null
  if (!validate()) return

  isSubmitting.value = true
  try {
    // Build responses array from the map (exclude file_upload questions — those go as files)
    const fileQuestionIds = new Set(
      job.value?.questions
        ?.filter((q: { type: string }) => q.type === 'file_upload')
        .map((q: { id: string }) => q.id) ?? [],
    )

    const responseArray = Object.entries(responses.value)
      .filter(([questionId, value]) => {
        if (fileQuestionIds.has(questionId)) return false
        if (value === undefined || value === null || value === '') return false
        if (Array.isArray(value) && value.length === 0) return false
        return true
      })
      .map(([questionId, value]) => ({ questionId, value }))

    // Determine if we need FormData (any files present — custom or built-in)
    const hasAnyFiles = Object.keys(fileUploads.value).length > 0
      || !!resumeFile.value

    if (hasAnyFiles) {
      // Use FormData when files are present
      const formData = new FormData()
      formData.append('firstName', form.value.firstName.trim())
      formData.append('lastName', form.value.lastName.trim())
      formData.append('email', form.value.email.trim())
      if (job.value?.phoneRequirement !== 'hidden' && form.value.phone.trim()) {
        formData.append('phone', form.value.phone.trim())
      }
      if (form.value.website) {
        formData.append('website', form.value.website)
      }

      // Serialize non-file responses as JSON
      formData.append('responses', JSON.stringify(responseArray))

      // Append custom question files
      for (const [questionId, file] of Object.entries(fileUploads.value)) {
        formData.append(`file:${questionId}`, file)
      }

      // Append built-in resume
      if (resumeFile.value) {
        formData.append('resume', resumeFile.value)
      }
      // Append cover letter text
      if (coverLetterText.value.trim()) {
        formData.append('coverLetterText', coverLetterText.value.trim())
      }

      // Source tracking params
      if (sourceRef) formData.append('ref', sourceRef)
      if (utmSource) formData.append('utmSource', utmSource)
      if (utmMedium) formData.append('utmMedium', utmMedium)
      if (utmCampaign) formData.append('utmCampaign', utmCampaign)
      if (utmTerm) formData.append('utmTerm', utmTerm)
      if (utmContent) formData.append('utmContent', utmContent)

      await $fetch(`/api/public/jobs/${jobSlug}/apply`, {
        method: 'POST',
        body: formData,
      })
    } else {
      // No files — use JSON as before
      await $fetch(`/api/public/jobs/${jobSlug}/apply`, {
        method: 'POST',
        body: {
          firstName: form.value.firstName.trim(),
          lastName: form.value.lastName.trim(),
          email: form.value.email.trim(),
          phone: job.value?.phoneRequirement !== 'hidden' ? (form.value.phone.trim() || undefined) : undefined,
          website: form.value.website, // honeypot
          coverLetterText: coverLetterText.value.trim() || undefined,
          responses: responseArray,
          ref: sourceRef,
          utmSource,
          utmMedium,
          utmCampaign,
          utmTerm,
          utmContent,
        },
      })
    }

    track('application_submitted', { slug: jobSlug })
    await navigateTo(`/jobs/${jobSlug}/confirmation`)
  } catch (err: any) {
    const message = err.data?.statusMessage ?? t('jobs.apply.genericError')
    submitError.value = message

    // Surface file-related errors next to the resume field so the user knows what to fix
    const status = err.data?.statusCode ?? err.statusCode
    if (status === 400 && message.toLowerCase().includes('resume')) {
      errors.value.resume = message
    } else if (status === 502 && message.toLowerCase().includes('resume')) {
      errors.value.resume = message
    }

    // Field-level validation failures name their field — show it inline too
    const field = err.data?.data?.field
    if (status === 400 && typeof field === 'string' && field in form.value) {
      errors.value[field] = message
    }
  } finally {
    isSubmitting.value = false
  }
}

</script>

<template>
  <div>
    <!-- Loading skeleton -->
    <div v-if="fetchStatus === 'pending'" class="animate-pulse space-y-4">
      <div class="h-7 w-48 bg-surface-200 dark:bg-surface-800 rounded-lg" />
      <div class="h-5 w-32 bg-surface-200 dark:bg-surface-800 rounded-full" />
      <div class="h-4 w-64 bg-surface-200 dark:bg-surface-800 rounded" />
      <div class="mt-8 h-48 bg-surface-200 dark:bg-surface-800 rounded-xl" />
    </div>

    <!-- Not found / not open -->
    <div v-else-if="fetchError" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="mb-5 flex size-16 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800">
        <Briefcase class="size-7 text-surface-400" />
      </div>
      <h1 class="text-xl font-bold text-surface-900 dark:text-surface-100 mb-2">{{ t('jobs.apply.notFoundTitle') }}</h1>
      <p class="text-sm text-surface-500 mb-6 max-w-xs">
        {{ t('jobs.apply.notFoundBody') }}
      </p>
      <a
        :href="useRuntimeConfig().public.marketingUrl"
        class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors shadow-sm"
      >
        {{ t('jobs.apply.backHome') }}
      </a>
    </div>

    <!-- Application form -->
    <template v-else-if="job">

      <!-- Back link -->
      <NuxtLink
        :to="$localePath(`/jobs/${jobSlug}`)"
        class="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 transition-colors mb-6 group"
      >
        <svg class="size-3.5 transition-transform group-hover:-translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m15 18-6-6 6-6"/>
        </svg>
        {{ t('jobs.apply.backToDetails') }}
      </NuxtLink>

      <PublicJobApplicationHeader :job="job" />

      <!-- Application form card -->
      <ApplicationFormBody
        v-model:form="form"
        v-model:responses="responses"
        v-model:resume="resumeFile"
        v-model:cover-letter="coverLetterText"
        :job="job"
        :errors="errors"
        :submit-error="submitError"
        :is-submitting="isSubmitting"
        @file-selected="handleFileSelected"
        @clear-error="(key) => delete errors[key]"
        @submit="handleSubmit"
      />

      <!-- GDPR privacy notice (org-configurable) -->
      <p
        v-if="job.privacyPolicyText || job.privacyPolicyUrl || job.privacyContactEmail"
        class="mt-6 text-xs leading-relaxed text-surface-400 dark:text-surface-500"
      >
        <template v-if="job.privacyPolicyText">{{ job.privacyPolicyText }} </template>
        <template v-else>
          {{ t('retention.privacy.defaultNotice', { organization: job.organizationName || t('retention.privacy.thisOrganization') }) }}
        </template>
        <a
          v-if="job.privacyPolicyUrl"
          :href="job.privacyPolicyUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-brand-600 hover:underline"
        >{{ t('retention.privacy.policyLink') }}</a><template v-if="job.privacyPolicyUrl && job.privacyContactEmail"> · </template>
        <a
          v-if="job.privacyContactEmail"
          :href="`mailto:${job.privacyContactEmail}`"
          class="text-brand-600 hover:underline"
        >{{ t('retention.privacy.contactLabel') }}: {{ job.privacyContactEmail }}</a>
      </p>
    </template>
  </div>
</template>
