<script setup lang="ts">
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-vue-next'
import { getBillingPlan } from '~~/shared/billing'

definePageMeta({
  layout: 'auth',
  middleware: ['auth'],
})

useSeoMeta({
  title: 'Welcome — Reqcore',
  description: 'A few quick questions to set up your workspace',
  robots: 'noindex, nofollow',
})

const route = useRoute()
const localePath = useLocalePath()
const { track, captureError, setPersonProperties } = useTrack()
const { questions, personProps } = useOnboardingSurvey()

// ── Plan context (threaded from pricing → sign-up → create-org → here) ──
const checkoutIntent = computed(() => parseBillingCheckoutIntent(route.query))
const isFreePlan = computed(() => hasFreePlanIntent(route.query))
const planId = computed(() =>
  checkoutIntent.value?.planId ?? (isFreePlan.value ? 'free' : null),
)
const cadence = computed(() => checkoutIntent.value?.cadence ?? null)
const planLabel = computed(() => {
  if (!planId.value) return null
  if (planId.value === 'free') return 'Free'
  return getBillingPlan(planId.value)?.name ?? null
})

// After the survey we continue exactly where create-org would have sent the
// user: straight to secure checkout for a paid plan, otherwise the dashboard.
const destination = computed(() =>
  checkoutIntent.value
    ? localePath({
        path: '/dashboard/settings/billing',
        query: buildBillingCheckoutQuery(checkoutIntent.value),
      })
    : localePath('/dashboard'),
)

// ── Step state ──
const total = questions.length
const stepIndex = ref(0)
const answers = reactive<Record<string, string | undefined>>({})
const isFinishing = ref(false)
// Locks input during the brief auto-advance animation so a fast double-click
// can't skip the next question.
const isAdvancing = ref(false)

const question = computed(() => questions[stepIndex.value]!)
const progress = computed(() => Math.round(((stepIndex.value + 1) / total) * 100))

// A, B, C… key badges give each option a tactile, keyboard-y feel.
const optionKeys = 'ABCDEFGHIJ'

const trackBase = computed(() => ({
  plan: planId.value ?? 'none',
  billing: cadence.value ?? undefined,
}))

onMounted(() => track('onboarding_survey_started', { ...trackBase.value }))

watch(stepIndex, (index) => {
  track('onboarding_survey_step_viewed', {
    ...trackBase.value,
    step: index + 1,
    question_id: questions[index]?.id,
  })
}, { immediate: true })

const isLastStep = computed(() => stepIndex.value === total - 1)

function answeredEntries() {
  return Object.fromEntries(
    questions.filter(q => answers[q.id]).map(q => [q.id, answers[q.id]]),
  )
}

// Persist the answers gathered so far. Fired after every choice/skip so an
// abandoned survey leaves partial rows instead of nothing; `completed: true`
// only on the final step. Fire-and-forget — a save must never block advancing.
async function saveProgress(completed = false) {
  try {
    await $fetch('/api/onboarding-survey', {
      method: 'POST',
      body: {
        answers: answeredEntries(),
        plan: planId.value ?? undefined,
        billing: cadence.value ?? undefined,
        completed,
      },
    })
  }
  catch (error) {
    captureError(error, {
      area: 'onboarding_survey',
      action: completed ? 'save_response' : 'save_progress',
    })
  }
}

function advance() {
  if (stepIndex.value < total - 1) {
    stepIndex.value += 1
    isAdvancing.value = false
  }
  else {
    void finish()
  }
}

function selectOption(value: string) {
  if (isAdvancing.value || isFinishing.value) return
  answers[question.value.id] = value
  // The final answer is persisted by finish() as a completion; every earlier
  // answer is saved here so a mid-survey drop-off is still captured.
  if (!isLastStep.value) void saveProgress()
  isAdvancing.value = true
  // Frictionless, Typeform-style: a choice moves you forward. Back fixes slips.
  setTimeout(advance, 180)
}

// ─────────────────────────────────────────────
// Keyboard navigation
// ─────────────────────────────────────────────
// Roving focus over the option buttons: every question opens with the top
// option highlighted and focused, so Enter alone answers it and ↑/↓ move the
// selection. Plain DOM refs (not a ref()) — we only read them to call focus().
const optionButtons: (HTMLButtonElement | null)[] = []
const highlightedIndex = ref(0)

function focusOption(index: number) {
  const count = question.value.options.length
  if (!count) return
  highlightedIndex.value = ((index % count) + count) % count
  optionButtons[highlightedIndex.value]?.focus()
}

// Moving between questions resets the highlight. Coming back to an answered
// question highlights the answer you already gave rather than the top option.
watch(question, (q) => {
  optionButtons.length = 0
  const answered = q.options.findIndex(o => o.value === answers[q.id])
  highlightedIndex.value = answered === -1 ? 0 : answered
})

// The question is inside a <Transition mode="out-in">, so the new buttons only
// exist once the enter transition has run — focus from there, and from
// onMounted for the first question (which doesn't animate in).
onMounted(() => focusOption(highlightedIndex.value))

function onQuestionEntered() {
  focusOption(highlightedIndex.value)
}

// Listening on the document (not just the card) keeps ↑/↓ working after a
// click lands on non-focusable page chrome.
function onArrowKeys(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  if (isAdvancing.value || isFinishing.value) return
  event.preventDefault()
  focusOption(highlightedIndex.value + (event.key === 'ArrowDown' ? 1 : -1))
}

onMounted(() => document.addEventListener('keydown', onArrowKeys))
onBeforeUnmount(() => document.removeEventListener('keydown', onArrowKeys))

function skip() {
  if (isAdvancing.value || isFinishing.value) return
  track('onboarding_survey_question_skipped', {
    ...trackBase.value,
    question_id: question.value.id,
  })
  if (!isLastStep.value) void saveProgress()
  isAdvancing.value = true
  advance()
}

function back() {
  if (isAdvancing.value || isFinishing.value || stepIndex.value === 0) return
  stepIndex.value -= 1
}

async function finish() {
  if (isFinishing.value) return
  isFinishing.value = true

  const answered = questions.filter(q => answers[q.id])
  const skipped = questions.filter(q => !answers[q.id])
  const finalAnswers = answeredEntries()

  await saveProgress(true)

  // Person properties — durable, account-level segmentation on the user's
  // PostHog profile. Only write answers that were actually given.
  const profile: Record<string, unknown> = {
    [personProps.completed]: true,
  }
  if (planId.value) profile[personProps.plan] = planId.value
  if (cadence.value) profile[personProps.billing] = cadence.value
  for (const q of answered) profile[q.id] = answers[q.id]
  setPersonProperties(profile)

  // Event — one row per finished survey, tagged with the plan they clicked.
  track('onboarding_survey_completed', {
    ...trackBase.value,
    answered_count: answered.length,
    skipped_count: skipped.length,
    ...finalAnswers,
  })

  await navigateTo(destination.value)
}
</script>

<template>
  <div class="flex flex-col gap-7">
    <!-- Header: plan-aware, but one shared flow for every plan -->
    <div class="flex flex-col gap-3">
      <div
        v-if="planLabel"
        class="inline-flex w-fit items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-300"
      >
        <Sparkles class="size-3.5" />
        {{ planLabel }} plan selected
      </div>
      <div>
        <h2 class="text-2xl font-semibold tracking-tight text-surface-900 dark:text-surface-100">
          Let's tailor ATS to you
        </h2>
        <p class="mt-1.5 text-sm text-surface-500 dark:text-surface-400">
          Four quick questions — skip any you'd rather not answer.
        </p>
      </div>
    </div>

    <!-- Progress: segmented steps + count -->
    <div class="flex items-center gap-4">
      <div class="flex flex-1 gap-1.5">
        <span
          v-for="n in total"
          :key="n"
          class="h-1.5 flex-1 rounded-full transition-colors duration-300"
          :class="n <= stepIndex + 1
            ? 'bg-brand-600 dark:bg-brand-500'
            : 'bg-surface-200 dark:bg-surface-800'"
        />
      </div>
      <span class="shrink-0 text-xs font-medium tabular-nums text-surface-400">
        {{ stepIndex + 1 }} / {{ total }}
      </span>
    </div>

    <!-- Question -->
    <Transition name="survey-fade" mode="out-in" @after-enter="onQuestionEntered">
      <div :key="question.id" class="flex flex-col gap-5">
        <div>
          <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-100">
            {{ question.title }}
          </h3>
          <p v-if="question.subtitle" class="mt-1 text-sm text-surface-500 dark:text-surface-400">
            {{ question.subtitle }}
          </p>
        </div>

        <div class="flex flex-col gap-2.5">
          <button
            v-for="(option, i) in question.options"
            :key="option.value"
            :ref="el => { optionButtons[i] = el as HTMLButtonElement | null }"
            type="button"
            :disabled="isFinishing"
            :tabindex="highlightedIndex === i ? 0 : -1"
            class="group flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-sm font-medium transition-all cursor-pointer outline-none disabled:cursor-not-allowed"
            :class="[
              answers[question.id] === option.value
                ? 'border-brand-500 bg-brand-50 text-brand-900 shadow-sm ring-1 ring-brand-500/20 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-100'
                : 'border-surface-200 bg-white text-surface-800 hover:border-brand-400 hover:shadow-sm dark:border-surface-800 dark:bg-surface-900 dark:text-surface-200 dark:hover:border-brand-700',
              highlightedIndex === i && answers[question.id] !== option.value
                ? 'border-brand-400 ring-2 ring-brand-500/25 dark:border-brand-600'
                : '',
            ]"
            @click="selectOption(option.value)"
            @focus="highlightedIndex = i"
          >
            <span
              class="flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold transition-colors"
              :class="answers[question.id] === option.value
                ? 'border-brand-500 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-600'
                : 'border-surface-200 bg-surface-50 text-surface-500 group-hover:border-brand-300 group-hover:text-brand-600 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-400'"
            >
              {{ optionKeys[i] }}
            </span>
            <span class="flex-1">{{ option.label }}</span>
            <Check
              v-if="answers[question.id] === option.value"
              class="size-4 shrink-0 text-brand-600 dark:text-brand-400"
              :stroke-width="3"
            />
          </button>
        </div>
      </div>
    </Transition>

    <!-- Controls -->
    <div class="flex items-center justify-between pt-1">
      <button
        type="button"
        :disabled="stepIndex === 0 || isFinishing"
        class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-surface-500 transition-colors hover:text-surface-800 disabled:cursor-not-allowed disabled:opacity-0 dark:text-surface-400 dark:hover:text-surface-100"
        @click="back"
      >
        <ArrowLeft class="size-4" />
        Back
      </button>

      <button
        type="button"
        :disabled="isFinishing"
        class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-surface-500 transition-colors hover:text-surface-800 disabled:cursor-not-allowed dark:text-surface-400 dark:hover:text-surface-100"
        @click="skip"
      >
        {{ stepIndex === total - 1 ? 'Skip & finish' : 'Skip' }}
        <ArrowRight class="size-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.survey-fade-enter-active,
.survey-fade-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}

.survey-fade-enter-from {
  opacity: 0;
  transform: translateX(8px);
}

.survey-fade-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
