<script setup lang="ts">
import { Banknote, Briefcase, MapPin, Monitor, Smartphone } from 'lucide-vue-next'

type Question = {
  id: string
  type: string
  label: string
  description?: string | null
  required: boolean
  options?: string[] | null
}

type ApplicationForm = {
  phoneRequirement: 'hidden' | 'optional' | 'required'
  requireResume: boolean
  requireCoverLetter: boolean
  questions: Question[]
}

type JobDetails = {
  title?: string
  description?: string
  location?: string
  type?: string
  experienceLevel?: string
  remoteStatus?: string
  salaryMin?: number | null
  salaryMax?: number | null
  salaryCurrency?: string | null
  salaryUnit?: string | null
  salaryNegotiable?: boolean
}

const props = defineProps<{
  applicationForm: ApplicationForm
  jobDetails?: JobDetails
  /** Caps the complete preview, including its toolbar. */
  maxHeight?: string
}>()

const emit = defineEmits<{
  (e: 'edit-field', field: string): void
}>()

const previewMode = ref<'desktop' | 'mobile'>('desktop')
const previewForm = ref({ firstName: '', lastName: '', email: '', phone: '', website: '' })
const previewResponses = ref<Record<string, string | string[] | number | boolean>>({})
const previewResume = ref<File | null>(null)
const previewCover = ref('')

const typeLabels: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
}

const experienceLabels: Record<string, string> = {
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  lead: 'Lead',
}

const workplaceLabels: Record<string, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
}

const previewJob = computed(() => ({
  phoneRequirement: props.applicationForm.phoneRequirement,
  requireResume: props.applicationForm.requireResume,
  requireCoverLetter: props.applicationForm.requireCoverLetter,
  questions: props.applicationForm.questions,
}))

const unitSuffixes: Record<string, string> = {
  YEAR: '/yr',
  MONTH: '/mo',
  HOUR: '/hr',
}

/**
 * The pay chip as a candidate sees it, so what the recruiter types on step 1
 * has somewhere to land in the preview beside it. Deliberately forgiving: this
 * renders a half-filled range while it is still being typed, where the public
 * listing only ever sees a finished one.
 */
const salaryLabel = computed(() => {
  const details = props.jobDetails
  if (!details) return null
  if (details.salaryNegotiable) return 'Negotiable'

  const { salaryMin, salaryMax, salaryCurrency, salaryUnit } = details
  if (salaryMin == null && salaryMax == null) return null

  // The code is free text on the way in, so an unfinished or invented one
  // ("NO", "ZZZ") reaches this mid-keystroke. `Intl` throws on those — falling
  // back to a plain number keeps the preview rendering while it is typed.
  const format = (value: number) => {
    if (salaryCurrency) {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: salaryCurrency, maximumFractionDigits: 0 }).format(value)
      } catch { /* not a currency code yet */ }
    }
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
  }

  const suffix = salaryUnit ? unitSuffixes[salaryUnit] ?? '' : ''
  const range = salaryMin != null && salaryMax != null
    ? `${format(salaryMin)} – ${format(salaryMax)}`
    : salaryMin != null
      ? `From ${format(salaryMin)}`
      : `Up to ${format(salaryMax!)}`
  return `${range}${suffix}`
})

const metadata = computed(() => {
  const details = props.jobDetails
  if (!details) return []

  return [
    details.type ? { label: typeLabels[details.type] ?? details.type, icon: Briefcase } : null,
    details.location ? { label: details.location, icon: MapPin } : null,
    details.remoteStatus ? { label: workplaceLabels[details.remoteStatus] ?? details.remoteStatus, icon: MapPin } : null,
    details.experienceLevel ? { label: experienceLabels[details.experienceLevel] ?? details.experienceLevel, icon: Briefcase } : null,
    salaryLabel.value ? { label: salaryLabel.value, icon: Banknote } : null,
  ].filter((item): item is { label: string; icon: typeof Briefcase } => item !== null)
})
</script>

<template>
  <div
    class="flex min-h-0 flex-col overflow-hidden"
    :style="{ maxHeight: maxHeight ?? 'calc(100dvh - 7rem)' }"
  >
    <div class="mb-3 flex shrink-0 items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
          Live candidate preview
        </p>
      </div>

      <div
        class="inline-flex shrink-0 items-center rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800"
        role="radiogroup"
        aria-label="Preview device"
      >
        <button
          type="button"
          role="radio"
          :aria-checked="previewMode === 'desktop'"
          title="Desktop preview"
          class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all"
          :class="previewMode === 'desktop'
            ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-surface-100'
            : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'"
          @click="previewMode = 'desktop'"
        >
          <Monitor class="size-3.5" />
          Desktop
        </button>
        <button
          type="button"
          role="radio"
          :aria-checked="previewMode === 'mobile'"
          title="Mobile preview"
          class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all"
          :class="previewMode === 'mobile'
            ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-surface-100'
            : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'"
          @click="previewMode = 'mobile'"
        >
          <Smartphone class="size-3.5" />
          Mobile
        </button>
      </div>
    </div>

    <div class="min-h-0 overscroll-contain overflow-y-auto rounded-2xl bg-surface-50 dark:bg-surface-950/40">
      <div class="mx-auto space-y-4 transition-all" :class="previewMode === 'mobile' ? 'max-w-sm' : 'max-w-full'">
        <div class="overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <div class="p-5">
            <div v-if="metadata.length" class="mb-3 flex flex-wrap gap-2">
              <span
                v-for="item in metadata"
                :key="item.label"
                class="inline-flex items-center gap-1.5 rounded-full border border-surface-200 bg-surface-50 px-2.5 py-1 text-xs font-medium text-surface-600 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300"
              >
                <component :is="item.icon" class="size-3 text-surface-400" />
                {{ item.label }}
              </span>
            </div>

            <h2 class="text-xl font-bold tracking-tight text-surface-900 dark:text-surface-50">
              {{ jobDetails?.title || 'Your job title will appear here' }}
            </h2>

            <div class="mt-4 border-t border-surface-100 pt-4 dark:border-surface-800">
              <MarkdownDescription
                v-if="jobDetails?.description"
                :value="jobDetails.description"
              />
              <p v-else class="text-sm italic text-surface-400 dark:text-surface-500">
                Add a job description to preview the role candidates will see.
              </p>
            </div>
          </div>
        </div>

        <ApplicationFormBody
          v-model:form="previewForm"
          v-model:responses="previewResponses"
          v-model:resume="previewResume"
          v-model:cover-letter="previewCover"
          :job="previewJob"
          mode="preview"
          @edit-field="emit('edit-field', $event)"
        />
      </div>
    </div>
  </div>
</template>
