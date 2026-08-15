<script setup lang="ts">
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Plus,
  Trash2,
  ChevronRight,
  ArrowRight,
  Link2,
  Rocket,
  FileEdit,
  ExternalLink,
  PartyPopper,
  Eye,
  Briefcase,
  FileText,
  MessageSquare,
  Brain,
  Sparkles,
  Loader2,
  SlidersHorizontal,
  Share2,
  Globe2,
  FlaskConical,
  Banknote,
} from 'lucide-vue-next'
import { z } from 'zod'
import type { LocationSelection } from '~/components/LocationCombobox.vue'
import { formatJobLocation, isValidPostalCode, normalizePostalCode, POSTAL_CODE_MAX_LENGTH } from '~~/shared/job-location'
import { descriptionLength, missingPublishRequirements, MIN_DESCRIPTION_CHARS } from '~~/shared/job-publish'
import { slugifyJobBase } from '~~/shared/job-slug'
import {
  SAMPLE_JOB_FORM,
  SAMPLE_JOB_QUESTIONS,
  SAMPLE_SCORING_CRITERIA,
} from '~~/shared/sample-job'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
  fullbleed: true,
})

useSeoMeta({
  title: 'Create Job — Reqcore',
  description: 'Create a new job posting',
})

const localePath = useLocalePath()
const route = useRoute()
const { createJob } = useJobs()
const { track } = useTrack()
const toast = useToast()

// Only owners/admins can change billing — drives the upgrade CTA in the
// active-role limit upsell modal (server enforces this too).
const { allowed: canManageBilling } = usePermission({ organization: ['update'] })

// Shown when a free org hits its active-role cap on publish. `limitUpsellMax`
// is the org's current open-role allowance, surfaced by the 402 from the API.
const showLimitUpsell = ref(false)
const limitUpsellMax = ref(1)

type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'
  | 'number'
  | 'date'
  | 'url'
  | 'checkbox'
  | 'file_upload'

type DraftQuestion = {
  id: string
  label: string
  type: QuestionType
  description?: string | null
  required: boolean
  options?: string[] | null
}

// Wizard state
const currentStep = ref<1 | 2 | 3 | 4>(1)
const wizardEditor = useTemplateRef<HTMLElement>('wizardEditor')
const steps = [
  { id: 1, title: 'Job details', description: 'Tell applicants about this role.' },
  { id: 2, title: 'Application form', description: 'Design the application form.' },
  { id: 3, title: 'AI scoring criteria', description: 'Define how AI evaluates candidates.' },
  { id: 4, title: 'Publish & distribute', description: 'Go live and share across job boards.' },
]

// Step 1: Job details (API-supported fields)
const form = ref({
  title: '',
  description: '',
  // Structured location. The free-text `job.location` display string is derived
  // from these server-side, so the wizard never sends one.
  locationCity: null as string | null,
  locationRegion: null as string | null,
  locationCountry: null as string | null,
  locationPostalCode: null as string | null,
  type: 'full_time' as 'full_time' | 'part_time' | 'contract' | 'internship',
  experienceLevel: 'mid' as 'junior' | 'mid' | 'senior' | 'lead',
  remoteStatus: undefined as 'remote' | 'hybrid' | 'onsite' | undefined,
  // Compensation. Optional, but the single biggest lever on how a listing
  // performs once it reaches the boards — Google Jobs surfaces a pay range and
  // most aggregators sort or filter on one.
  salaryMin: null as number | null,
  salaryMax: null as number | null,
  salaryCurrency: null as string | null,
  salaryUnit: 'YEAR' as 'YEAR' | 'MONTH' | 'HOUR' | null,
  salaryNegotiable: false,
})

/**
 * A range and "negotiable" are two different answers to the same question, so
 * turning negotiable on drops the range rather than leaving a hidden one behind
 * to reappear if it is turned back off.
 */
watch(() => form.value.salaryNegotiable, (negotiable) => {
  if (!negotiable) return
  form.value.salaryMin = null
  form.value.salaryMax = null
})

/**
 * Compensation is folded away by default: most roles are filled in without it,
 * and it sits between the title and the description, which are the two fields
 * everyone is here to write.
 *
 * It opens itself whenever there is something to see or fix — a restored draft
 * that states pay, and any salary problem, since a blocker hidden inside a
 * closed panel is a disabled Next button with no visible cause.
 */
const showCompensation = ref(false)

const hasSalaryDetails = computed(() =>
  form.value.salaryNegotiable || form.value.salaryMin != null || form.value.salaryMax != null,
)

/** Adapter between the three flat form fields and the picker's single value. */
const locationSelection = computed<LocationSelection | null>({
  get: () => form.value.locationCountry
    ? { city: form.value.locationCity, region: form.value.locationRegion, country: form.value.locationCountry }
    : null,
  set: (value) => {
    form.value.locationCity = value?.city ?? null
    form.value.locationRegion = value?.region ?? null
    form.value.locationCountry = value?.country ?? null
    // A postal code belongs to the place that was just replaced, so it cannot
    // survive the change — "0150" under a newly picked Berlin is worse than
    // nothing.
    form.value.locationPostalCode = null
  },
})

const locationDisplay = computed(() => formatJobLocation(locationSelection.value))

/** The candidate-facing preview wants the display string, not the parts. */
const previewJobDetails = computed(() => ({
  ...form.value,
  location: locationDisplay.value,
}))

// Step 2: Application form (client-only for now)
const applicationForm = ref({
  phoneRequirement: 'optional' as 'hidden' | 'optional' | 'required',
  requireResume: true,
  requireCoverLetter: false,
  questions: [] as DraftQuestion[],
})

// Step 3: AI scoring criteria
type ScoringCriterionDraft = {
  key: string
  name: string
  description: string
  category: 'technical' | 'experience' | 'soft_skills' | 'education' | 'culture' | 'custom'
  maxScore: number
  weight: number
}
const scoringCriteria = ref<ScoringCriterionDraft[]>([])
const scoringMode = ref<'none' | 'premade' | 'ai' | 'custom'>('none')
const selectedTemplate = ref<'standard' | 'technical' | 'non_technical'>('standard')
const isGeneratingCriteria = ref(false)
const showCustomForm = ref(false)
const showAdvanced = ref(false)
const editingCriterion = ref<ScoringCriterionDraft | null>(null)
/**
 * Ranking every applicant is the reason the criteria exist, so it is on unless
 * it is turned off. It still costs nothing on a job with no criteria: the
 * submit below only sends it when there is a rubric to score against, and the
 * scorer itself bails on a job with none.
 */
const autoScoreOnApply = ref(true)

const customCriterionForm = ref({
  key: '',
  name: '',
  description: '',
  category: 'custom' as ScoringCriterionDraft['category'],
  maxScore: 10,
  weight: 50,
})

const categoryLabels: Record<string, string> = {
  technical: 'Technical',
  experience: 'Experience',
  soft_skills: 'Soft Skills',
  education: 'Education',
  culture: 'Culture',
  custom: 'Custom',
}

const categoryColorClasses: Record<string, string> = {
  technical: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-800',
  experience: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:ring-purple-800',
  soft_skills: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800',
  education: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800',
  culture: 'bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-950/50 dark:text-pink-300 dark:ring-pink-800',
  custom: 'bg-surface-50 text-surface-700 ring-surface-200 dark:bg-surface-800/50 dark:text-surface-300 dark:ring-surface-700',
}

// Pre-made scoring templates (no API call needed)
const scoringTemplates: Record<'standard' | 'technical' | 'non_technical', ScoringCriterionDraft[]> = {
  standard: [
    { key: 'technical_skills', name: 'Technical Skills', description: 'Evaluate the candidate\'s technical competencies against the job requirements.', category: 'technical', maxScore: 10, weight: 50 },
    { key: 'relevant_experience', name: 'Relevant Experience', description: 'Assess years and quality of experience directly relevant to the role.', category: 'experience', maxScore: 10, weight: 50 },
    { key: 'education_fit', name: 'Education & Certifications', description: 'Evaluate educational background and certifications relevant to the position.', category: 'education', maxScore: 10, weight: 30 },
  ],
  technical: [
    { key: 'core_tech_stack', name: 'Core Tech Stack Match', description: 'How well the candidate\'s technical skills match the primary technologies.', category: 'technical', maxScore: 10, weight: 70 },
    { key: 'system_design', name: 'System Design & Architecture', description: 'Evidence of system design experience and architectural decision-making.', category: 'technical', maxScore: 10, weight: 50 },
    { key: 'engineering_practices', name: 'Engineering Practices', description: 'Testing, CI/CD, code review, and software development lifecycle experience.', category: 'technical', maxScore: 10, weight: 40 },
    { key: 'relevant_experience', name: 'Relevant Experience', description: 'Years and depth of experience in similar roles or domains.', category: 'experience', maxScore: 10, weight: 50 },
    { key: 'leadership_collab', name: 'Leadership & Collaboration', description: 'Evidence of mentoring, tech leadership, and cross-team collaboration.', category: 'soft_skills', maxScore: 10, weight: 30 },
  ],
  non_technical: [
    { key: 'relevant_experience', name: 'Relevant Experience', description: 'Depth and breadth of experience applicable to the role.', category: 'experience', maxScore: 10, weight: 60 },
    { key: 'communication', name: 'Communication Skills', description: 'Evidence of written and verbal communication ability.', category: 'soft_skills', maxScore: 10, weight: 50 },
    { key: 'domain_knowledge', name: 'Domain Knowledge', description: 'Relevant industry or domain expertise.', category: 'experience', maxScore: 10, weight: 40 },
    { key: 'education_fit', name: 'Education & Certifications', description: 'Educational background and certifications relevant to the position.', category: 'education', maxScore: 10, weight: 30 },
    { key: 'culture_fit', name: 'Culture & Values Alignment', description: 'Indicators of alignment with company values and team culture.', category: 'culture', maxScore: 10, weight: 30 },
  ],
}

// Recommend a template from the job title so the default path needs zero decisions.
const TECHNICAL_TITLE_RE = /\b(engineer|developer|programmer|software|data|devops|back[\s-]?end|front[\s-]?end|full[\s-]?stack|sysadmin|sre|architect|scientist|machine learning|ml|ai|qa|security|cloud|infrastructure)\b/i
const recommendedTemplate = computed<'standard' | 'technical' | 'non_technical'>(() =>
  TECHNICAL_TITLE_RE.test(form.value.title) ? 'technical' : 'standard',
)
const recommendedCriteria = computed(() => scoringTemplates[recommendedTemplate.value])

function loadPremadeCriteria(template: 'standard' | 'technical' | 'non_technical') {
  // Clone so per-job weight edits never mutate the shared template objects.
  scoringCriteria.value = scoringTemplates[template].map(c => ({ ...c }))
  scoringMode.value = 'premade'
}

function useRecommendedScoring() {
  selectedTemplate.value = recommendedTemplate.value
  loadPremadeCriteria(recommendedTemplate.value)
}

function skipScoring() {
  scoringCriteria.value = []
  scoringMode.value = 'none'
  showAdvanced.value = false
  nextStep()
}

async function generateAiCriteria() {
  if (!form.value.title) {
    toast.warning('Job title required', 'Add a job title in Step 1 first so AI can generate relevant criteria.')
    return
  }
  if (!form.value.description) {
    toast.warning('Job description required', 'Add a job description in Step 1 first so AI can generate relevant criteria.')
    return
  }
  isGeneratingCriteria.value = true
  try {
    const result = await $fetch('/api/ai-config/generate-criteria', {
      method: 'POST',
      body: {
        title: form.value.title,
        description: form.value.description,
      },
    })
    scoringCriteria.value = (result.criteria ?? []).map((c: any) => ({
      key: c.key,
      name: c.name,
      description: c.description ?? '',
      category: c.category ?? 'custom',
      maxScore: c.maxScore ?? 10,
      weight: c.weight ?? 50,
    }))
    scoringMode.value = 'ai'
    toast.success('Criteria generated', `${scoringCriteria.value.length} scoring criteria created from job description.`)
  } catch (err: any) {
    const statusCode = err?.data?.statusCode ?? err?.statusCode
    const statusMessage = err?.data?.statusMessage ?? ''
    if (statusCode === 422 && statusMessage.includes('AI provider not configured')) {
      toast.add({
        type: 'warning',
        title: 'AI provider not configured',
        message: 'Set up your AI provider and model before generating criteria.',
        link: { label: 'Go to AI Settings', href: '/dashboard/settings/ai' },
        duration: 10000,
      })
    } else {
      toast.error('Failed to generate criteria', {
        message: 'Could not generate criteria. Make sure your AI provider is configured in Settings → AI, then try again.',
        details: statusMessage || `${statusCode ?? 'Unknown'} error — no additional details from server.`,
        statusCode,
      })
    }
  } finally {
    isGeneratingCriteria.value = false
  }
}

/**
 * The criteria this role gets written for it before anyone asks.
 *
 * Step 3 used to open on a choice between a canned template, an AI pass and
 * skipping — a decision nobody has a basis for making about a feature they have
 * not yet seen work. A finished rubric they can read and edit sells the scoring;
 * a button offering to write one does not.
 *
 * It runs at most once per visit to the wizard. Clearing the list to get back to
 * the options is a request for the other paths, not for a rewrite.
 */
const autoCriteriaState = ref<'idle' | 'running' | 'done' | 'failed'>('idle')

/**
 * The writing happens while the user is still on step 2, so without this the
 * finished rubric is simply sitting there when step 3 opens, with nothing to
 * say it was read out of their job description. The list fades in card by card
 * on that first arrival instead of appearing whole.
 */
const criteriaRevealPending = ref(false)
const criteriaRevealing = ref(false)

async function autoGenerateCriteria() {
  if (autoCriteriaState.value !== 'idle') return
  // A restored draft, the sample role, or a set already chosen all arrive with
  // criteria in hand — there is nothing left to write.
  if (scoringCriteria.value.length > 0) return
  // The walkthrough ships its own criteria so the sample shortlist matches them.
  if (isTestMode.value) return
  if (!isAiConfigured.value) return

  const { title, description } = form.value
  if (!title || !description) return

  autoCriteriaState.value = 'running'
  try {
    const result = await $fetch('/api/ai-config/generate-criteria', {
      method: 'POST',
      body: { title, description },
    })
    const generated: ScoringCriterionDraft[] = (result.criteria ?? []).map((c: any) => ({
      key: c.key,
      name: c.name,
      description: c.description ?? '',
      category: c.category ?? 'custom',
      maxScore: c.maxScore ?? 10,
      weight: c.weight ?? 50,
    }))

    // Empty is a failure wearing a 200, and the user may well have picked a
    // template by hand while this was in flight. Either way, leave the step
    // showing what it would have shown without us.
    if (generated.length === 0 || scoringCriteria.value.length > 0) {
      autoCriteriaState.value = 'failed'
      return
    }

    scoringCriteria.value = generated
    scoringMode.value = 'ai'
    autoCriteriaState.value = 'done'
    criteriaRevealPending.value = true
    track('ai_criteria_generated', { criteria_count: generated.length, auto: true })
  } catch {
    // Nobody asked for this, so nothing is said about it failing. Step 3 falls
    // back to the recommended template — the screen it had before.
    autoCriteriaState.value = 'failed'
  }
}

/**
 * Started on the way out of step 1 rather than on arrival at step 3, so the
 * wait hides behind the application-form step instead of being a spinner the
 * user sits and watches.
 *
 * A restored draft sitting past step 3 with an empty list is the one case to
 * leave alone: that user reached the scoring step and chose to skip it, and
 * writing criteria back in would overturn the answer they gave.
 */
watch(currentStep, (step) => {
  if (step >= 2 && step <= 3) autoGenerateCriteria()
})

/** Plays the fade-in once, whenever step 3 is first opened with written criteria. */
watch([currentStep, criteriaRevealPending], () => {
  if (currentStep.value !== 3 || !criteriaRevealPending.value) return
  criteriaRevealPending.value = false
  if (import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  criteriaRevealing.value = true
  setTimeout(() => { criteriaRevealing.value = false }, 1200)
}, { flush: 'post' })

function addCustomCriterion() {
  const f = customCriterionForm.value
  if (scoringCriteria.value.length >= 20) {
    toast.warning('Criteria limit reached', 'You can add up to 20 scoring criteria.')
    return
  }

  const parsed = scoringCriterionDraftSchema.safeParse({
    ...f,
    key: f.key.trim(),
    name: f.name.trim(),
    description: f.description.trim(),
  })
  if (!parsed.success) {
    toast.warning('Invalid criterion', parsed.error.issues[0]?.message ?? 'Check the criterion fields and try again.')
    return
  }

  const keyExists = scoringCriteria.value.some(c => c.key === parsed.data.key)
  if (keyExists) {
    toast.warning('Duplicate criterion', `A criterion with key "${parsed.data.key}" already exists.`)
    return
  }

  scoringCriteria.value.push(parsed.data)
  customCriterionForm.value = { key: '', name: '', description: '', category: 'custom', maxScore: 10, weight: 50 }
  showCustomForm.value = false
  if (scoringMode.value === 'none') scoringMode.value = 'custom'
}

function removeCriterion(key: string) {
  scoringCriteria.value = scoringCriteria.value.filter(c => c.key !== key)
}

function autoGenerateKey(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50)
}

const isSubmitting = ref(false)
/** Covers the gap between "job created" and the shortlist being ready to show. */
const isPopulatingSample = ref(false)
const errors = ref<Record<string, string>>({})
const linkCopied = ref(false)

/**
 * One end of a pay range.
 *
 * An emptied number input hands back `''`, and `z.coerce.number()` reads that as
 * 0 — which would quietly advertise the role at zero. So blank in every form it
 * arrives in is mapped to "not stated" before any coercion happens.
 */
const salaryAmountSchema = z.preprocess(
  value => (value === '' || value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))
    ? null
    : value),
  z.coerce.number()
    .int('Enter a whole number')
    .min(0, 'Salary cannot be negative')
    .max(100_000_000, 'That is higher than any pay a board will accept — check the amount.')
    .nullable()
    .default(null),
)

const formSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  description: z.string().trim().max(100_000, 'Description is too long'),
  // Optional here on purpose: a draft may be half-filled. Publishing is what
  // requires a placeable location — see `validatePublishLocation`.
  locationCity: z.string().trim().max(120).nullable().default(null),
  locationRegion: z.string().trim().max(120).nullable().default(null),
  locationCountry: z.string().trim().length(2).nullable().default(null),
  locationPostalCode: z.string().trim()
    .max(POSTAL_CODE_MAX_LENGTH, `Postal code must be ${POSTAL_CODE_MAX_LENGTH} characters or less`)
    .refine(value => !value || isValidPostalCode(value), 'Enter a postal code, not a street address')
    .transform(normalizePostalCode)
    .nullable()
    .default(null),
  type: z.enum(['full_time', 'part_time', 'contract', 'internship']),
  experienceLevel: z.enum(['junior', 'mid', 'senior', 'lead']),
  remoteStatus: z.enum(['remote', 'hybrid', 'onsite']).optional(),
  // Per-field only. Whether the parts add up to a range a board can read is
  // checked in `salaryBlockers`, for the same reason the publish requirements
  // live there: this schema also gates draft restore, and a draft caught
  // mid-typing must still come back.
  salaryMin: salaryAmountSchema,
  salaryMax: salaryAmountSchema,
  salaryCurrency: z.preprocess(
    value => (typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null),
    z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, like USD or NOK').nullable().default(null),
  ),
  salaryUnit: z.preprocess(
    value => (value === '' ? null : value),
    z.enum(['YEAR', 'MONTH', 'HOUR']).nullable().default(null),
  ),
  salaryNegotiable: z.boolean().default(false),
})

const draftQuestionSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(500),
  type: z.enum(['short_text', 'long_text', 'single_select', 'multi_select', 'number', 'date', 'url', 'checkbox', 'file_upload']),
  description: z.string().trim().max(1000).nullish(),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(200)).max(50).nullish(),
})

const applicationFormSchema = z.object({
  phoneRequirement: z.enum(['hidden', 'optional', 'required']),
  requireResume: z.boolean(),
  requireCoverLetter: z.boolean(),
  questions: z.array(draftQuestionSchema).max(50),
})

const scoringCriterionDraftSchema = z.object({
  key: z.string().trim().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000),
  category: z.enum(['technical', 'experience', 'soft_skills', 'education', 'culture', 'custom']),
  maxScore: z.number().int().min(1).max(100),
  weight: z.number().int().min(0).max(100),
})

// Check if at least one AI provider is configured with a valid API key.
// /api/ai-config returns an array of configurations now (multi-config era).
interface AiConfigCheckRow { hasApiKey: boolean }
const { data: aiConfigData } = useFetch<AiConfigCheckRow[]>('/api/ai-config', { key: 'ai-config-check', headers: useRequestHeaders(['cookie']) })
const isAiConfigured = computed(() => {
  return Array.isArray(aiConfigData.value) && aiConfigData.value.some((c) => c.hasApiKey)
})

/**
 * Whether publishing also syndicates this role to the external job boards.
 *
 * Chosen on step 4 but declared here, with the rest of the persisted wizard
 * state, so the autosave below can read it. Defaults on: free distribution is
 * why most people publish at all. What it buys is the ability to say no *before*
 * the role goes out — a confidential or internal-only search cannot be un-sent
 * once the aggregators have picked it up.
 */
const distributeToBoards = ref(true)

/**
 * Whether this visit is the test-job walkthrough rather than a real role.
 * Declared here because the autosave below keys off it.
 */
const isTestMode = computed(() => route.query.mode === 'test')

// Auto-save to localStorage
//
// The walkthrough saves under its own key. It shares this page with the real
// wizard, so with one key the sample role would overwrite a half-finished real
// draft — and then come back in its place the next time someone starts a
// genuine role.
const AUTO_SAVE_KEY = 'reqcore-job-draft'
const TEST_AUTO_SAVE_KEY = 'reqcore-job-draft-test'
const autoSaveKey = computed(() => (isTestMode.value ? TEST_AUTO_SAVE_KEY : AUTO_SAVE_KEY))

function saveFormToStorage() {
  if (!import.meta.client) return
  try {
    const data = {
      form: form.value,
      applicationForm: applicationForm.value,
      scoringCriteria: scoringCriteria.value,
      scoringMode: scoringMode.value,
      autoScoreOnApply: autoScoreOnApply.value,
      distributeToBoards: distributeToBoards.value,
      currentStep: currentStep.value,
    }
    localStorage.setItem(autoSaveKey.value, JSON.stringify(data))
  } catch { /* storage full or unavailable */ }
}

function openDraftPreview() {
  saveFormToStorage()
  // The mode travels with the link so the preview reads the same key we just wrote.
  const path = localePath(isTestMode.value
    ? { path: '/dashboard/jobs/preview', query: { mode: 'test' } }
    : '/dashboard/jobs/preview')
  window.open(path, '_blank', 'noopener,noreferrer')
}

function restoreFormFromStorage() {
  if (!import.meta.client) return
  try {
    const raw = localStorage.getItem(autoSaveKey.value)
    if (!raw) return
    const data = z.object({
      form: z.unknown().optional(),
      applicationForm: z.unknown().optional(),
      scoringCriteria: z.unknown().optional(),
      scoringMode: z.unknown().optional(),
      autoScoreOnApply: z.unknown().optional(),
      distributeToBoards: z.unknown().optional(),
      currentStep: z.unknown().optional(),
    }).parse(JSON.parse(raw))

    const storedForm = formSchema.safeParse(data.form)
    if (storedForm.success) {
      form.value = {
        ...storedForm.data,
        remoteStatus: storedForm.data.remoteStatus,
      }
    }

    const storedApplicationForm = applicationFormSchema.safeParse(data.applicationForm)
    if (storedApplicationForm.success) applicationForm.value = storedApplicationForm.data

    const storedCriteria = z.array(scoringCriterionDraftSchema).max(20).safeParse(data.scoringCriteria)
    if (storedCriteria.success) scoringCriteria.value = storedCriteria.data

    const storedMode = z.enum(['none', 'premade', 'ai', 'custom']).safeParse(data.scoringMode)
    if (storedMode.success) scoringMode.value = storedMode.data

    const storedAutoScore = z.boolean().safeParse(data.autoScoreOnApply)
    if (storedAutoScore.success) autoScoreOnApply.value = storedAutoScore.data

    const storedDistribute = z.boolean().safeParse(data.distributeToBoards)
    if (storedDistribute.success) distributeToBoards.value = storedDistribute.data

    const storedStep = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).safeParse(data.currentStep)
    currentStep.value = storedStep.success && storedForm.success ? storedStep.data : 1
  } catch { /* corrupted data, ignore */ }
}

function clearFormStorage() {
  if (!import.meta.client) return
  try { localStorage.removeItem(autoSaveKey.value) } catch { /* ignore */ }
}

// ─────────────────────────────────────────────
// Test mode (?mode=test)
// ─────────────────────────────────────────────

/**
 * The walkthrough for someone evaluating Reqcore rather than hiring.
 *
 * They are taken through the real wizard on purpose — trying the create-a-job
 * flow is usually the thing they came to do, so replacing it with a canned
 * preview would skip the tour. What they are spared is the blank page: every
 * step arrives filled in with a believable role they can read, edit or click
 * straight past. That is the step people were faking their way through when
 * they typed "asdf" into the title to get to the end.
 *
 * The `?mode=test` flag itself is declared up with the autosave, which keys off it.
 */

/** Which steps have played their reveal, so going back doesn't replay it. */
const revealedSteps = ref(new Set<number>())
const isRevealing = ref(false)

function applySampleContent() {
  form.value = { ...SAMPLE_JOB_FORM }
  applicationForm.value = {
    phoneRequirement: 'optional',
    requireResume: true,
    requireCoverLetter: false,
    questions: SAMPLE_JOB_QUESTIONS.map(q => ({ id: crypto.randomUUID(), ...q })),
  }
  scoringCriteria.value = SAMPLE_SCORING_CRITERIA.map(c => ({ ...c }))
  scoringMode.value = 'custom'
  autoScoreOnApply.value = true
}

/**
 * Fades the step's newly-filled content in rather than having it appear
 * instantly, so it reads as the wizard filling itself in for you. Skipped
 * entirely under `prefers-reduced-motion`, and it never gates interaction —
 * the fields are live throughout, the animation is only opacity.
 */
async function revealStep(step: number) {
  if (!isTestMode.value || revealedSteps.value.has(step)) return
  revealedSteps.value.add(step)

  if (import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  isRevealing.value = true
  await nextTick()
  setTimeout(() => { isRevealing.value = false }, 480)
}

watch(currentStep, step => revealStep(step))

/**
 * Fills the wizard for whichever mode the URL asks for.
 *
 * The walkthrough always starts from the sample role, never from its own saved
 * copy, so it reads the same on every visit. The real wizard picks up whatever
 * draft was left behind — which is only the recruiter's own work, since the
 * walkthrough writes to a separate key.
 */
function loadForMode() {
  if (isTestMode.value) {
    applySampleContent()
    revealStep(1)
    track('sample_job_started')
  }
  else {
    restoreFormFromStorage()
  }
  // Pay that is already filled in is not something to go hunting for behind a
  // collapsed header.
  showCompensation.value = hasSalaryDetails.value
}

onMounted(loadForMode)

/**
 * Both modes live on this one page, so switching between them (New Job in the
 * top bar, a link back to the real wizard) changes the query without
 * remounting. Without this the sample role would sit in the fields of what is
 * now a real role, waiting to be deleted by hand.
 */
watch(isTestMode, () => {
  resetFormState()
  revealedSteps.value.clear()
  loadForMode()
})

// Reset all wizard state to initial values (called when user clicks "New Job" again)
function resetState() {
  resetFormState()
  clearFormStorage()
}

/** The field reset on its own — leaves whatever is in storage alone. */
function resetFormState() {
  currentStep.value = 1
  form.value = {
    title: '',
    description: '',
    locationCity: null,
    locationRegion: null,
    locationCountry: null,
    locationPostalCode: null,
    type: 'full_time',
    experienceLevel: 'mid',
    remoteStatus: undefined,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryUnit: 'YEAR',
    salaryNegotiable: false,
  }
  showCompensation.value = false
  applicationForm.value = {
    phoneRequirement: 'optional',
    requireResume: true,
    requireCoverLetter: false,
    questions: [],
  }
  scoringCriteria.value = []
  scoringMode.value = 'none'
  autoScoreOnApply.value = true
  autoCriteriaState.value = 'idle'
  distributeToBoards.value = true
  isPublished.value = false
  createdJobId.value = ''
  createdJobSlug.value = ''
  finalApplicationLink.value = ''
  finalCopyState.value = 'idle'
  errors.value = {}
}

// Shared signal incremented by AppTopBar when the user is already on this page
const newJobResetSignal = useState('new-job-reset-signal', () => 0)
watch(newJobResetSignal, (next, prev) => {
  if (next > prev) resetState()
})

// Auto-save when step changes or form data changes
watch([currentStep, form, applicationForm, scoringCriteria, scoringMode, autoScoreOnApply, distributeToBoards], () => {
  saveFormToStorage()
}, { deep: true })


// Step 4: Publish & Distribute
const publishChoice = ref<'publish' | 'draft'>('publish')
const isPublished = ref(false)
const createdJobSlug = ref('')
const createdJobId = ref('')
const finalApplicationLink = ref('')
/**
 * Whether the auto-copy on publish actually landed. The button promises a copy,
 * so the success screen has to say which of the two happened — a blocked
 * clipboard (insecure context, denied permission) otherwise sends the recruiter
 * away believing they hold the link.
 */
const finalCopyState = ref<'idle' | 'copied' | 'failed'>('idle')

function validateStep1(): boolean {
  const result = formSchema.safeParse(form.value)
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

// Pure check with no side-effects so it never populates errors on its own
const isStep1Valid = computed(() => formSchema.safeParse(form.value).success)

/**
 * What the job boards need before this role can go live: a placeable location
 * and a description that isn't a stub. A role published without them is live
 * but invisible, so the wizard asks for them here rather than letting the
 * recruiter find out from a rejected upload.
 *
 * "Save & exit" is the escape hatch — a draft is allowed to be incomplete.
 */
const publishBlockers = computed(() => missingPublishRequirements({
  description: form.value.description,
  locationCountry: form.value.locationCountry,
  remoteStatus: form.value.remoteStatus,
}))

const descriptionChars = computed(() => descriptionLength(form.value.description))

/**
 * What a stated pay range still needs before it means anything.
 *
 * A bare pair of numbers is worse than no salary at all — the boards render it
 * against whatever currency they assume, so "50000–70000" can reach candidates
 * as dollars in a role that pays kroner. Only checked once the recruiter has
 * actually typed an amount: saying nothing about pay stays free.
 */
const salaryBlockers = computed<{ field: string, reason: string }[]>(() => {
  const { salaryMin, salaryMax, salaryCurrency, salaryUnit, salaryNegotiable } = form.value
  if (salaryNegotiable) return []
  if (salaryMin == null && salaryMax == null) return []

  const blockers: { field: string, reason: string }[] = []
  if (salaryMin != null && salaryMax != null && salaryMax < salaryMin) {
    blockers.push({ field: 'salaryMax', reason: 'Maximum pay must be at least the minimum.' })
  }
  if (!salaryCurrency) {
    blockers.push({ field: 'salaryCurrency', reason: 'Add a currency so boards show the range in the right money.' })
  }
  if (!salaryUnit) {
    blockers.push({ field: 'salaryUnit', reason: 'Choose whether this is per year, month or hour.' })
  }
  return blockers
})

function validateSalary(): boolean {
  if (salaryBlockers.value.length === 0) return true
  // Never leave the reason folded away — this is what the Next button is
  // waiting on, and submit bounces the user back to this step for it.
  showCompensation.value = true
  for (const blocker of salaryBlockers.value) {
    errors.value = { ...errors.value, [blocker.field]: blocker.reason }
  }
  return false
}

/**
 * Blur handler for the pay fields. The per-field rules live in the schema and
 * the cross-field ones in `salaryBlockers`, so both have to run to get a
 * complete answer — and `validateStep1` wipes `errors`, so it has to run first.
 */
function validateSalaryFields() {
  validateStep1()
  validateSalary()
}

function validatePublishRequirements(): boolean {
  if (publishBlockers.value.length === 0) return true
  for (const blocker of publishBlockers.value) {
    errors.value = { ...errors.value, [blocker.field]: blocker.reason }
  }
  return false
}

/** Everything Job details has to have before the wizard moves past it. */
function validateJobDetails(): boolean {
  // Order matters: `validateStep1` clears `errors`, so it has to run first.
  const schemaValid = validateStep1()
  const publishReady = validatePublishRequirements()
  const salaryReady = validateSalary()
  return schemaValid && publishReady && salaryReady
}

const canGoNext = computed(() => {
  if (currentStep.value === 1) {
    return isStep1Valid.value && publishBlockers.value.length === 0 && salaryBlockers.value.length === 0
  }
  return true
})

function goToStep(step: 1 | 2 | 3 | 4) {
  if (step === currentStep.value) return
  // Validate step 1 before leaving it
  if (currentStep.value === 1 && step > 1 && !validateJobDetails()) return
  currentStep.value = step
}

function nextStep() {
  if (currentStep.value < 4) {
    if (currentStep.value === 1 && !validateJobDetails()) return
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 1) currentStep.value--
}

watch(currentStep, async () => {
  await nextTick()
  wizardEditor.value?.scrollTo({ top: 0, behavior: 'auto' })
})

const requestUrl = useRequestURL()
// Preview only — the wizard never sends a slug, so the server derives the real
// one from the title on create. Shares `slugifyJobBase` with it so what is shown
// here is what gets minted; the suffix is drawn server-side, hence the xs.
const applicationLink = computed(() => {
  const base = `${requestUrl.protocol}//${requestUrl.host}`
  const slugBase = form.value.title.trim() ? slugifyJobBase(form.value.title) : 'new-job'
  return `${base}/jobs/${slugBase}-xxxxxxxx/apply`
})

async function copyApplicationLink() {
  try {
    await navigator.clipboard.writeText(applicationLink.value)
    linkCopied.value = true
    setTimeout(() => {
      linkCopied.value = false
    }, 2000)
  } catch {
    // ignore clipboard issues silently
  }
}

// ─────────────────────────────────────────────
// Career page integration (Step 4)
// A published role is automatically listed on the org's branded career page.
// Surface that page as the primary distribution destination.
// ─────────────────────────────────────────────
// The career page link itself is rendered by JobPromotePanel; this flag only
// drives the upgrade nudge shown to orgs whose plan doesn't include it.
const { hasFeature: hasPlanFeature } = usePlanFeature()
const canUseCareerPage = computed(() => hasPlanFeature('careerPage'))

async function handleSubmit(mode: 'publish' | 'draft' = publishChoice.value) {
  if (isSubmitting.value) return

  // Ensure step 1 is valid before submit
  if (!validateStep1()) {
    currentStep.value = 1
    return
  }

  if (mode === 'publish' && !validatePublishRequirements()) {
    currentStep.value = 1
    return
  }

  // Applies to drafts too: a half-stated range is the kind of thing that gets
  // published later without ever being looked at again.
  if (!validateSalary()) {
    currentStep.value = 1
    return
  }

  const normalizedForm = formSchema.parse(form.value)
  isSubmitting.value = true
  try {
    const created = await createJob({
      title: normalizedForm.title,
      description: normalizedForm.description || undefined,
      locationCity: normalizedForm.locationCity,
      locationRegion: normalizedForm.locationRegion,
      locationCountry: normalizedForm.locationCountry,
      locationPostalCode: normalizedForm.locationPostalCode,
      type: normalizedForm.type,
      experienceLevel: normalizedForm.experienceLevel,
      remoteStatus: normalizedForm.remoteStatus,
      // "Negotiable" and a range are mutually exclusive on the public listing,
      // so only one of them is ever sent.
      salaryNegotiable: normalizedForm.salaryNegotiable,
      salaryMin: normalizedForm.salaryNegotiable ? null : normalizedForm.salaryMin,
      salaryMax: normalizedForm.salaryNegotiable ? null : normalizedForm.salaryMax,
      salaryCurrency: normalizedForm.salaryNegotiable ? null : normalizedForm.salaryCurrency,
      salaryUnit: normalizedForm.salaryNegotiable ? null : normalizedForm.salaryUnit,
      phoneRequirement: applicationForm.value.phoneRequirement,
      requireResume: applicationForm.value.requireResume,
      requireCoverLetter: applicationForm.value.requireCoverLetter,
      autoScoreOnApply: scoringCriteria.value.length > 0 && autoScoreOnApply.value,
      status: mode === 'publish' ? 'open' : 'draft',
      distributeToBoards: distributeToBoards.value,
      isTest: isTestMode.value,
      questions: applicationForm.value.questions.map((question, index) => ({
        label: question.label,
        type: question.type,
        description: question.description || undefined,
        required: question.required,
        options: question.options || undefined,
        displayOrder: index,
      })),
      criteria: scoringCriteria.value.map((criterion, index) => ({
        key: criterion.key,
        name: criterion.name,
        description: criterion.description || undefined,
        category: criterion.category,
        maxScore: criterion.maxScore,
        weight: criterion.weight,
        displayOrder: index,
      })),
    })

    track('job_created')

    if (mode === 'publish' && created?.id) {
      // Build the real application link
      const base = `${requestUrl.protocol}//${requestUrl.host}`
      const slug = created.slug || created.id
      finalApplicationLink.value = `${base}/jobs/${slug}/apply`
      createdJobSlug.value = slug
      createdJobId.value = created.id

      track('job_published')

      // The payoff. A walkthrough that ends on an empty pipeline has shown a
      // form, not a product — so the test role arrives already holding a ranked
      // shortlist, and we take them straight to it rather than to a share link
      // they have nobody to send.
      if (isTestMode.value) {
        isPopulatingSample.value = true
        try {
          await $fetch(`/api/jobs/${created.id}/sample-applicants`, { method: 'POST' })
          track('sample_job_published')
          await navigateTo(localePath(`/dashboard/jobs/${created.id}`))
          return
        } catch {
          // The job itself is real and saved; only its sample applicants failed.
          // Send them to it anyway rather than stranding them in the wizard.
          toast.add({
            type: 'warning',
            title: 'Test job created',
            message: 'We could not add the sample applicants this time.',
          })
          await navigateTo(localePath(`/dashboard/jobs/${created.id}`))
          return
        } finally {
          isPopulatingSample.value = false
          clearFormStorage()
        }
      }

      // Auto-copy to clipboard. Either outcome is reported on the success
      // screen below; the copy is a convenience, never a reason to fail the
      // publish that already succeeded.
      try {
        await navigator.clipboard.writeText(finalApplicationLink.value)
        finalCopyState.value = 'copied'
      } catch {
        finalCopyState.value = 'failed'
      }

      isPublished.value = true
    } else {
      // Saved as draft — go to jobs list
      await navigateTo(localePath('/dashboard/jobs'))
    }
    clearFormStorage()
  } catch (err: any) {
    // Free org tried to open a role past its active-role cap — pitch an upgrade
    // instead of a dead-end toast. Their work is auto-saved, so they can upgrade
    // (returns here post-checkout) or save as draft without losing anything.
    if (err?.data?.data?.code === 'ACTIVE_ROLE_LIMIT') {
      limitUpsellMax.value = err.data.data.limit ?? 1
      showLimitUpsell.value = true
      track('job_limit_upsell_shown')
      return
    }
    // The publish guard names the field that fixes it, so send the recruiter
    // back to Job details with the message on that input.
    const blockedField = err?.data?.data?.field
    if (blockedField) {
      errors.value = { ...errors.value, [blockedField]: err.data.statusMessage }
      currentStep.value = 1
    }
    const statusMessage = err?.data?.statusMessage ?? 'Something went wrong while creating the job.'
    toast.error('Failed to create job', {
      message: statusMessage,
      statusCode: err?.data?.statusCode,
    })
  } finally {
    isSubmitting.value = false
  }
}

// From the upsell modal: keep the user's work by saving the role as a draft
// (drafts don't count against the active-role cap) and head to the jobs list.
async function saveAsDraftFromUpsell() {
  showLimitUpsell.value = false
  await handleSubmit('draft')
}

/** The pay line on the step 4 review, or nothing when pay was left unstated. */
const salarySummary = computed(() => {
  const { salaryMin, salaryMax, salaryCurrency, salaryUnit, salaryNegotiable } = form.value
  if (salaryNegotiable) return 'Negotiable'
  if (salaryMin == null && salaryMax == null) return null

  const amounts = [salaryMin, salaryMax].filter((value): value is number => value != null)
  const unit = salaryUnit ? ` per ${salaryUnit.toLowerCase()}` : ''
  return `${salaryCurrency ?? ''} ${amounts.map(value => value.toLocaleString()).join(' – ')}${unit}`.trim()
})

/** Suggestions only — any ISO 4217 code can still be typed. */
const COMMON_CURRENCIES = ['NOK', 'SEK', 'DKK', 'EUR', 'GBP', 'USD', 'CHF', 'PLN', 'CAD', 'AUD']

/**
 * Pay amounts are grouped as they are typed — "3,000,000" rather than
 * "3000000", where a missing or extra zero is genuinely hard to see.
 *
 * Commas regardless of locale, and every non-digit stripped on the way back in.
 * A locale-aware separator would be the obvious alternative, but `nb-NO` groups
 * with a non-breaking space, which is invisible in an input and does not survive
 * being pasted back out.
 */
const SALARY_MAX_DIGITS = 9

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatSalaryInput(value: number | null): string {
  return value == null ? '' : groupDigits(String(value))
}

const salaryMinDisplay = computed(() => formatSalaryInput(form.value.salaryMin))
const salaryMaxDisplay = computed(() => formatSalaryInput(form.value.salaryMax))

/**
 * Reads the digits out of whatever was typed and writes the grouped form back.
 *
 * The caret is placed by counting digits rather than characters: inserting a
 * comma shifts every position after it, so restoring the raw offset would drop
 * the caret a place backwards on each group boundary the user types past.
 *
 * The field itself stays `number | null`. A cleared input hands back `''`, and
 * `'' != null`, so an empty string left in state would read as a stated salary
 * and start demanding a currency for it.
 */
function onSalaryInput(field: 'salaryMin' | 'salaryMax', event: Event) {
  const input = event.target as HTMLInputElement
  const digitsBeforeCaret = (input.value.slice(0, input.selectionStart ?? input.value.length).match(/\d/g) ?? []).length

  const digits = input.value.replace(/\D/g, '').slice(0, SALARY_MAX_DIGITS).replace(/^0+(?=\d)/, '')
  form.value[field] = digits ? Number.parseInt(digits, 10) : null

  const formatted = groupDigits(digits)
  input.value = formatted

  // Walk forward past `digitsBeforeCaret` digits, so the caret lands in the
  // same place in the number even though the separators have moved.
  let caret = 0
  let seen = 0
  while (caret < formatted.length && seen < digitsBeforeCaret) {
    if (/\d/.test(formatted[caret]!)) seen++
    caret++
  }
  input.setSelectionRange(caret, caret)
}

function onCurrencyInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim().toUpperCase()
  // Uppercased in state, not just in CSS: the feed writes whatever is stored,
  // and a lowercase code is not a currency to an aggregator.
  form.value.salaryCurrency = raw || null
}

const typeOptions = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
]
</script>

<template>
  <div class="mx-auto flex h-full w-full max-w-7xl flex-col overflow-y-auto px-4 py-2 sm:px-6 lg:px-8 lg:py-3 xl:min-h-0 xl:overflow-hidden">
    <!-- Compact wizard navigation -->
    <div class="mb-3 flex items-center gap-3">
      <NuxtLink
        :to="$localePath('/dashboard/jobs')"
        class="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-100"
      >
        <ArrowLeft class="size-3.5" />
        <span class="hidden sm:inline">Jobs</span>
      </NuxtLink>

      <ol class="flex min-w-0 flex-1 items-center gap-1">
        <li
          v-for="(step, idx) in steps"
          :key="step.id"
          class="flex items-center flex-1 min-w-0 cursor-pointer"
          @click="goToStep(step.id as typeof currentStep)"
        >
          <div class="flex min-w-0 items-center gap-1.5">
            <div
              class="flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium transition-all"
              :class="[
                currentStep === step.id
                  ? 'bg-brand-600 text-white border-brand-600 ring-1 ring-brand-100 dark:ring-brand-950'
                  : currentStep > step.id
                    ? 'bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-800'
                    : 'bg-white dark:bg-surface-900 text-surface-400 dark:text-surface-500 border-surface-200 dark:border-surface-800'
              ]"
            >
              <!-- Step 3 is being written in the background while you fill in step 2. -->
              <Loader2
                v-if="step.id === 3 && currentStep !== 3 && autoCriteriaState === 'running'"
                class="size-3 animate-spin text-brand-500 dark:text-brand-400"
              />
              <span v-else-if="currentStep > step.id" class="text-xs">&#10003;</span>
              <span v-else>{{ step.id }}</span>
            </div>
            <span
              class="hidden truncate text-[11px] font-medium md:inline"
              :class="currentStep >= step.id ? 'text-surface-900 dark:text-surface-100' : 'text-surface-400 dark:text-surface-500'"
            >
              {{ step.title }}
            </span>
          </div>
          <div
            v-if="idx < steps.length - 1"
            class="mx-1.5 h-px flex-1 rounded-full transition-colors"
            :class="currentStep > step.id ? 'bg-brand-600' : 'bg-surface-200 dark:bg-surface-800'"
          />
        </li>
      </ol>

      <div v-if="!isPublished" class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-100"
          @click="openDraftPreview"
        >
          <Eye class="size-3.5" />
          <span class="hidden sm:inline">View preview</span>
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs font-medium text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-900 disabled:opacity-50 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-100"
          :disabled="isSubmitting"
          @click="handleSubmit('draft')"
        >
          Save &amp; exit
        </button>
      </div>
    </div>

    <!-- Main Layout: editor + persistent live preview -->
    <div
      class="grid gap-6 xl:min-h-0 xl:flex-1"
      :class="currentStep <= 2
        ? 'xl:grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)]'
        : 'mx-auto w-full max-w-3xl xl:grid-cols-1'"
    >
      <div
        ref="wizardEditor"
        class="min-w-0 space-y-6 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:pb-1 xl:pr-1"
      >

        <!--
          Test-mode framing. Stated once, up front, so nothing further down has
          to keep re-explaining why the fields are already filled in.
        -->
        <div
          v-if="isTestMode"
          class="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50/70 p-4 dark:border-brand-900 dark:bg-brand-950/30"
        >
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-300">
            <FlaskConical class="size-4" />
          </span>
          <div class="min-w-0 text-sm">
            <p class="font-semibold text-surface-900 dark:text-surface-100">You're creating a test job</p>
            <p class="mt-1 leading-relaxed text-surface-600 dark:text-surface-300">
              Every step is filled in with an example role — change anything you like, or just keep clicking through.
              It stays inside your workspace: never on the public job board, your career page, or any job board.
              When you publish, sample applicants land in it so you can see the ranking.
            </p>
          </div>
        </div>

        <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm overflow-hidden">
          <form
            @submit.prevent="() => handleSubmit()"
            class="p-5 md:p-6"
            :class="isRevealing ? 'sample-reveal' : ''"
          >
            <!-- Step 1: Job details -->
            <section v-if="currentStep === 1" class="space-y-6">
              <div>
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100">Job details</h2>
                <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
                  Title, location and description are what job boards need to accept this role. Everything else is optional — and you can
                  <button type="button" class="font-medium underline underline-offset-2 hover:text-surface-700 dark:hover:text-surface-200" @click="handleSubmit('draft')">save an incomplete draft</button>
                  at any point.
                </p>
              </div>

              <!-- Title -->
              <div>
                <label for="title" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Job title <span class="text-danger-500">*</span>
                </label>
                <input
                  id="title"
                  v-model="form.title"
                  type="text"
                  maxlength="200"
                  placeholder="e.g. Senior Frontend Engineer"
                  class="w-full rounded-lg border px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  :class="errors.title ? 'border-danger-300 ring-1 ring-danger-100' : 'border-surface-300 dark:border-surface-700'"
                  @blur="validateStep1"
                />
                <p v-if="errors.title" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400 font-medium">{{ errors.title }}</p>
              </div>

              <!-- Location + postal code -->
              <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div class="md:col-span-2">
                  <label for="location" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    Location <span class="text-danger-500">*</span>
                  </label>
                  <LocationCombobox
                    id="location"
                    v-model="locationSelection"
                    :invalid="!!errors.locationCountry"
                  />
                  <p v-if="errors.locationCountry" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400 font-medium">
                    {{ errors.locationCountry }}
                  </p>
                  <p v-else class="mt-1.5 text-xs text-surface-500">Boards place listings by country. For a role with no base, set Workplace to Remote instead.</p>
                </div>
                <!-- Always on the row so the field is never missing, but inert
                     until a place is picked: the API drops a postal code with no
                     country, so accepting one first would silently lose it. -->
                <div>
                  <label for="location-postal-code" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    Postal code <span class="font-normal text-surface-400">(optional)</span>
                  </label>
                  <input
                    id="location-postal-code"
                    v-model="form.locationPostalCode"
                    type="text"
                    :maxlength="POSTAL_CODE_MAX_LENGTH"
                    :disabled="!form.locationCountry"
                    autocomplete="postal-code"
                    placeholder="e.g. 0150"
                    class="w-full rounded-lg border px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    :class="errors.locationPostalCode ? 'border-danger-300 ring-1 ring-danger-100' : 'border-surface-300 dark:border-surface-700'"
                    @blur="validateStep1"
                  />
                  <p v-if="errors.locationPostalCode" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400 font-medium">
                    {{ errors.locationPostalCode }}
                  </p>
                  <p v-else-if="!form.locationCountry" class="mt-1.5 text-xs text-surface-500">Pick a location first.</p>
                  <p v-else class="mt-1.5 text-xs text-surface-500">Puts the role in local "jobs near me" searches.</p>
                </div>
              </div>

              <!-- Employment type + experience + remote -->
              <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div>
                  <label for="type" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    Employment type
                  </label>
                  <select
                    id="type"
                    v-model="form.type"
                    class="w-full rounded-lg border px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors bg-white dark:bg-surface-900 border-surface-300 dark:border-surface-700"
                  >
                    <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
                <div>
                  <label for="experienceLevel" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Experience level</label>
                  <select
                    id="experienceLevel"
                    v-model="form.experienceLevel"
                    class="w-full rounded-lg border px-3 py-2.5 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 border-surface-300 dark:border-surface-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  >
                    <option value="junior">Junior</option>
                    <option value="mid">Mid-level</option>
                    <option value="senior">Senior</option>
                    <option value="lead">Lead</option>
                  </select>
                </div>
                <div>
                  <label for="remoteStatus" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Workplace</label>
                  <select
                    id="remoteStatus"
                    v-model="form.remoteStatus"
                    class="w-full rounded-lg border px-3 py-2.5 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 border-surface-300 dark:border-surface-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  >
                    <option :value="undefined">Not specified</option>
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="onsite">On-site</option>
                  </select>
                </div>
              </div>

              <!-- Compensation -->
              <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50/60 dark:bg-surface-900/50">
                <button
                  type="button"
                  class="flex w-full items-center gap-3 p-5 text-left"
                  :aria-expanded="showCompensation"
                  aria-controls="compensation-panel"
                  @click="showCompensation = !showCompensation"
                >
                  <ChevronRight
                    class="size-4 shrink-0 text-surface-400 transition-transform"
                    :class="showCompensation && 'rotate-90'"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-surface-800 dark:text-surface-200">Compensation</span>
                      <span class="inline-flex items-center rounded-md bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-surface-500 dark:text-surface-400">Optional</span>
                    </span>
                    <!-- Collapsed, the header is the only thing saying what is
                         inside — so it carries the value rather than the pitch. -->
                    <span v-if="!showCompensation" class="mt-0.5 block truncate text-xs text-surface-500 dark:text-surface-400">
                      {{ salarySummary ?? 'Not stated — roles that state pay rank higher on Google Jobs and most aggregators.' }}
                    </span>
                  </span>
                </button>

                <div v-if="showCompensation" id="compensation-panel" class="px-5 pb-5">
                  <p class="text-xs text-surface-500 dark:text-surface-400">
                    Roles that state pay get a rich result on Google Jobs and are sorted higher by most aggregators. You can change this later in job settings.
                  </p>

                <label class="mt-4 flex cursor-pointer items-center gap-3">
                  <input
                    v-model="form.salaryNegotiable"
                    type="checkbox"
                    class="size-4 shrink-0 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500"
                  />
                  <span class="text-sm text-surface-700 dark:text-surface-300">
                    Pay is negotiable — show "Negotiable" instead of a range
                  </span>
                </label>

                <div v-if="!form.salaryNegotiable" class="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <div>
                    <label for="salary-min" class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">Minimum</label>
                    <input
                      id="salary-min"
                      :value="salaryMinDisplay"
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      placeholder="e.g. 500,000"
                      @input="onSalaryInput('salaryMin', $event)"
                      class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                      :class="errors.salaryMin ? 'border-danger-300 ring-1 ring-danger-100' : 'border-surface-300 dark:border-surface-700'"
                      @blur="validateSalaryFields"
                    />
                    <p v-if="errors.salaryMin" class="mt-1 text-xs font-medium text-danger-600 dark:text-danger-400">{{ errors.salaryMin }}</p>
                  </div>
                  <div>
                    <label for="salary-max" class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">Maximum</label>
                    <input
                      id="salary-max"
                      :value="salaryMaxDisplay"
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      placeholder="e.g. 650,000"
                      @input="onSalaryInput('salaryMax', $event)"
                      class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                      :class="errors.salaryMax ? 'border-danger-300 ring-1 ring-danger-100' : 'border-surface-300 dark:border-surface-700'"
                      @blur="validateSalaryFields"
                    />
                    <p v-if="errors.salaryMax" class="mt-1 text-xs font-medium text-danger-600 dark:text-danger-400">{{ errors.salaryMax }}</p>
                  </div>
                  <div>
                    <label for="salary-currency" class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">Currency</label>
                    <input
                      id="salary-currency"
                      :value="form.salaryCurrency"
                      list="salary-currency-options"
                      type="text"
                      maxlength="3"
                      autocomplete="off"
                      placeholder="NOK"
                      class="w-full rounded-lg border px-3 py-2 text-sm uppercase text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                      :class="errors.salaryCurrency ? 'border-danger-300 ring-1 ring-danger-100' : 'border-surface-300 dark:border-surface-700'"
                      @input="onCurrencyInput"
                      @blur="validateSalaryFields"
                    />
                    <!-- A list, not a select: the common codes are one keystroke
                         away without shutting out the other 150. -->
                    <datalist id="salary-currency-options">
                      <option v-for="code in COMMON_CURRENCIES" :key="code" :value="code" />
                    </datalist>
                    <p v-if="errors.salaryCurrency" class="mt-1 text-xs font-medium text-danger-600 dark:text-danger-400">{{ errors.salaryCurrency }}</p>
                  </div>
                  <div>
                    <label for="salary-unit" class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">Per</label>
                    <select
                      id="salary-unit"
                      v-model="form.salaryUnit"
                      class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                      :class="errors.salaryUnit ? 'border-danger-300 ring-1 ring-danger-100' : 'border-surface-300 dark:border-surface-700'"
                      @change="validateSalaryFields"
                    >
                      <option :value="null">Not specified</option>
                      <option value="YEAR">Year</option>
                      <option value="MONTH">Month</option>
                      <option value="HOUR">Hour</option>
                    </select>
                    <p v-if="errors.salaryUnit" class="mt-1 text-xs font-medium text-danger-600 dark:text-danger-400">{{ errors.salaryUnit }}</p>
                  </div>
                </div>
                </div>
              </div>

              <!-- Description -->
              <div>
                <label for="description" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Description <span class="text-danger-500">*</span>
                </label>
                <textarea
                  id="description"
                  v-model="form.description"
                  rows="8"
                  placeholder="Describe the role, responsibilities, and requirements…"
                  class="w-full rounded-lg border px-4 py-3 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  :class="errors.description ? 'border-danger-300 ring-1 ring-danger-100' : 'border-surface-300 dark:border-surface-700'"
                />
                <div class="mt-1.5 flex items-start justify-between gap-3">
                  <p v-if="errors.description" class="text-xs text-danger-600 dark:text-danger-400 font-medium">{{ errors.description }}</p>
                  <p v-else class="text-xs text-surface-500">A clear description improves AI scoring and attracts better candidates.</p>
                  <span
                    class="shrink-0 text-xs tabular-nums"
                    :class="descriptionChars < MIN_DESCRIPTION_CHARS ? 'text-surface-400 dark:text-surface-500' : 'text-success-600 dark:text-success-400'"
                  >
                    {{ Math.min(descriptionChars, MIN_DESCRIPTION_CHARS) }} / {{ MIN_DESCRIPTION_CHARS }}
                  </span>
                </div>
              </div>
            </section>

            <!-- Step 2: Application form -->
            <!-- Step 2: Application form (live builder) -->
            <section v-else-if="currentStep === 2">
              <ApplicationBuilder
                v-model="applicationForm"
                :job-title="form.title"
                :show-preview="false"
              />

              <!--
                One line, no card: the scoring step is being written from the job
                description while this step is open, so it does not arrive
                unexplained.
              -->
              <p
                v-if="autoCriteriaState === 'running' || autoCriteriaState === 'done'"
                class="mt-8 flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400"
              >
                <template v-if="autoCriteriaState === 'running'">
                  <Loader2 class="size-3.5 shrink-0 animate-spin text-brand-500 dark:text-brand-400" />
                  AI is reading your job description to write scoring criteria for step 3.
                </template>
                <template v-else>
                  <Sparkles class="size-3.5 shrink-0 text-brand-500 dark:text-brand-400" />
                  Scoring criteria written from your job description — review them in step 3.
                </template>
              </p>
            </section>

            <!-- Step 3: AI scoring criteria -->
            <section v-else-if="currentStep === 3" class="space-y-8">

              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100">Candidate scoring</h2>
                  <span class="inline-flex items-center rounded-md bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-surface-500 dark:text-surface-400">Optional</span>
                </div>
                <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
                  <span class="font-medium text-surface-700 dark:text-surface-300">This step is optional — you can skip it and set up scoring later from job settings.</span>
                  Every applicant is ranked against the criteria below. They're written from your job description, so read them over and change anything that doesn't fit.
                </p>
              </div>

                <!-- Criteria being written from the description -->
                <div
                  v-if="autoCriteriaState === 'running' && scoringCriteria.length === 0 && !showAdvanced"
                  class="rounded-2xl border border-brand-200/80 dark:border-brand-800/60 bg-gradient-to-br from-brand-50 via-white to-white dark:from-brand-950/40 dark:via-surface-900 dark:to-surface-900 p-6 shadow-sm"
                >
                  <div class="flex items-start gap-4">
                    <div class="inline-flex items-center justify-center size-11 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm shadow-brand-600/20 shrink-0">
                      <Loader2 class="size-5 animate-spin" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <h3 class="text-base font-semibold text-surface-900 dark:text-surface-100">Writing scoring criteria</h3>
                      <p class="text-sm text-surface-500 dark:text-surface-400 mt-1 leading-relaxed">
                        Reading your job description to work out what actually matters for this role.
                      </p>
                      <div class="flex flex-wrap gap-2 mt-4">
                        <span v-for="n in 4" :key="n" class="h-6 w-28 animate-pulse rounded-lg bg-surface-100 dark:bg-surface-800" />
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Recommended default: one-click, zero decisions -->
                <div v-else-if="scoringCriteria.length === 0 && !showAdvanced" class="space-y-5">
                  <div class="relative overflow-hidden rounded-2xl border border-brand-200/80 dark:border-brand-800/60 bg-gradient-to-br from-brand-50 via-white to-white dark:from-brand-950/40 dark:via-surface-900 dark:to-surface-900 p-6 shadow-sm">
                    <!-- Decorative glow -->
                    <div class="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-brand-200/30 dark:bg-brand-700/10 blur-3xl" />

                    <div class="relative flex items-start gap-4">
                      <div class="inline-flex items-center justify-center size-11 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm shadow-brand-600/20 shrink-0">
                        <Sparkles class="size-5" />
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <h3 class="text-base font-semibold text-surface-900 dark:text-surface-100">Recommended scoring</h3>
                          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset bg-brand-100 text-brand-700 ring-brand-200 dark:bg-brand-950/60 dark:text-brand-300 dark:ring-brand-800">
                            {{ recommendedCriteria.length }} criteria
                          </span>
                        </div>
                        <p class="text-sm text-surface-500 dark:text-surface-400 mt-1 leading-relaxed">
                          A balanced set tailored to this role. AI ranks every applicant against these — you can tweak or remove any of them after.
                        </p>

                        <!-- Criteria preview chips -->
                        <ul class="flex flex-wrap gap-2 mt-4">
                          <li
                            v-for="c in recommendedCriteria"
                            :key="c.key"
                            class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset"
                            :class="categoryColorClasses[c.category] ?? categoryColorClasses.custom"
                          >
                            {{ c.name }}
                          </li>
                        </ul>

                        <div class="flex flex-wrap items-center gap-2.5 mt-5">
                          <button
                            type="button"
                            class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 active:scale-[0.99] transition-all"
                            @click="useRecommendedScoring"
                          >
                            <Check class="size-4" />
                            Use recommended scoring
                          </button>
                          <button
                            type="button"
                            class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 px-4 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                            @click="showAdvanced = true"
                          >
                            <SlidersHorizontal class="size-4" />
                            Customize instead
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Skip option -->
                  <div class="flex items-center gap-3">
                    <div class="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
                    <span class="text-xs font-medium text-surface-400 dark:text-surface-500">or</span>
                    <div class="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
                  </div>
                  <button
                    type="button"
                    class="group flex w-full items-center gap-3 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-5 py-4 text-left hover:border-surface-300 dark:hover:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
                    @click="skipScoring"
                  >
                    <div class="inline-flex items-center justify-center size-10 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 shrink-0">
                      <ArrowRight class="size-5" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">Skip scoring for now</span>
                      <span class="block text-xs text-surface-500 dark:text-surface-400 mt-0.5">Continue without AI scoring — you can set this up anytime from job settings.</span>
                    </div>
                    <ChevronRight class="size-5 text-surface-300 dark:text-surface-600 group-hover:text-surface-400 dark:group-hover:text-surface-500 transition-colors shrink-0" />
                  </button>
                </div>

                <!-- Back to recommended (from advanced) -->
                <button
                  v-if="scoringCriteria.length === 0 && showAdvanced"
                  type="button"
                  class="inline-flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200 transition-colors"
                  @click="showAdvanced = false"
                >
                  <ArrowLeft class="size-3.5" />
                  Back to recommended
                </button>

                <!-- AI not configured warning -->
                <div v-if="!isAiConfigured && showAdvanced" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-5">
                  <div class="flex items-start gap-3">
                    <Sparkles class="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">AI provider not configured</p>
                      <p class="text-xs text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
                        To use AI-powered scoring, you need to configure an AI provider first. You can still define criteria manually and set up AI later.
                      </p>
                      <NuxtLink
                        :to="$localePath('/dashboard/settings/ai')"
                        class="inline-flex items-center gap-1.5 mt-3 text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline underline-offset-2"
                      >
                        <ExternalLink class="size-3" />
                        Go to AI settings
                      </NuxtLink>
                    </div>
                  </div>
                </div>

                <!-- Mode selection cards -->
                <div v-if="scoringCriteria.length === 0 && showAdvanced" class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <!-- Pre-made templates -->
                  <button
                    type="button"
                    class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md"
                    :class="scoringMode === 'premade'
                      ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                      : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700'"
                    @click="scoringMode = 'premade'"
                  >
                    <div class="inline-flex items-center justify-center size-10 rounded-lg bg-brand-100 dark:bg-brand-900/50">
                      <Brain class="size-5 text-brand-600 dark:text-brand-400" />
                    </div>
                    <div>
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">Pre-made templates</span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                        Choose from expert-designed scoring rubrics for common role types.
                      </span>
                    </div>
                  </button>

                  <!-- AI from job description -->
                  <button
                    type="button"
                    :disabled="!isAiConfigured"
                    class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    :class="scoringMode === 'ai'
                      ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                      : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700'"
                    @click="generateAiCriteria()"
                  >
                    <div class="inline-flex items-center justify-center size-10 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                      <Sparkles class="size-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">Generate from job description</span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                        AI analyzes your job description and creates tailored criteria.
                      </span>
                      <span v-if="!isAiConfigured" class="text-[10px] text-amber-600 dark:text-amber-400 mt-1 block">
                        Requires AI provider setup
                      </span>
                    </div>
                    <span v-if="isGeneratingCriteria" class="absolute top-3 right-3">
                      <Loader2 class="size-4 text-purple-600 animate-spin" />
                    </span>
                  </button>

                  <!-- Custom criteria -->
                  <button
                    type="button"
                    class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md"
                    :class="scoringMode === 'custom'
                      ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                      : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700'"
                    @click="scoringMode = 'custom'; showCustomForm = true"
                  >
                    <div class="inline-flex items-center justify-center size-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
                      <SlidersHorizontal class="size-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">Write your own</span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                        Create custom scoring criteria tailored to your exact needs.
                      </span>
                    </div>
                  </button>
                </div>

                <!-- Pre-made template selector -->
                <div v-if="scoringMode === 'premade' && scoringCriteria.length === 0 && showAdvanced" class="space-y-4 mt-4">
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button
                      v-for="tmpl in [
                        { key: 'standard', label: 'Standard', desc: '3 balanced criteria for any role' },
                        { key: 'technical', label: 'Technical', desc: '5 criteria focused on engineering' },
                        { key: 'non_technical', label: 'Non-Technical', desc: '5 criteria for business roles' },
                      ] as const"
                      :key="tmpl.key"
                      type="button"
                      class="p-4 rounded-lg border text-left transition-all"
                      :class="selectedTemplate === tmpl.key
                        ? 'border-brand-400 dark:border-brand-600 bg-brand-50 dark:bg-brand-950/30'
                        : 'border-surface-200 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50'"
                      @click="selectedTemplate = tmpl.key; loadPremadeCriteria(tmpl.key)"
                    >
                      <span class="block text-sm font-medium text-surface-900 dark:text-surface-100">{{ tmpl.label }}</span>
                      <span class="text-xs text-surface-500">{{ tmpl.desc }}</span>
                    </button>
                  </div>
                </div>

                <!-- Criteria list with weight sliders -->
                <div v-if="scoringCriteria.length > 0" class="space-y-4">
                  <div class="flex items-center justify-between">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-xs font-medium text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200 transition-colors"
                      @click="scoringCriteria = []; scoringMode = 'none'; showAdvanced = false"
                    >
                      <ArrowLeft class="size-3.5" />
                      Back to options
                    </button>
                    <div class="flex items-center gap-2">
                      <!-- Where the list came from, in the row that was already there. -->
                      <span
                        v-if="autoCriteriaState === 'done'"
                        class="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-950/60 dark:text-brand-300 dark:ring-brand-800"
                        title="AI read your job description and wrote these criteria. Edit the weights, remove any that don't fit, or use “Back to options” for a template instead."
                      >
                        <Sparkles class="size-3" />
                        Written by AI from your description
                      </span>
                      <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">
                        {{ scoringCriteria.length }} {{ scoringCriteria.length === 1 ? 'criterion' : 'criteria' }} configured
                      </h3>
                    </div>
                  </div>

                  <div class="space-y-3" :class="criteriaRevealing && 'criteria-reveal'">
                    <div
                      v-for="(criterion, criterionIndex) in scoringCriteria"
                      :key="criterion.key"
                      class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 transition-all hover:shadow-sm"
                      :style="criteriaRevealing ? { animationDelay: `${Math.min(criterionIndex, 8) * 70}ms` } : undefined"
                    >
                      <div class="flex items-start justify-between gap-3 mb-3">
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2 mb-1">
                            <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ criterion.name }}</span>
                            <span
                              class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset"
                              :class="categoryColorClasses[criterion.category] ?? categoryColorClasses.custom"
                            >
                              {{ categoryLabels[criterion.category] ?? criterion.category }}
                            </span>
                          </div>
                          <p v-if="criterion.description" class="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
                            {{ criterion.description }}
                          </p>
                        </div>
                        <button
                          type="button"
                          class="rounded p-1 text-surface-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950 transition-colors shrink-0"
                          title="Remove"
                          @click="removeCriterion(criterion.key)"
                        >
                          <Trash2 class="size-4" />
                        </button>
                      </div>

                      <!-- Weight slider -->
                      <div class="flex items-center gap-4">
                        <label class="text-xs font-medium text-surface-500 dark:text-surface-400 shrink-0 w-12">Weight</label>
                        <input
                          type="range"
                          :min="0"
                          :max="100"
                          v-model.number="criterion.weight"
                          class="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-brand-600 bg-surface-200 dark:bg-surface-700"
                        />
                        <span class="text-xs font-mono font-semibold text-surface-700 dark:text-surface-300 w-8 text-right">
                          {{ criterion.weight }}
                        </span>
                      </div>

                      <div class="flex items-center gap-4 mt-2 text-xs text-surface-400">
                        <span>Max score: {{ criterion.maxScore }}</span>
                        <span>Key: <code class="rounded bg-surface-100 dark:bg-surface-800 px-1 py-0.5 font-mono text-[10px]">{{ criterion.key }}</code></span>
                      </div>
                    </div>
                  </div>

                  <!-- Add another criterion -->
                  <button
                    v-if="!showCustomForm"
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-surface-300 dark:border-surface-700 px-3 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:border-brand-400 dark:hover:border-brand-600 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors"
                    @click="showCustomForm = true"
                  >
                    <Plus class="size-4" />
                    Add criterion
                  </button>
                </div>

                <!-- Custom criterion form -->
                <div v-if="showCustomForm" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5 space-y-4">
                  <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">Add custom criterion</h3>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">Name *</label>
                      <input
                        v-model="customCriterionForm.name"
                        @input="customCriterionForm.key = autoGenerateKey(customCriterionForm.name)"
                        type="text"
                        maxlength="200"
                        placeholder="e.g. React Expertise"
                        class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">Category</label>
                      <select
                        v-model="customCriterionForm.category"
                        class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        <option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">Description</label>
                    <textarea
                      v-model="customCriterionForm.description"
                      rows="2"
                      maxlength="1000"
                      placeholder="Describe what the AI should evaluate for this criterion..."
                      class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">Max Score</label>
                      <input
                        v-model.number="customCriterionForm.maxScore"
                        type="number"
                        min="1"
                        max="100"
                        class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">Initial Weight (0–100)</label>
                      <input
                        v-model.number="customCriterionForm.weight"
                        type="number"
                        min="0"
                        max="100"
                        class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                  </div>
                  <div class="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      :disabled="!customCriterionForm.name"
                      class="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      @click="addCustomCriterion"
                    >
                      Add criterion
                    </button>
                    <button
                      type="button"
                      class="px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors"
                      @click="showCustomForm = false"
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                <!-- Auto-score toggle -->
                <div v-if="scoringCriteria.length > 0" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <label class="flex items-start gap-3 cursor-pointer">
                    <input
                      v-model="autoScoreOnApply"
                      type="checkbox"
                      :disabled="!isAiConfigured"
                      class="mt-0.5 size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <div>
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">
                        Automatically score every new applicant
                      </span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 mt-0.5 block leading-relaxed">
                        When a candidate applies, AI will automatically analyze their resume against these criteria and assign a score. Requires an AI provider configured in settings plus a resume upload.
                      </span>
                      <span v-if="!isAiConfigured" class="text-xs text-amber-600 dark:text-amber-400 mt-1 block">
                        <NuxtLink :to="$localePath('/dashboard/settings/ai')" class="underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-200">Configure an AI provider</NuxtLink> to enable automatic scoring.
                      </span>
                    </div>
                  </label>
                </div>

            </section>

            <!-- Step 4: Publish & Distribute -->
            <section v-else-if="currentStep === 4" class="space-y-8">
              <!-- Success state after publishing -->
              <div v-if="isPublished" class="space-y-8">
                <!-- Compact success header -->
                <div class="flex items-center gap-4 rounded-xl border border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-950/30 p-5">
                  <div class="inline-flex items-center justify-center size-12 rounded-full bg-success-100 dark:bg-success-900/50 shrink-0">
                    <PartyPopper class="size-6 text-success-600 dark:text-success-400" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <h2 class="text-lg font-bold text-surface-900 dark:text-surface-100">Your job is live!</h2>
                    <p class="text-sm text-surface-500 dark:text-surface-400">
                      <strong>{{ form.title }}</strong> is now accepting applications.
                    </p>
                    <!-- The publish button promised a copy — say whether it happened. -->
                    <p
                      v-if="finalCopyState === 'copied'"
                      class="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-success-700 dark:text-success-400"
                    >
                      <Check class="size-3.5 shrink-0" />
                      Application link copied to your clipboard.
                    </p>
                    <p
                      v-else-if="finalCopyState === 'failed'"
                      class="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-warning-700 dark:text-warning-400"
                    >
                      <AlertTriangle class="size-3.5 shrink-0" />
                      We couldn't copy the link — copy it from Application link below.
                    </p>
                  </div>
                  <NuxtLink
                    :to="finalApplicationLink"
                    target="_blank"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-brand-700 dark:text-brand-300 bg-brand-100 dark:bg-brand-900/50 rounded-lg hover:bg-brand-200 dark:hover:bg-brand-800 transition-colors shrink-0"
                  >
                    <ExternalLink class="size-3.5" />
                    Preview
                  </NuxtLink>
                </div>

                <!-- Career page upgrade nudge (free orgs) -->
                <div
                  v-if="!canUseCareerPage"
                  class="flex items-start gap-3 rounded-xl border border-brand-200 dark:border-brand-900/60 bg-brand-50/60 dark:bg-brand-950/20 px-5 py-4"
                >
                  <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-violet-600 text-white">
                    <Globe2 class="size-4" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-surface-900 dark:text-surface-100">
                      Put this role on a branded career page
                    </p>
                    <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                      A public page for all your open roles — available on the Solo plan and above.
                    </p>
                  </div>
                  <NuxtLink
                    :to="$localePath('/dashboard/settings/career-page')"
                    class="inline-flex shrink-0 items-center gap-1 self-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 no-underline"
                  >
                    Learn more
                  </NuxtLink>
                </div>

                <!-- Distribution hub. Shared with the Promote tab so the whole
                     surface survives leaving this page. -->
                <JobPromotePanel v-if="createdJobId" :job-id="createdJobId" compact />

                <!-- Action buttons -->
                <div class="flex items-center justify-between pt-6 border-t border-surface-100 dark:border-surface-800">
                  <NuxtLink
                    :to="$localePath(`/dashboard/jobs/${createdJobId}`)"
                    class="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-700 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                  >
                    <Eye class="size-4" />
                    View job
                  </NuxtLink>
                  <NuxtLink
                    :to="$localePath('/dashboard')"
                    class="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors shadow-sm"
                  >
                    Go to dashboard
                  </NuxtLink>
                </div>
              </div>

              <!--
                Test mode has no publish-or-draft decision to make: the role is
                not going anywhere public either way, so offering the choice
                would only be a question with no consequence. The one button
                leads where the walkthrough was always heading.
              -->
              <div v-else-if="isTestMode">
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2 pb-2 border-b border-surface-100 dark:border-surface-800">Ready to see it work?</h2>
                <p class="text-sm text-surface-500 dark:text-surface-400 mb-6">
                  Your test job opens inside your workspace, and a handful of sample applicants apply to it straight away — already scored against the criteria you just set. A knockout rule on the first question rejects the ones with under a year of experience before they are scored. Nothing is published anywhere public.
                </p>

                <button
                  type="submit"
                  :disabled="isSubmitting || isPopulatingSample"
                  class="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
                >
                  <Loader2 v-if="isSubmitting || isPopulatingSample" class="size-4 animate-spin" />
                  <Sparkles v-else class="size-4" />
                  {{ isPopulatingSample ? 'Bringing in applicants…' : isSubmitting ? 'Creating your test job…' : 'Create test job and see applicants' }}
                </button>

                <p class="mt-3 text-center text-xs text-surface-400 dark:text-surface-500">
                  You can delete this job and its sample applicants at any time.
                </p>
              </div>

              <!-- Pre-publish state: choose publish or draft -->
              <div v-else>
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2 pb-2 border-b border-surface-100 dark:border-surface-800">Ready to go?</h2>
                <p class="text-sm text-surface-500 dark:text-surface-400 mb-6">
                  Publish your job to start receiving applications. After publishing, you'll be able to create tracked links for each platform where you share it.
                </p>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  <!-- Publish now option -->
                  <button
                    type="button"
                    class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all"
                    :class="publishChoice === 'publish'
                      ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                      : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800/50'"
                    @click="publishChoice = 'publish'"
                  >
                    <span
                      v-if="publishChoice === 'publish'"
                      class="absolute top-3 right-3 inline-flex items-center justify-center size-5 rounded-full bg-brand-600 text-white"
                    >
                      <Check class="size-3" />
                    </span>
                    <div class="inline-flex items-center justify-center size-10 rounded-lg bg-brand-100 dark:bg-brand-900/50">
                      <Rocket class="size-5 text-brand-600 dark:text-brand-400" />
                    </div>
                    <div>
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">Publish now</span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                        Your job goes live immediately. The application link will be copied to your clipboard so you can share it right away.
                      </span>
                    </div>
                  </button>

                  <!-- Save as draft option -->
                  <button
                    type="button"
                    class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all"
                    :class="publishChoice === 'draft'
                      ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                      : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800/50'"
                    @click="publishChoice = 'draft'"
                  >
                    <span
                      v-if="publishChoice === 'draft'"
                      class="absolute top-3 right-3 inline-flex items-center justify-center size-5 rounded-full bg-brand-600 text-white"
                    >
                      <Check class="size-3" />
                    </span>
                    <div class="inline-flex items-center justify-center size-10 rounded-lg bg-surface-100 dark:bg-surface-800">
                      <FileEdit class="size-5 text-surface-500 dark:text-surface-400" />
                    </div>
                    <div>
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">Save as draft</span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                        Save for later review. The job won't be visible to candidates until you publish it.
                      </span>
                    </div>
                  </button>
                </div>

                <!-- Syndication is opt-out, not automatic. Placed with the
                     publish decision because that is the moment it takes
                     effect, and because a role sent to the aggregators cannot
                     be recalled from them on the same day it goes out. -->
                <label
                  v-if="publishChoice === 'publish'"
                  class="mb-8 flex cursor-pointer items-start gap-3 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5"
                >
                  <input
                    v-model="distributeToBoards"
                    type="checkbox"
                    class="mt-0.5 size-4 shrink-0 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500"
                  />
                  <div>
                    <span class="flex items-center gap-1.5 text-sm font-medium text-surface-900 dark:text-surface-100">
                      <Globe2 class="size-3.5 text-surface-400" />
                      Also list on external job boards
                    </span>
                    <p class="mt-1 text-xs leading-relaxed text-surface-500 dark:text-surface-400">
                      Free syndication to Jooble, Adzuna, Careerjet, Talent.com and others.
                      Turn it off for a confidential or internal-only search — the role still
                      gets its application link and its place on your career page.
                    </p>
                  </div>
                </label>

                <!-- Publishing while these are unmet would put the role live but
                     invisible on every job board. Say so here rather than
                     bouncing the user back to step 1 on submit. -->
                <div
                  v-if="publishChoice === 'publish' && publishBlockers.length"
                  class="flex items-start gap-2.5 rounded-xl border border-warning-200 dark:border-warning-900 bg-warning-50 dark:bg-warning-950/30 p-4"
                >
                  <Globe2 class="size-4 shrink-0 mt-0.5 text-warning-600 dark:text-warning-400" />
                  <div class="text-xs leading-relaxed text-warning-800 dark:text-warning-300">
                    <p>This role isn't ready for job boards yet:</p>
                    <ul class="mt-1.5 list-disc space-y-1 pl-4">
                      <li v-for="blocker in publishBlockers" :key="blocker.code">{{ blocker.reason }}</li>
                    </ul>
                    <button type="button" class="mt-2 font-semibold underline" @click="goToStep(1)">Fix in Job details</button>
                  </div>
                </div>

                <!-- Summary of what was configured -->
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">Job summary</h3>
                  <dl class="space-y-3 text-sm">
                    <div class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <Briefcase class="size-3.5" /> Title
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100 font-medium">{{ form.title }}</dd>
                    </div>
                    <div v-if="locationDisplay" class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <Link2 class="size-3.5" /> Location
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">{{ locationDisplay }}</dd>
                    </div>
                    <div v-if="salarySummary" class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <Banknote class="size-3.5" /> Pay
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">{{ salarySummary }}</dd>
                    </div>
                    <div class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <FileText class="size-3.5" /> Resume
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">{{ applicationForm.requireResume ? 'Required' : 'Optional' }}</dd>
                    </div>
                    <div class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <MessageSquare class="size-3.5" /> Questions
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">{{ applicationForm.questions.length }} custom {{ applicationForm.questions.length === 1 ? 'question' : 'questions' }}</dd>
                    </div>
                  </dl>
                </div>

                <!-- What happens next hint -->
                <div v-if="publishChoice === 'publish'" class="rounded-xl border border-brand-100 dark:border-brand-900 bg-brand-50/50 dark:bg-brand-950/20 p-4 mt-6">
                  <div class="flex items-start gap-3">
                    <Share2 class="size-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
                    <div>
                      <p class="text-sm font-medium text-brand-800 dark:text-brand-200">After publishing</p>
                      <p class="text-xs text-brand-700 dark:text-brand-300 mt-0.5 leading-relaxed">
                        You'll get tracked links for LinkedIn, Indeed, and other platforms so you can see exactly where your applicants come from.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- Actions Footer -->
            <div v-if="!isPublished" class="flex items-center justify-between mt-12 pt-8 border-t border-surface-100 dark:border-surface-800">
              <NuxtLink
                :to="$localePath('/dashboard')"
                class="px-6 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              >
                Cancel
              </NuxtLink>

              <div class="flex items-center gap-3">
                <button
                  v-if="currentStep > 1"
                  type="button"
                  @click="prevStep"
                  class="px-6 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-700 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                >
                  Back
                </button>
                <button
                  v-if="currentStep < 4"
                  type="button"
                  :disabled="!canGoNext"
                  @click="nextStep"
                  class="px-8 py-2.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  Save &amp; continue
                </button>
                <button
                  v-else
                  type="submit"
                  :disabled="isSubmitting"
                  class="inline-flex items-center gap-2 px-8 py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                  :class="publishChoice === 'publish' ? 'bg-brand-600 hover:bg-brand-700' : 'bg-surface-600 hover:bg-surface-700'"
                >
                  <Rocket v-if="publishChoice === 'publish'" class="size-4" />
                  <FileEdit v-else class="size-4" />
                  {{ isSubmitting
                    ? (publishChoice === 'publish' ? 'Publishing...' : 'Saving...')
                    : (publishChoice === 'publish' ? 'Publish & copy link' : 'Save as draft')
                  }}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <aside
        v-if="currentStep <= 2"
        class="hidden min-w-0 xl:block xl:min-h-0 xl:overflow-hidden"
      >
        <ApplicationBuilderPreview
          :application-form="applicationForm"
          :job-details="previewJobDetails"
          max-height="100%"
        />
      </aside>
    </div>

    <JobLimitUpsellModal
      v-if="showLimitUpsell"
      :limit="limitUpsellMax"
      :can-manage="canManageBilling"
      :saving-draft="isSubmitting"
      @close="showLimitUpsell = false"
      @save-draft="saveAsDraftFromUpsell"
    />
  </div>
</template>

<style scoped>
button:not(:disabled) {
  cursor: pointer;
}

/*
 * Test mode only: each step's pre-filled content settles in rather than
 * snapping, so the wizard reads as filling itself in for you. Opacity and a
 * small offset only — nothing here moves layout or blocks input, so the fields
 * stay usable for the whole 420ms.
 */
.sample-reveal :deep(section) {
  animation: sample-reveal 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes sample-reveal {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sample-reveal :deep(section) {
    animation: none;
  }
}

/*
 * Step 3's criteria are written while step 2 is open, so they would otherwise be
 * sitting there fully formed on arrival. Each card settles in one after the
 * other instead — opacity and a few pixels, nothing that blocks editing.
 */
.criteria-reveal > * {
  animation: criteria-reveal 340ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes criteria-reveal {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .criteria-reveal > * {
    animation: none;
  }
}
</style>
