<script setup lang="ts">
import { MapPin, Briefcase, Building2, ArrowLeft, ExternalLink, Calendar, ChevronRight } from 'lucide-vue-next'
import { markdownToPlainText, markdownToFeedHtml } from '~~/shared/job-description'

definePageMeta({
  layout: 'public',
})

const route = useRoute()
const jobSlug = route.params.slug as string
const requestURL = useRequestURL()
const { track } = useTrack()
const { t, locale, defaultLocale } = useI18n()
const organizationLogoFailed = ref(false)

// Canonical + JobPosting URL are built from the real request origin rather than
// the i18n `baseUrl` (which can point at the marketing host if the env var is
// unset). The canonical self-references the current path (a self-referential
// canonical is valid on the noindex localized variants); `jobUrl` is the
// unprefixed default-locale URL — the single page Google for Jobs dedupes to.
const canonicalUrl = computed(() => `${requestURL.origin}${route.path}`)
const jobUrl = computed(() => `${requestURL.origin}/jobs/${jobSlug}`)

// Localized (`/es/jobs/x`, …) URLs are non-canonical duplicates of the
// unprefixed default-locale page: the job content is single-language and only
// the UI chrome is translated. The nuxt.config routeRules already serve them
// `X-Robots-Tag: noindex` — mirror that in the page-level robots meta so the
// two signals agree instead of the meta asserting `index` against the header.
const isLocalizedVariant = computed(() => locale.value !== defaultLocale)

/** Forward source-tracking query params (?ref=, utm_*) to the apply page */
const applyQuery = computed(() => {
  const q: Record<string, string> = {}
  if (route.query.ref) q.ref = route.query.ref as string
  if (route.query.utm_source) q.utm_source = route.query.utm_source as string
  if (route.query.utm_medium) q.utm_medium = route.query.utm_medium as string
  if (route.query.utm_campaign) q.utm_campaign = route.query.utm_campaign as string
  if (route.query.utm_term) q.utm_term = route.query.utm_term as string
  if (route.query.utm_content) q.utm_content = route.query.utm_content as string
  return q
})

onMounted(() => track('public_job_viewed', { slug: jobSlug }))

const { data: job, status: fetchStatus, error: fetchError } = useFetch(
  `/api/public/jobs/${jobSlug}`,
  { key: `public-job-detail-${jobSlug}` },
)

const jobDescriptionPlain = computed(() => markdownToPlainText(job.value?.description))

// ─────────────────────────────────────────────
// SEO — Meta tags (title, description, OG, Twitter)
// ─────────────────────────────────────────────

useSeoMeta({
  title: computed(() => job.value ? `${job.value.title} — ${t('jobs.detail.hiringNow')}` : t('jobs.detail.metaTitleFallback')),
  description: computed(() => {
    if (!job.value) return t('jobs.detail.metaDescriptionFallback')
    const loc = job.value.location ? ` ${t('jobs.detail.metaIn')} ${job.value.location}` : ''
    const org = job.value.organizationName ? ` ${t('jobs.detail.metaAt')} ${job.value.organizationName}` : ''
    return `${t('jobs.detail.metaApplyFor')} ${job.value.title}${org}${loc}. ${jobDescriptionPlain.value.slice(0, 120)}`.trim()
  }),
  ogTitle: computed(() => job.value ? `${job.value.title} — ${t('jobs.detail.hiringNow')}` : t('jobs.detail.metaTitleFallback')),
  ogDescription: computed(() => {
    if (!job.value) return t('jobs.detail.metaDescriptionFallback')
    const org = job.value.organizationName ? ` ${t('jobs.detail.metaAt')} ${job.value.organizationName}` : ''
    return `${t('jobs.detail.metaApplyFor')} ${job.value.title}${org}. ${job.value.location ?? t('career.remote.remote')}.`
  }),
  ogType: 'website',
  ogUrl: () => canonicalUrl.value,
  ogImage: '/reqcore-banner-github.jpeg',
  twitterCard: 'summary_large_image',
  twitterTitle: computed(() => job.value?.title ?? t('jobs.detail.metaTitleFallback')),
  twitterDescription: computed(() => {
    if (!job.value) return t('jobs.detail.metaDescriptionFallback')
    return `${t('jobs.detail.metaApplyFor')} ${job.value.title}. ${job.value.location ?? t('career.remote.remote')}.`
  }),
  // Noindex when either (a) the job is closed/expired/missing — it 404s at the
  // API but renders a "not found" body with a 200 status, so opt it out of
  // indexing to avoid a soft 404 and drop the expired posting from Google for
  // Jobs — or (b) this is a localized variant (see `isLocalizedVariant`).
  robots: () =>
    fetchError.value || isLocalizedVariant.value
      ? 'noindex, nofollow'
      : 'index, follow',
})

// ─────────────────────────────────────────────
// SEO — JSON-LD JobPosting structured data (Google Jobs)
// ─────────────────────────────────────────────

/** Map internal job type to schema.org employmentType */
function mapEmploymentType(type: string): string {
  const map: Record<string, string> = {
    full_time: 'FULL_TIME',
    part_time: 'PART_TIME',
    contract: 'CONTRACTOR',
    internship: 'INTERN',
  }
  return map[type] || 'OTHER'
}

// Build the JobPosting JSON-LD reactively. Exposed as a computed and injected
// via a top-level `useHead` (below) rather than a `watchEffect` + nested
// `useHead`: on the server the watch runs once during setup before the async
// `useFetch` resolves and never re-runs, so the script was missing from the
// SSR HTML that Google for Jobs reads. A computed re-evaluates once `job`
// resolves and is serialized into the rendered head.
const jobPostingJsonLd = computed(() => {
  if (!job.value) return null

  const j = job.value
  const posting: Record<string, unknown> = {
    '@type': 'JobPosting',
    'title': j.title,
    // Google accepts HTML here and rewards the structure — a flattened wall of
    // plain text loses the requirements and responsibilities lists entirely.
    // Falls back to plain text for a description that renders to nothing.
    'description': markdownToFeedHtml(j.description) || jobDescriptionPlain.value || j.title,
    'identifier': {
      '@type': 'PropertyValue',
      'name': j.organizationName ?? 'Reqcore',
      'value': j.id,
    },
    // `publishedAt` is when the role actually went live. `createdAt` would date
    // a role to when its draft was started, ageing it before anyone saw it.
    'datePosted': j.publishedAt ?? j.createdAt,
    'employmentType': mapEmploymentType(j.type),
    'directApply': true,
    // Canonical, unprefixed job URL so Google for Jobs treats the locale
    // variants as one posting instead of duplicates.
    'url': jobUrl.value,
  }

  // Hiring organization
  if (j.organizationName) {
    posting.hiringOrganization = {
      '@type': 'Organization',
      'name': j.organizationName,
      ...(j.organizationLogo ? { logo: j.organizationLogo } : {}),
    }
  }

  const isFullyRemote = j.remoteStatus === 'remote'

  // Hybrid roles are telecommute-eligible but still tied to an office, so they
  // keep a jobLocation. Fully remote roles get applicantLocationRequirements
  // *instead of* jobLocation — Google warns when a TELECOMMUTE posting also
  // claims a physical place.
  if (isFullyRemote || j.remoteStatus === 'hybrid') {
    posting.jobLocationType = 'TELECOMMUTE'
  }

  if (isFullyRemote) {
    posting.applicantLocationRequirements = {
      '@type': 'Country',
      'name': j.locationCountry || 'Anywhere',
    }
  } else {
    // Prefer the structured parts; fall back to the free-text string as the
    // locality only when nothing structured has been filled in.
    const address: Record<string, unknown> = { '@type': 'PostalAddress' }
    if (j.locationCity) address.addressLocality = j.locationCity
    if (j.locationRegion) address.addressRegion = j.locationRegion
    if (j.locationCountry) address.addressCountry = j.locationCountry
    if (!j.locationCity && !j.locationRegion && j.location) {
      address.addressLocality = j.location
    }
    if (Object.keys(address).length > 1) {
      posting.jobLocation = { '@type': 'Place', address }
    }
  }

  if (j.department) {
    posting.occupationalCategory = j.department
  }

  // Valid through
  if (j.validThrough) {
    posting.validThrough = new Date(j.validThrough).toISOString()
  }

  // Salary (baseSalary)
  if (j.salaryMin || j.salaryMax) {
    const value: Record<string, unknown> = { '@type': 'QuantitativeValue' }
    if (j.salaryMin && j.salaryMax) {
      value.minValue = j.salaryMin
      value.maxValue = j.salaryMax
    } else if (j.salaryMin) {
      value.value = j.salaryMin
    } else if (j.salaryMax) {
      value.value = j.salaryMax
    }
    if (j.salaryUnit) {
      value.unitText = j.salaryUnit
    }
    posting.baseSalary = {
      '@type': 'MonetaryAmount',
      'currency': j.salaryCurrency || 'USD',
      'value': value,
    }
  }

  return JSON.stringify({
    '@context': 'https://schema.org',
    ...posting,
  })
})

// Canonical + JSON-LD, injected top-level so both are server-rendered.
useHead({
  link: () => [{ rel: 'canonical', href: canonicalUrl.value }],
  script: () =>
    jobPostingJsonLd.value
      ? [{ type: 'application/ld+json', innerHTML: jobPostingJsonLd.value }]
      : [],
})

const typeLabels = computed<Record<string, string>>(() => ({
  full_time: t('career.type.full_time'),
  part_time: t('career.type.part_time'),
  contract: t('career.type.contract'),
  internship: t('career.type.internship'),
}))

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(locale.value, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Format salary for display */
function formatSalary(min?: number | null, max?: number | null, currency?: string | null, unit?: string | null): string | null {
  if (!min && !max) return null
  const cur = currency || 'USD'
  const fmt = (v: number) => new Intl.NumberFormat(locale.value, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v)
  const unitLabel = unit ? `/${unit.toLowerCase().replace('year', 'yr').replace('month', 'mo').replace('hour', 'hr')}` : ''
  if (min && max) return `${fmt(min)} – ${fmt(max)}${unitLabel}`
  return `${fmt(min || max!)}${unitLabel}`
}
</script>

<template>
  <div>
    <!-- Loading skeleton -->
    <div v-if="fetchStatus === 'pending'" class="animate-pulse space-y-4">
      <div class="h-4 w-24 bg-surface-200 dark:bg-surface-800 rounded" />
      <div class="mt-4 rounded-2xl border border-surface-200 dark:border-surface-800 overflow-hidden">
        <div class="h-1 bg-surface-200 dark:bg-surface-800" />
        <div class="p-6 sm:p-8 space-y-4">
          <div class="flex gap-2">
            <div class="h-6 w-28 bg-surface-200 dark:bg-surface-800 rounded-full" />
            <div class="h-6 w-20 bg-surface-200 dark:bg-surface-800 rounded-full" />
          </div>
          <div class="h-8 w-64 bg-surface-200 dark:bg-surface-800 rounded-lg" />
          <div class="h-4 w-40 bg-surface-200 dark:bg-surface-800 rounded" />
          <div class="space-y-2 pt-2">
            <div class="h-3 w-full bg-surface-200 dark:bg-surface-800 rounded" />
            <div class="h-3 w-5/6 bg-surface-200 dark:bg-surface-800 rounded" />
            <div class="h-3 w-4/6 bg-surface-200 dark:bg-surface-800 rounded" />
          </div>
        </div>
      </div>
    </div>

    <!-- Not found -->
    <div v-else-if="fetchError" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="mb-5 flex size-16 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800">
        <Briefcase class="size-7 text-surface-400" />
      </div>
      <h1 class="text-xl font-bold text-surface-900 dark:text-surface-100 mb-2">{{ t('jobs.detail.notFoundTitle') }}</h1>
      <p class="text-sm text-surface-500 mb-6 max-w-xs">
        {{ t('jobs.detail.notFoundBody') }}
      </p>
      <NuxtLink
        :to="$localePath('/jobs')"
        class="inline-flex items-center gap-1.5 rounded-xl border border-surface-300 dark:border-surface-700 px-5 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors shadow-sm"
      >
        <ArrowLeft class="size-4" />
        {{ t('jobs.detail.browseAll') }}
      </NuxtLink>
    </div>

    <!-- Job detail -->
    <template v-else-if="job">
      <!-- Back link -->
      <NuxtLink
        :to="$localePath('/jobs')"
        class="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 transition-colors mb-6 group"
      >
        <ArrowLeft class="size-3.5 transition-transform group-hover:-translate-x-0.5" />
        {{ t('jobs.detail.allPositions') }}
      </NuxtLink>

      <!-- Job hero card -->
      <div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm overflow-hidden mb-5">
        <!-- Accent bar -->
        <div class="h-1 bg-gradient-to-r from-brand-500 to-brand-400" />

        <div class="p-6 sm:p-8">
          <!-- Meta chips -->
          <div class="flex flex-wrap items-center gap-2 mb-4">
            <span
              v-if="job.organizationName"
              class="inline-flex items-center gap-1.5 rounded-full border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-3 py-1 text-xs font-medium text-surface-700 dark:text-surface-300"
            >
              <Building2 class="size-3.5 text-surface-400" />
              {{ job.organizationName }}
            </span>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-brand-50 dark:bg-brand-950 border border-brand-100 dark:border-brand-900 px-3 py-1 text-xs font-medium text-brand-700 dark:text-brand-300">
              <Briefcase class="size-3.5" />
              {{ typeLabels[job.type] ?? job.type }}
            </span>
            <span
              v-if="job.location"
              class="inline-flex items-center gap-1.5 rounded-full border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-3 py-1 text-xs font-medium text-surface-600 dark:text-surface-400"
            >
              <MapPin class="size-3.5 text-surface-400" />
              {{ job.location }}
            </span>
            <span
              v-if="job.salaryNegotiable || formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryUnit)"
              class="inline-flex items-center gap-1.5 rounded-full border border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-950 px-3 py-1 text-xs font-semibold text-success-700 dark:text-success-300"
            >
              {{ job.salaryNegotiable ? t('jobs.detail.negotiable') : formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryUnit) }}
            </span>
          </div>

          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-surface-900 dark:text-surface-50 mb-2">
            {{ job.title }}
          </h1>

          <p class="inline-flex items-center gap-1.5 text-xs text-surface-400">
            <Calendar class="size-3.5" />
            {{ t('jobs.detail.postedOn', { date: formatDate(job.createdAt) }) }}
          </p>

          <!-- Apply CTA inline -->
          <div class="mt-6 flex flex-col sm:flex-row items-start sm:items-center gap-3 border-t border-surface-100 dark:border-surface-800 pt-5">
            <NuxtLink
              :to="{ path: $localePath(`/jobs/${job.slug}/apply`), query: applyQuery }"
              class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 active:scale-[0.98] transition-all shadow-sm"
            >
              {{ t('jobs.detail.applyNow') }}
              <ExternalLink class="size-3.5" />
            </NuxtLink>
            <p class="text-xs text-surface-400">{{ t('jobs.detail.applyTime') }}</p>
          </div>

          <!-- Branded path to the organization's career page and other roles -->
          <NuxtLink
            v-if="job.careerPageSlug"
            :to="{ path: $localePath(`/career/${job.careerPageSlug}`), query: applyQuery }"
            class="group mt-6 flex w-full items-center gap-3 border-t border-surface-100 pt-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 dark:border-surface-800 dark:focus-visible:ring-offset-surface-900"
          >
            <span
              class="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border shadow-sm"
              :class="job.organizationLogo && !organizationLogoFailed
                ? 'border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-800'
                : 'border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950'"
            >
              <img
                v-if="job.organizationLogo && !organizationLogoFailed"
                :src="job.organizationLogo"
                :alt="t('jobs.detail.companyLogoAlt', { name: job.organizationName })"
                class="size-full object-contain p-1.5"
                @error="organizationLogoFailed = true"
              >
              <Building2 v-else class="size-6 text-brand-700 dark:text-brand-300" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-surface-900 transition-colors group-hover:text-brand-700 dark:text-surface-100 dark:group-hover:text-brand-300">
                {{ t('jobs.detail.careerPageTitle', { name: job.organizationName }) }}
              </span>
              <span class="mt-0.5 block text-xs leading-5 text-surface-500 dark:text-surface-400">
                {{ t('jobs.detail.careerPageDescription') }}
              </span>
            </span>
            <ChevronRight class="size-5 shrink-0 text-brand-500 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700 dark:text-brand-400 dark:group-hover:text-brand-300" />
          </NuxtLink>
        </div>
      </div>

      <!-- Description card -->
      <div v-if="job.description" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm overflow-hidden mb-5">
        <div class="border-b border-surface-100 dark:border-surface-800 px-6 sm:px-8 py-4">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('jobs.detail.aboutRole') }}</h2>
        </div>
        <div class="px-6 sm:px-8 py-6">
          <MarkdownDescription :value="job.description" />
        </div>
      </div>

      <!-- Questions preview card -->
      <div v-if="job.questions && job.questions.length > 0" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm overflow-hidden mb-5">
        <div class="border-b border-surface-100 dark:border-surface-800 px-6 sm:px-8 py-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('jobs.detail.questionsTitle') }}</h2>
          <span class="rounded-full bg-surface-100 dark:bg-surface-800 px-2.5 py-0.5 text-xs font-medium text-surface-600 dark:text-surface-400">
            {{ job.questions.length }}
          </span>
        </div>
        <div class="px-6 sm:px-8 py-5">
          <p class="text-sm text-surface-500 mb-4">
            {{ t('jobs.detail.questionsIntro', { count: job.questions.length }, job.questions.length) }}
          </p>
          <ul class="divide-y divide-surface-100 dark:divide-surface-800">
            <li
              v-for="q in job.questions"
              :key="q.id"
              class="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span class="text-sm text-surface-700 dark:text-surface-300">{{ q.label }}</span>
              <span
                v-if="q.required"
                class="shrink-0 rounded-full bg-danger-50 dark:bg-danger-950 border border-danger-100 dark:border-danger-900 px-2 py-0.5 text-xs font-medium text-danger-600 dark:text-danger-400"
              >
                {{ t('jobs.detail.required') }}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <!-- Bottom Apply CTA -->
      <div class="rounded-2xl border border-brand-100 dark:border-brand-900 bg-brand-50 dark:bg-brand-950/50 px-6 sm:px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('jobs.detail.readyTitle') }}</p>
          <p class="text-sm text-surface-500 mt-0.5">{{ t('jobs.detail.readyBody') }}</p>
        </div>
        <NuxtLink
          :to="{ path: $localePath(`/jobs/${job.slug}/apply`), query: applyQuery }"
          class="shrink-0 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 active:scale-[0.98] transition-all shadow-sm"
        >
          {{ t('jobs.detail.applyForPosition') }}
          <ExternalLink class="size-3.5" />
        </NuxtLink>
      </div>
    </template>
  </div>
</template>
