<script setup lang="ts">
import {
  Share2, Globe2, Link2, Copy, Check, ExternalLink, Loader2, Plus,
  BarChart3, Sparkles, RefreshCw, AlertCircle, CheckCircle2, CircleSlash, Rss,
  Linkedin, Facebook, MessageCircle, Hash, Mail, Users,
} from 'lucide-vue-next'

/**
 * The permanent home for "how do I get applicants for this job?".
 *
 * Rendered both by the create-job wizard's success screen and by the Promote
 * tab. Previously this lived only inside the wizard's local state, so the whole
 * distribution surface vanished the moment the page was refreshed.
 */
const props = defineProps<{
  jobId: string
  /** The wizard renders inside its own card; the tab supplies page chrome. */
  compact?: boolean
}>()

const toast = useToast()
const { track } = useTrack()
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const localePath = useLocalePath()
const requestUrl = useRequestURL()
const origin = `${requestUrl.protocol}//${requestUrl.host}`

const { data, status, refresh } = await useFetch(`/api/jobs/${props.jobId}/promote`, {
  key: `job-promote-${props.jobId}`,
})

const applicationUrl = computed(() =>
  data.value ? `${origin}/jobs/${data.value.job.slug}` : '',
)
const careerPageUrl = computed(() =>
  data.value?.careerPageSlug ? `${origin}/career/${data.value.careerPageSlug}` : '',
)

// ─────────────────────────────────────────────
// Job board syndication
// ─────────────────────────────────────────────

/**
 * Syndication is a job-level preference, so it belongs next to the row that
 * reports its status rather than buried in job settings — this is the only
 * screen that tells you the role is on the boards, and it has to be the screen
 * that lets you take it off them.
 *
 * A test role is the one case with no switch to offer: it is barred from every
 * public surface by what it is, so a control implying otherwise would lie.
 */
const { allowed: canUpdateJob } = usePermission({ job: ['update'] })

const canToggleDistribution = computed(() =>
  Boolean(data.value) && !data.value?.job.isTest && canUpdateJob.value,
)

const isTogglingDistribution = ref(false)

async function setDistributeToBoards(next: boolean) {
  if (isTogglingDistribution.value) return
  isTogglingDistribution.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}`, {
      method: 'PATCH',
      body: { distributeToBoards: next },
    })
    // Refresh rather than patch locally: eligibility is the server's verdict,
    // and turning syndication back on can surface a different blocker.
    await refresh()
    await refreshNuxtData(`job-${props.jobId}`)
    track('job_distribution_toggled', { job_id: props.jobId, enabled: next })
    toast.success(
      next ? 'Sent to job boards' : 'Removed from job boards',
      next
        ? 'It appears on the boards at their next refresh.'
        : 'Boards drop it at their next refresh. Your application link still works.',
    )
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Could not change job board distribution', {
      message: err?.data?.statusMessage,
      statusCode: err?.data?.statusCode,
    })
  } finally {
    isTogglingDistribution.value = false
  }
}

// ─────────────────────────────────────────────
// Clipboard
// ─────────────────────────────────────────────

const copiedKey = ref<string | null>(null)

async function copy(key: string, value: string) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    copiedKey.value = key
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null
    }, 2500)
  } catch {
    // Clipboard is blocked in some embedded browsers — surface the value so
    // the user can still select it by hand rather than silently failing.
    toast.info(value)
  }
}

// ─────────────────────────────────────────────
// Tracking links — reuse an existing one per channel, mint on first use
// ─────────────────────────────────────────────

const mintingChannel = ref<string | null>(null)

function trackedUrl(code: string) {
  return `${origin}/api/public/track/${encodeURIComponent(code)}`
}

async function ensureLink(channel: string, label: string): Promise<string> {
  const existing = data.value?.trackingLinks?.find(l => l.channel === channel && l.isActive)
  if (existing) return trackedUrl(existing.code)

  mintingChannel.value = channel
  try {
    const created = await $fetch<{ id: string; code: string }>('/api/tracking-links', {
      method: 'POST',
      body: { jobId: props.jobId, channel, name: `${data.value?.job.title} — ${label}` },
    })
    await refresh()
    track('tracking_link_created', { channel, source: 'promote_panel' })
    return trackedUrl(created.code)
  } finally {
    mintingChannel.value = null
  }
}

// ─────────────────────────────────────────────
// Share pack
// ─────────────────────────────────────────────

/**
 * Per-channel share targets.
 *
 * `prefillsText` records whether the platform actually accepts post text via
 * URL. LinkedIn and Facebook do not reliably honour it, so those channels get
 * a "copy, then paste" flow instead of a promise the composer won't keep.
 */
const shareChannels = [
  {
    key: 'linkedin',
    label: 'LinkedIn',
    icon: Linkedin,
    prefillsText: false,
    build: (_text: string, url: string) =>
      `https://www.linkedin.com/feed/?shareActive=true&shareUrl=${encodeURIComponent(url)}`,
  },
  {
    key: 'twitter',
    label: 'X',
    icon: Hash,
    prefillsText: true,
    build: (text: string, url: string) =>
      `https://x.com/intent/post?text=${encodeURIComponent(`${text}\n\n${url}`)}`,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    icon: Facebook,
    prefillsText: false,
    build: (_text: string, url: string) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    prefillsText: true,
    build: (text: string, url: string) =>
      `https://wa.me/?text=${encodeURIComponent(`${text}\n\n${url}`)}`,
  },
  {
    key: 'reddit',
    label: 'Reddit',
    icon: MessageCircle,
    prefillsText: true,
    build: (text: string, url: string) =>
      `https://www.reddit.com/submit?title=${encodeURIComponent(data.value?.job.title ?? 'We are hiring')}&text=${encodeURIComponent(`${text}\n\n${url}`)}`,
  },
  {
    key: 'email',
    label: 'Email your team',
    icon: Mail,
    prefillsText: true,
    build: (text: string, url: string) =>
      `mailto:?subject=${encodeURIComponent(`We're hiring: ${data.value?.job.title ?? ''}`)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
  },
] as const

/** Channel key → the tracking-link channel it should be attributed to. */
const SHARE_CHANNEL_SOURCE: Record<string, string> = {
  linkedin: 'linkedin',
  twitter: 'twitter',
  facebook: 'facebook',
  whatsapp: 'whatsapp',
  reddit: 'reddit',
  email: 'email',
}

const shareCopy = ref<Record<string, string> | null>(null)
const shareCopyGeneratedAt = ref<string | null>(null)
const isGenerating = ref(false)
const shareError = ref<string | null>(null)

async function loadShareCopy(regenerate = false) {
  isGenerating.value = true
  shareError.value = null
  try {
    const result = await $fetch<{
      channels: Record<string, string>
      generatedAt: string
      source: 'cache' | 'generated'
    }>(`/api/jobs/${props.jobId}/share-copy`, {
      method: 'POST',
      body: { regenerate },
    })
    shareCopy.value = result.channels
    shareCopyGeneratedAt.value = result.generatedAt
    track('share_copy_generated', { job_id: props.jobId, source: result.source })
  } catch (err: any) {
    shareError.value = err?.data?.statusMessage ?? 'Could not write the share posts.'
  } finally {
    isGenerating.value = false
  }
}

async function openComposer(channel: typeof shareChannels[number]) {
  const text = shareCopy.value?.[channel.key] ?? ''
  const url = await ensureLink(SHARE_CHANNEL_SOURCE[channel.key] ?? 'other', channel.label)

  // Platforms that ignore prefilled text still need the post on the clipboard,
  // otherwise the composer opens empty and the user is back to a blank box.
  if (!channel.prefillsText && text) {
    await copy(channel.key, `${text}\n\n${url}`)
    toast.info('Post copied', 'Paste it into the composer that just opened.')
  }

  track('share_composer_opened', { job_id: props.jobId, channel: channel.key })
  window.open(channel.build(text, url), '_blank', 'noopener,noreferrer')
}

// ─────────────────────────────────────────────
// Custom job board
// ─────────────────────────────────────────────

const customBoardName = ref('')
const isCreatingCustomBoard = ref(false)

async function createCustomBoardLink() {
  const name = customBoardName.value.trim()
  if (!name) return
  isCreatingCustomBoard.value = true
  try {
    await $fetch('/api/tracking-links', {
      method: 'POST',
      body: { jobId: props.jobId, channel: 'custom', name: `${data.value?.job.title} — ${name}` },
    })
    customBoardName.value = ''
    await refresh()
    track('tracking_link_created', { channel: 'custom', source: 'promote_panel' })
  } catch {
    toast.error(`Failed to create tracking link for "${name}"`)
  } finally {
    isCreatingCustomBoard.value = false
  }
}

onMounted(() => {
  track('promote_tab_viewed', { job_id: props.jobId })
})
</script>

<template>
  <div v-if="status === 'pending' && !data" class="flex items-center justify-center py-12">
    <Loader2 class="size-5 animate-spin text-surface-400" />
  </div>

  <div v-else-if="data" :class="compact ? 'space-y-8' : 'space-y-6'">
    <!-- ── Where this job is live ── -->
    <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 overflow-hidden">
      <div class="border-b border-surface-100 dark:border-surface-800 px-5 py-4">
        <h3 class="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-surface-100">
          <Rss class="size-4 text-brand-600 dark:text-brand-400" />
          Where this job is live
        </h3>
        <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
          Where publishing put this role. Job boards are optional — switch them off any time.
        </p>
      </div>

      <ul class="divide-y divide-surface-100 dark:divide-surface-800">
        <li class="flex items-center gap-3 px-5 py-3">
          <CheckCircle2 class="size-4 shrink-0 text-success-600 dark:text-success-400" />
          <span class="flex-1 text-sm text-surface-700 dark:text-surface-300">Reqcore job board &amp; Google for Jobs</span>
          <a :href="applicationUrl" target="_blank" rel="noopener" class="shrink-0 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline">View</a>
        </li>

        <li v-if="careerPageUrl" class="flex items-center gap-3 px-5 py-3">
          <CheckCircle2 class="size-4 shrink-0 text-success-600 dark:text-success-400" />
          <span class="flex-1 text-sm text-surface-700 dark:text-surface-300">Your branded career page</span>
          <a :href="careerPageUrl" target="_blank" rel="noopener" class="shrink-0 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline">View</a>
        </li>

        <!-- Job board syndication -->
        <li class="px-5 py-3">
          <div class="flex items-start gap-3">
            <component
              :is="data.feed.eligible ? CheckCircle2 : data.job.distributeToBoards ? AlertCircle : CircleSlash"
              class="mt-0.5 size-4 shrink-0"
              :class="data.feed.eligible
                ? 'text-success-600 dark:text-success-400'
                : data.job.distributeToBoards
                  ? 'text-warning-600 dark:text-warning-400'
                  : 'text-surface-400 dark:text-surface-500'"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm text-surface-700 dark:text-surface-300">
                {{ data.feed.eligible
                  ? 'External job boards'
                  : data.job.distributeToBoards
                    ? 'External job boards — not yet'
                    : 'External job boards — off' }}
              </p>
              <p v-if="data.feed.eligible" class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                Sent to {{ data.feed.boards.map(b => b.label).join(', ') }}. Boards refresh every few hours.
              </p>
              <p
                v-else
                class="mt-0.5 text-xs"
                :class="data.job.distributeToBoards
                  ? 'text-warning-700 dark:text-warning-400'
                  : 'text-surface-500 dark:text-surface-400'"
              >
                {{ data.feed.reason }}
              </p>
              <!-- Opting out is not something job settings can fix — the switch
                   on this row is the fix, so sending them away would be a
                   round trip to a page with no such control. -->
              <NuxtLink
                v-if="!data.feed.eligible && data.feed.fixable && data.feed.code !== 'opted_out'"
                :to="localePath(`/dashboard/jobs/${jobId}/settings`)"
                class="mt-1 inline-block text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
              >
                Fix in job settings
              </NuxtLink>
            </div>

            <button
              v-if="canToggleDistribution"
              type="button"
              role="switch"
              :aria-checked="data.job.distributeToBoards"
              :aria-label="data.job.distributeToBoards ? 'Stop sending this job to external job boards' : 'Send this job to external job boards'"
              :disabled="isTogglingDistribution"
              class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-surface-950"
              :class="data.job.distributeToBoards ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-700'"
              @click="setDistributeToBoards(!data.job.distributeToBoards)"
            >
              <span
                class="inline-block size-3.5 rounded-full bg-white shadow transition-transform"
                :class="data.job.distributeToBoards ? 'translate-x-[1.125rem]' : 'translate-x-[0.1875rem]'"
              />
            </button>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Direct link ── -->
    <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
      <div class="mb-3 flex items-center gap-2">
        <Link2 class="size-4 text-surface-500 dark:text-surface-400" />
        <span class="text-sm font-semibold text-surface-700 dark:text-surface-300">Application link</span>
      </div>
      <div class="flex items-center gap-2">
        <input
          type="text"
          readonly
          :value="applicationUrl"
          class="flex-1 select-all rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 font-mono text-sm text-surface-600 dark:text-surface-400"
        >
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-200 dark:bg-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 transition-colors hover:bg-surface-300 dark:hover:bg-surface-600"
          @click="copy('direct', applicationUrl)"
        >
          <Check v-if="copiedKey === 'direct'" class="size-3.5" />
          <Copy v-else class="size-3.5" />
          {{ copiedKey === 'direct' ? 'Copied!' : 'Copy' }}
        </button>
      </div>
    </section>

    <!-- ── Career page ── -->
    <section
      v-if="careerPageUrl"
      class="rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/60 dark:bg-brand-950/20 p-5"
    >
      <div class="mb-1 flex items-center gap-2">
        <Globe2 class="size-4 text-brand-600 dark:text-brand-400" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Your career page</span>
      </div>
      <p class="mb-3 text-sm text-surface-500 dark:text-surface-400">
        One branded link for every open role.
      </p>
      <div class="flex items-center gap-2">
        <input
          type="text"
          readonly
          :value="careerPageUrl"
          class="flex-1 select-all rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 font-mono text-sm text-surface-600 dark:text-surface-400"
        >
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-200 dark:bg-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 transition-colors hover:bg-surface-300 dark:hover:bg-surface-600"
          @click="copy('career', careerPageUrl)"
        >
          <Check v-if="copiedKey === 'career'" class="size-3.5" />
          <Copy v-else class="size-3.5" />
          {{ copiedKey === 'career' ? 'Copied!' : 'Copy' }}
        </button>
      </div>
    </section>

    <!-- ── Share pack ── -->
    <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 overflow-hidden">
      <div class="flex items-start justify-between gap-4 border-b border-surface-100 dark:border-surface-800 px-5 py-4">
        <div>
          <h3 class="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-surface-100">
            <Share2 class="size-4 text-brand-600 dark:text-brand-400" />
            Share it yourself
          </h3>
          <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
            Written for you, with a tracked link attached so you can see what works.
          </p>
        </div>
        <button
          v-if="shareCopy"
          type="button"
          :disabled="isGenerating"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-400 transition-colors hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50"
          @click="loadShareCopy(true)"
        >
          <RefreshCw class="size-3" :class="isGenerating ? 'animate-spin' : ''" />
          Rewrite
        </button>
      </div>

      <div class="p-5">
        <!-- Empty state -->
        <div v-if="!shareCopy && !isGenerating" class="text-center">
          <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
            Write posts for LinkedIn, X, Facebook, WhatsApp, Reddit and your team.
          </p>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            @click="loadShareCopy(false)"
          >
            <Sparkles class="size-4" />
            Write my posts
          </button>
          <p v-if="shareError" class="mt-3 text-xs text-danger-600 dark:text-danger-400">
            {{ shareError }}
          </p>
        </div>

        <div v-else-if="isGenerating && !shareCopy" class="flex items-center justify-center gap-2 py-8">
          <Loader2 class="size-4 animate-spin text-brand-600" />
          <span class="text-sm text-surface-500">Writing your posts…</span>
        </div>

        <!-- Channel cards -->
        <div v-else-if="shareCopy" class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div
            v-for="ch in shareChannels"
            :key="ch.key"
            class="flex flex-col rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-4"
          >
            <div class="mb-2 flex items-center gap-2">
              <component :is="ch.icon" class="size-4 text-surface-500 dark:text-surface-400" />
              <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ ch.label }}</span>
            </div>

            <p class="mb-3 flex-1 whitespace-pre-line text-xs leading-relaxed text-surface-600 dark:text-surface-400">
              {{ shareCopy[ch.key] }}
            </p>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                :disabled="mintingChannel === SHARE_CHANNEL_SOURCE[ch.key]"
                @click="openComposer(ch)"
              >
                <Loader2 v-if="mintingChannel === SHARE_CHANNEL_SOURCE[ch.key]" class="size-3 animate-spin" />
                <ExternalLink v-else class="size-3" />
                Open {{ ch.label }}
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-xs font-medium text-surface-600 dark:text-surface-400 transition-colors hover:bg-white dark:hover:bg-surface-800"
                @click="copy(`copy-${ch.key}`, shareCopy[ch.key] ?? '')"
              >
                <Check v-if="copiedKey === `copy-${ch.key}`" class="size-3" />
                <Copy v-else class="size-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Tracked links ── -->
    <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 overflow-hidden">
      <div class="border-b border-surface-100 dark:border-surface-800 px-5 py-4">
        <h3 class="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-surface-100">
          <BarChart3 class="size-4 text-brand-600 dark:text-brand-400" />
          Tracked links
        </h3>
        <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
          Post one of these anywhere and every click and application is attributed.
        </p>
      </div>

      <ul v-if="data.trackingLinks.length" class="divide-y divide-surface-100 dark:divide-surface-800">
        <li
          v-for="link in data.trackingLinks"
          :key="link.id"
          class="flex items-center gap-3 px-5 py-3"
        >
          <Users class="size-4 shrink-0 text-surface-400" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm text-surface-700 dark:text-surface-300">{{ link.name }}</p>
            <p class="text-xs text-surface-400">
              {{ link.clickCount }} clicks · {{ link.applicationCount }} applications
            </p>
          </div>
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1 rounded-md border border-surface-200 dark:border-surface-700 px-2.5 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-400 transition-colors hover:bg-surface-50 dark:hover:bg-surface-800"
            @click="copy(`link-${link.id}`, trackedUrl(link.code))"
          >
            <Check v-if="copiedKey === `link-${link.id}`" class="size-3" />
            <Copy v-else class="size-3" />
            Copy
          </button>
        </li>
      </ul>
      <p v-else class="px-5 py-4 text-sm text-surface-400">
        No tracked links yet. They're created automatically when you share above.
      </p>

      <!-- Custom board -->
      <div class="border-t border-surface-100 dark:border-surface-800 px-5 py-4">
        <label class="mb-2 block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
          Add another destination
        </label>
        <div class="flex items-center gap-2">
          <input
            v-model="customBoardName"
            type="text"
            placeholder="e.g. Hacker News, a niche board, a newsletter"
            class="flex-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 outline-none placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500"
            @keydown.enter.prevent="createCustomBoardLink"
          >
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 px-4 py-2 text-sm font-medium text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-100 dark:hover:bg-brand-900/50 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!customBoardName.trim() || isCreatingCustomBoard"
            @click="createCustomBoardLink"
          >
            <Loader2 v-if="isCreatingCustomBoard" class="size-3.5 animate-spin" />
            <Plus v-else class="size-3.5" />
            Create link
          </button>
        </div>
        <p class="mt-3 text-xs text-surface-400">
          Full analytics in the
          <NuxtLink :to="localePath('/dashboard/source-tracking')" class="font-medium text-brand-600 underline underline-offset-2 dark:text-brand-400">
            Source Tracking dashboard
          </NuxtLink>.
        </p>
      </div>
    </section>
  </div>
</template>
