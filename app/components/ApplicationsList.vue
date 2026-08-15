<script setup lang="ts">
import { FileText, Search, X, Briefcase, Mail, Clock, ArrowUp, ArrowDown, ArrowUpDown, SlidersHorizontal, Maximize2, Minimize2, Check, ChevronLeft, ChevronRight, FoldHorizontal, UnfoldHorizontal } from 'lucide-vue-next'

// Shared applications table. Used both by the global /dashboard/applications page
// and by a single job's candidates tab. Passing `jobId` scopes the list to that
// job (server-side filter) and hides the job column, job filter, and job sort.
const props = defineProps<{
  jobId?: string
  /** Open the detail drawer on this application on first render (deep-link support). */
  initialApplicationId?: string | null
}>()

// Per-job storage/state scoping so each job (and the global list) keep independent
// column choices, saved views, and filter state.
const scopeSuffix = props.jobId ? `:${props.jobId}` : ''

// ── Column visibility ─────────────────────────────────────────────────────────

const COLUMNS_STORAGE_KEY = `reqcore:columns:applications${scopeSuffix}`

const defaultColumnVisibility = {
  email: true,
  job: true,
  status: true,
  score: true,
  applied: true,
}

const visibleColumns = ref<Record<string, boolean>>({ ...defaultColumnVisibility })

// Global list: fetch org-global AND every job's per-job application properties so
// both can be toggled as columns. Job-scoped list: fetch org-global + this job's
// per-job properties. Per-row values are already attached to each application.
const { definitions: propertyDefs } = useProperties(
  props.jobId
    ? { entityType: () => 'application', jobId: () => props.jobId }
    : { entityType: () => 'application', allJobs: true },
)

// Resolve job titles so job-specific properties can be grouped under their job
// (only relevant on the global cross-job list).
const { jobs } = useJobs()
const jobTitleById = computed(() => {
  const map = new Map<string, string>()
  for (const j of jobs.value) map.set(j.id, j.title)
  // Fall back to titles carried on loaded applications for any job not in the list.
  for (const app of applications.value) {
    if (!map.has(app.jobId)) map.set(app.jobId, app.jobTitle)
  }
  return map
})

function jobGroupLabel(jobId: string): string {
  return jobTitleById.value.get(jobId) ?? 'Other job'
}

type ApplicationColumn = { key: string; label: string; required?: boolean; group?: string }

const applicationColumns = computed<ApplicationColumn[]>(() => [
  { key: 'candidate', label: 'Candidate', required: true },
  { key: 'email', label: 'Email' },
  ...(props.jobId ? [] : [{ key: 'job', label: 'Job' }]),
  { key: 'status', label: 'Status' },
  { key: 'score', label: 'Score' },
  { key: 'applied', label: 'Applied' },
  ...propertyDefs.value.map((d) => ({
    key: `prop_${d.id}`,
    label: d.name,
    group: (!props.jobId && d.jobId) ? jobGroupLabel(d.jobId) : undefined,
  })),
])

// Toggleable (non-required) columns, flattened with group headers for the drawer.
type ColumnPickerItem =
  | { type: 'header'; key: string; label: string }
  | { type: 'col'; key: string; col: (typeof applicationColumns.value)[number] }

const columnPickerItems = computed<ColumnPickerItem[]>(() => {
  const items: ColumnPickerItem[] = []
  let lastGroup: string | undefined
  for (const col of applicationColumns.value) {
    if (col.required) continue
    if (col.group && col.group !== lastGroup) {
      items.push({ type: 'header', key: `header-${items.length}`, label: col.group })
    }
    lastGroup = col.group
    items.push({ type: 'col', key: col.key, col })
  }
  return items
})

onMounted(() => {
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY)
    if (raw) visibleColumns.value = { ...defaultColumnVisibility, ...JSON.parse(raw) }
  } catch {}
})

watch(visibleColumns, (val) => {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(val)) } catch {}
}, { deep: true })

const route = useRoute()
const router = useRouter()
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
const page = ref(1)
const pageSize = ref<(typeof PAGE_SIZE_OPTIONS)[number]>(20)

// ── Search ────────────────────────────────────────────────────────────────────

const searchInput = ref('')
const debouncedSearch = ref('')

let debounceTimer: ReturnType<typeof setTimeout>
watch(searchInput, (val) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = val.trim().toLowerCase()
  }, 250)
})

// ── Status filter ─────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const
type Status = typeof STATUS_OPTIONS[number]

const initialAppStatus = STATUS_OPTIONS.includes(route.query.status as any)
  ? (route.query.status as Status)
  : undefined
const activeStatus = useState<Status | undefined>(`app-filter-status${scopeSuffix}`, () => initialAppStatus)
// Ensure the state matches the URL on navigation (useState caches across client-side navigations)
if (initialAppStatus !== undefined) {
  activeStatus.value = initialAppStatus
}

// Sync the URL when the status filter changes
watch(activeStatus, (newStatus) => {
  const query = { ...route.query }
  if (newStatus) {
    query.status = newStatus
  }
  else {
    delete query.status
  }
  router.replace({ query })
})

const statusFilter = computed(() => activeStatus.value)

// ── Viewed filter ─────────────────────────────────────────────────────────────
// Server-side read receipts, per signed-in user. The dashboard's "To Review"
// tile links here with `?viewed=unviewed`, so the count it shows and the rows
// listed here come from the same definition.

const VIEWED_OPTIONS = ['unviewed', 'viewed'] as const
type ViewedFilter = typeof VIEWED_OPTIONS[number]

const initialViewed = VIEWED_OPTIONS.includes(route.query.viewed as any)
  ? (route.query.viewed as ViewedFilter)
  : undefined
const activeViewed = useState<ViewedFilter | undefined>(`app-filter-viewed${scopeSuffix}`, () => initialViewed)
if (initialViewed !== undefined) {
  activeViewed.value = initialViewed
}

watch(activeViewed, (next) => {
  const query = { ...route.query }
  if (next) {
    query.viewed = next
  }
  else {
    delete query.viewed
  }
  router.replace({ query })
})

const viewedFilter = computed(() => activeViewed.value)
const propertyFilters = ref<import('~~/shared/properties').PropertyFilter[]>([])
const jobIdFilter = computed(() => props.jobId)

const { applications, total, fetchStatus, error, refresh } = useApplications({
  page,
  limit: pageSize,
  status: statusFilter,
  viewed: viewedFilter,
  propertyFilters,
  jobId: jobIdFilter,
})

watch([statusFilter, viewedFilter, propertyFilters, pageSize], () => {
  page.value = 1
}, { deep: true })

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const pageStart = computed(() => total.value === 0 ? 0 : ((page.value - 1) * pageSize.value) + 1)
const pageEnd = computed(() => Math.min(total.value, page.value * pageSize.value))

watch(totalPages, (next) => {
  if (page.value > next) page.value = next
})

const { formatPersonName } = useOrgSettings()

// ── Job filter (client-side, global list only) ─────────────────────────────────

const activeJobId = ref<string | undefined>(undefined)

watch([debouncedSearch, activeJobId], () => {
  page.value = 1
})

const uniqueJobs = computed(() => {
  const map = new Map<string, string>()
  for (const app of applications.value) {
    if (!map.has(app.jobId)) map.set(app.jobId, app.jobTitle)
  }
  return Array.from(map, ([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title))
})

// ── Sorting ───────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'email' | 'job' | 'status' | 'score' | 'created'
type SortDir = 'asc' | 'desc'

const sortKey = ref<SortKey>('created')
const sortDir = ref<SortDir>('desc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'created' || key === 'score' ? 'desc' : 'asc'
  }
}

// ── Filtered + sorted list ────────────────────────────────────────────────────

const filteredApplications = computed(() => {
  let list = [...applications.value]

  // Job filter (client-side; only used on the global list)
  if (activeJobId.value) {
    list = list.filter(app => app.jobId === activeJobId.value)
  }

  // Search filter (client-side)
  if (debouncedSearch.value) {
    const q = debouncedSearch.value
    list = list.filter(app =>
      formatPersonName(app.candidateFirstName, app.candidateLastName).toLowerCase().includes(q)
      || `${app.candidateFirstName} ${app.candidateLastName}`.toLowerCase().includes(q)
      || app.candidateEmail.toLowerCase().includes(q)
      || app.jobTitle.toLowerCase().includes(q),
    )
  }

  // Sort
  const dir = sortDir.value === 'asc' ? 1 : -1
  list.sort((a, b) => {
    switch (sortKey.value) {
      case 'name':
        return dir * formatPersonName(a.candidateFirstName, a.candidateLastName).localeCompare(formatPersonName(b.candidateFirstName, b.candidateLastName))
      case 'email':
        return dir * a.candidateEmail.localeCompare(b.candidateEmail)
      case 'job':
        return dir * a.jobTitle.localeCompare(b.jobTitle)
      case 'status':
        return dir * a.status.localeCompare(b.status)
      case 'score':
        return dir * ((a.score ?? -1) - (b.score ?? -1))
      case 'created':
        return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      default:
        return 0
    }
  })

  return list
})

const hasActiveFilters = computed(() =>
  activeStatus.value != null || activeViewed.value != null || activeJobId.value != null || debouncedSearch.value.length > 0 || propertyFilters.value.length > 0,
)

function clearAllFilters() {
  activeStatus.value = undefined
  activeViewed.value = undefined
  activeJobId.value = undefined
  searchInput.value = ''
  debouncedSearch.value = ''
  propertyFilters.value = []
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(date).toLocaleDateString()
}

function scoreClass(score: number) {
  if (score >= 75) return 'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950 dark:text-success-400 dark:ring-success-800'
  if (score >= 40) return 'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-950 dark:text-warning-400 dark:ring-warning-800'
  return 'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950 dark:text-danger-400 dark:ring-danger-800'
}

const statusBadgeClasses: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  screening: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  interview: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  offer: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  hired: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
  rejected: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
}

const statusDotClasses: Record<string, string> = {
  new: 'bg-blue-500',
  screening: 'bg-violet-500',
  interview: 'bg-amber-500',
  offer: 'bg-teal-500',
  hired: 'bg-green-600',
  rejected: 'bg-surface-400 dark:bg-surface-500',
}

const statusLabels: Record<Status, string> = {
  new: 'New',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
}

// ── Drawer + Saved Views ──────────────────────────────────────────────────────

type ApplicationsViewSettings = {
  status?: Status
  viewed?: ViewedFilter
  jobId?: string
  propertyFilters: import('~~/shared/properties').PropertyFilter[]
  sortKey: SortKey
  sortDir: SortDir
  visibleColumns?: Record<string, boolean>
}

const defaultSettings: ApplicationsViewSettings = {
  status: undefined,
  viewed: undefined,
  jobId: undefined,
  propertyFilters: [],
  sortKey: 'created',
  sortDir: 'desc',
  visibleColumns: undefined,
}

const drawerOpen = ref(false)
const isFullscreen = ref(false)
// Full-width vs centered list. Defaults to full on a single job's table view and
// centered on the global cross-job list, matching each page's original layout.
const isWideDetail = ref(!!props.jobId)
const currentSettings = computed<ApplicationsViewSettings>(() => ({
  status: activeStatus.value,
  viewed: activeViewed.value,
  jobId: activeJobId.value,
  propertyFilters: [...propertyFilters.value],
  sortKey: sortKey.value,
  sortDir: sortDir.value,
  visibleColumns: { ...visibleColumns.value },
}))

function applySettings(s: ApplicationsViewSettings) {
  activeStatus.value = s.status
  activeViewed.value = s.viewed
  activeJobId.value = s.jobId
  propertyFilters.value = [...(s.propertyFilters ?? [])]
  sortKey.value = s.sortKey
  sortDir.value = s.sortDir
  if (s.visibleColumns) visibleColumns.value = { ...defaultColumnVisibility, ...s.visibleColumns }
}

const {
  views,
  activeViewId,
  applyView,
  saveView,
  updateView,
  deleteView,
  setDefault,
  clearActive,
} = useSavedViews<ApplicationsViewSettings>(`applications${scopeSuffix}`, defaultSettings)

// On first mount, if a default view exists, apply its settings.
onMounted(() => {
  nextTick(() => {
    if (activeViewId.value) {
      const s = applyView(activeViewId.value)
      if (s) applySettings(s)
    }
  })
})

function settingsEqual(a: ApplicationsViewSettings, b: ApplicationsViewSettings) {
  return a.status === b.status
    && a.jobId === b.jobId
    && a.sortKey === b.sortKey
    && a.sortDir === b.sortDir
    && JSON.stringify(a.propertyFilters ?? []) === JSON.stringify(b.propertyFilters ?? [])
    && JSON.stringify(a.visibleColumns ?? {}) === JSON.stringify(b.visibleColumns ?? {})
}

const isDirty = computed(() => {
  const view = views.value.find(v => v.id === activeViewId.value)
  if (!view) return false
  return !settingsEqual(currentSettings.value, { ...defaultSettings, ...view.settings })
})

function onSelectView(id: string | null) {
  if (id == null) {
    clearActive()
    applySettings(defaultSettings)
    return
  }
  const s = applyView(id)
  if (s) applySettings(s)
}

function onSaveView(name: string) {
  saveView(name, currentSettings.value)
}

function onUpdateView(id: string) {
  updateView(id, { settings: currentSettings.value })
}

const drawerActiveCount = computed(() =>
  [activeStatus.value, activeViewed.value, activeJobId.value].filter(Boolean).length + propertyFilters.value.length,
)

// ── Property value lookup helper ──────────────────────────────────────────────
function getPropertyValue(entity: { properties?: import('~~/shared/properties').PropertyEntry[] | null }, definitionId: string): unknown {
  return entity.properties?.find((p) => p.definition.id === definitionId)?.value ?? null
}

// ── Application detail drawer ─────────────────────────────────────────────────
const selectedApplicationId = ref<string | null>(props.initialApplicationId ?? null)

// Opening the drawer renders <ApplicationDetail>, whose detail request logs the
// view server-side; mirroring it here drops the marker straight away.
const { markViewedLocally, isViewed } = useApplicationViews()

function openApplication(applicationId: string) {
  selectedApplicationId.value = applicationId
  markViewedLocally(applicationId)
}

async function handleApplicationDeleted() {
  selectedApplicationId.value = null
  await refresh()
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col w-full mx-auto transition-[max-width] duration-200"
    :class="isWideDetail ? 'max-w-none' : 'max-w-6xl'"
  >
    <!-- Search + Views + Filters -->
    <div class="flex items-center gap-2 mb-4">
      <div class="relative flex-1">
        <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-surface-400" />
        <input
          v-model="searchInput"
          type="text"
          :placeholder="jobId ? 'Search by candidate name or email…' : 'Search by candidate name, email, or job title…'"
          class="w-full rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 pl-10 pr-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        />
      </div>
      <SavedViewsMenu
        :views="views"
        :active-view-id="activeViewId"
        :is-dirty="isDirty"
        @select="onSelectView"
        @save="onSaveView"
        @update="onUpdateView"
        @delete="deleteView"
        @set-default="setDefault"
      />
      <ColumnsMenu
        v-model="visibleColumns"
        :columns="applicationColumns"
      />
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
        :class="drawerActiveCount > 0
          ? 'border-surface-400 bg-surface-100 text-surface-800 dark:border-surface-500 dark:bg-surface-800 dark:text-surface-200'
          : 'border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'"
        @click="drawerOpen = true"
      >
        <SlidersHorizontal class="size-4" />
        Filters
        <span
          v-if="drawerActiveCount > 0"
          class="inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-surface-700 dark:bg-surface-300 text-white dark:text-surface-900 text-[10px] font-semibold"
        >{{ drawerActiveCount }}</span>
      </button>
      <button
        v-if="hasActiveFilters"
        class="inline-flex items-center gap-1 text-xs text-surface-400 hover:text-danger-600 transition-colors"
        @click="clearAllFilters"
      >
        <X class="size-3" />
        Clear
      </button>
      <button
        type="button"
        class="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-2.5 py-2 text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
        :aria-pressed="isWideDetail"
        :title="isWideDetail ? 'Use centered width' : 'Use full width'"
        @click="isWideDetail = !isWideDetail"
      >
        <FoldHorizontal v-if="isWideDetail" class="size-4" />
        <UnfoldHorizontal v-else class="size-4" />
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-2.5 py-2 text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
        :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen table'"
        @click="isFullscreen = !isFullscreen"
      >
        <Maximize2 v-if="!isFullscreen" class="size-4" />
        <Minimize2 v-else class="size-4" />
      </button>
    </div>

    <!-- Filter drawer -->
    <FilterDrawer
      v-model="drawerOpen"
      title="Filter applications"
      description="Customize your view, then save it for quick access."
      :active-count="drawerActiveCount"
      saveable
      :default-save-name="`View ${views.length + 1}`"
      @reset="applySettings(defaultSettings)"
      @save-view="onSaveView"
    >
      <div class="space-y-6">
        <!-- Status -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Status</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              :class="!activeStatus
                ? 'bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
              @click="activeStatus = undefined"
            >Any</button>
            <button
              v-for="s in STATUS_OPTIONS"
              :key="s"
              type="button"
              class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              :class="activeStatus === s
                ? 'bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
              @click="activeStatus = activeStatus === s ? undefined : s"
            >{{ statusLabels[s] }}</button>
          </div>
        </div>

        <!-- Viewed -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Viewed</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              :class="!activeViewed
                ? 'bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
              @click="activeViewed = undefined"
            >Any</button>
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              :class="activeViewed === 'unviewed'
                ? 'bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
              @click="activeViewed = activeViewed === 'unviewed' ? undefined : 'unviewed'"
            >Not viewed by me</button>
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              :class="activeViewed === 'viewed'
                ? 'bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
              @click="activeViewed = activeViewed === 'viewed' ? undefined : 'viewed'"
            >Viewed by me</button>
          </div>
          <p v-if="activeViewed === 'unviewed'" class="mt-2 text-xs text-surface-400 dark:text-surface-500">
            Rejected applicants are excluded — they've already been decided on.
          </p>
        </div>

        <!-- Job (global list only) -->
        <div v-if="!jobId">
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Job</label>
          <select
            v-model="activeJobId"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          >
            <option :value="undefined">All jobs</option>
            <option v-for="j in uniqueJobs" :key="j.id" :value="j.id">{{ j.title }}</option>
          </select>
        </div>

        <!-- Sort -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Sort by</label>
          <div class="flex gap-2">
            <select
              v-model="sortKey"
              class="flex-1 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            >
              <option value="created">Applied date</option>
              <option value="name">Candidate name</option>
              <option value="email">Email</option>
              <option v-if="!jobId" value="job">Job title</option>
              <option value="status">Status</option>
              <option value="score">Score</option>
            </select>
            <select
              v-model="sortDir"
              class="w-32 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </div>

        <!-- Property filters -->
        <div v-if="propertyDefs.length > 0">
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Properties</label>
          <PropertyFilterBar v-model="propertyFilters" entity-type="application" />
        </div>

        <!-- Columns -->
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Columns</label>
          <div class="space-y-1.5">
            <template v-for="item in columnPickerItems" :key="item.key">
              <div
                v-if="item.type === 'header'"
                class="pt-2 text-[11px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500"
              >
                {{ item.label }}
              </div>
              <label
                v-else
                class="flex items-center gap-2.5 cursor-pointer select-none group"
              >
                <span
                  class="flex size-4 shrink-0 items-center justify-center rounded border transition-colors"
                  :class="visibleColumns[item.col.key] ? 'bg-brand-600 border-brand-600 text-white' : 'border-surface-300 dark:border-surface-600'"
                  @click="visibleColumns = { ...visibleColumns, [item.col.key]: !visibleColumns[item.col.key] }"
                >
                  <Check v-if="visibleColumns[item.col.key]" class="size-3" />
                </span>
                <span class="text-sm text-surface-700 dark:text-surface-300 group-hover:text-surface-900 dark:group-hover:text-surface-100 transition-colors">{{ item.col.label }}</span>
              </label>
            </template>
          </div>
        </div>
      </div>
    </FilterDrawer>

    <!-- Loading -->
    <div v-if="fetchStatus === 'pending'" class="text-center py-16 text-surface-400">
      Loading applications…
    </div>

    <!-- Error -->
    <div
      v-else-if="error"
      class="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700"
    >
      Failed to load applications. Please try again.
      <button class="underline ml-1" @click="refresh()">Retry</button>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="applications.length === 0"
      class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-16 text-center"
    >
      <FileText class="size-10 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
      <h3 class="text-base font-semibold text-surface-700 dark:text-surface-200 mb-1">No applications yet</h3>
      <p class="text-sm text-surface-500 dark:text-surface-400">
        {{ jobId
          ? 'Applications will appear here when candidates apply to this job or when you link candidates.'
          : 'Applications will appear here when candidates apply to your jobs or when you manually link candidates.' }}
      </p>
    </div>

    <!-- No results after filtering -->
    <div
      v-else-if="filteredApplications.length === 0"
      class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-12 text-center"
    >
      <Search class="size-8 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
      <h3 class="text-base font-semibold text-surface-700 dark:text-surface-200 mb-1">No matching applications</h3>
      <p class="text-sm text-surface-500 dark:text-surface-400 mb-3">
        Try adjusting your search or filters.
      </p>
      <button
        class="text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors"
        @click="clearAllFilters"
      >
        Clear all filters
      </button>
    </div>

    <!-- Application table -->
    <div v-else class="min-h-0 flex-1">
      <Teleport to="body" :disabled="!isFullscreen">
        <div :class="isFullscreen ? 'fixed inset-0 z-50 bg-white dark:bg-surface-950 flex flex-col' : 'flex h-full min-h-0 flex-col'">
          <!-- Fullscreen header -->
          <div v-if="isFullscreen" class="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-800 shrink-0 bg-white dark:bg-surface-950">
            <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">
              Applications — {{ filteredApplications.length }} result{{ filteredApplications.length === 1 ? '' : 's' }}
            </span>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-800 px-2.5 py-1.5 text-sm text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
              @click="isFullscreen = false"
            >
              <Minimize2 class="size-4" />
              Exit fullscreen
            </button>
          </div>
          <div :class="isFullscreen ? 'flex-1 min-h-0 overflow-hidden p-4' : 'min-h-0 flex-1'">
            <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-surface-200 dark:border-surface-800">
              <div class="min-h-0 flex-1 overflow-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-800">
              <th class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('name')">
                  Candidate
                  <ArrowUp v-if="sortKey === 'name' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'name' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.email" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden lg:table-cell">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('email')">
                  Email
                  <ArrowUp v-if="sortKey === 'email' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'email' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="!jobId && visibleColumns.job" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden md:table-cell">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('job')">
                  Job
                  <ArrowUp v-if="sortKey === 'job' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'job' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.status" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('status')">
                  Status
                  <ArrowUp v-if="sortKey === 'status' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'status' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.score" class="text-center px-4 py-3 font-medium text-surface-500 dark:text-surface-400 hidden sm:table-cell">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('score')">
                  Score
                  <ArrowUp v-if="sortKey === 'score' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'score' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <th v-if="visibleColumns.applied" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400">
                <button class="inline-flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-100 transition-colors" @click="toggleSort('created')">
                  Applied
                  <ArrowUp v-if="sortKey === 'created' && sortDir === 'asc'" class="size-3.5" />
                  <ArrowDown v-else-if="sortKey === 'created' && sortDir === 'desc'" class="size-3.5" />
                  <ArrowUpDown v-else class="size-3.5 opacity-40" />
                </button>
              </th>
              <template v-for="d in propertyDefs" :key="d.id">
                <th v-if="visibleColumns[`prop_${d.id}`]" class="text-left px-4 py-3 font-medium text-surface-500 dark:text-surface-400 whitespace-nowrap">
                  {{ d.name }}
                </th>
              </template>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
            <tr
              v-for="app in filteredApplications"
              :key="app.id"
              class="group transition-colors cursor-pointer [&>td]:align-top"
              :class="app.id === selectedApplicationId
                ? 'bg-brand-50 dark:bg-brand-500/10 hover:bg-brand-50 dark:hover:bg-brand-500/10'
                : 'bg-white dark:bg-surface-900 hover:bg-surface-50 dark:hover:bg-surface-800/60'"
              @click="openApplication(app.id)"
            >
              <td class="px-4 py-3">
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 font-semibold text-surface-900 dark:text-surface-100 group-hover:text-brand-600 transition-colors whitespace-nowrap text-left cursor-pointer"
                  @click.stop="openApplication(app.id)"
                >
                  <!-- Unread-mail convention: the dot marks applicants this
                       recruiter has never opened. -->
                  <span
                    v-if="!isViewed(app)"
                    class="size-1.5 shrink-0 rounded-full bg-brand-500 dark:bg-brand-400"
                    title="You haven't viewed this applicant yet"
                  />
                  <span
                    v-else
                    class="size-1.5 shrink-0"
                    aria-hidden="true"
                  />
                  {{ formatPersonName(app.candidateFirstName, app.candidateLastName) }}
                </button>
              </td>
              <td v-if="visibleColumns.email" class="px-4 py-3 text-surface-500 dark:text-surface-400 hidden lg:table-cell">
                <span class="inline-flex items-center gap-1.5">
                  <Mail class="size-3.5 shrink-0" />
                  <span class="truncate max-w-[200px]">{{ app.candidateEmail }}</span>
                </span>
              </td>
              <td v-if="!jobId && visibleColumns.job" class="px-4 py-3 text-surface-600 dark:text-surface-300 hidden md:table-cell">
                <span class="inline-flex items-center gap-1.5 truncate max-w-[200px]">
                  <Briefcase class="size-3.5 shrink-0 text-surface-400" />
                  {{ app.jobTitle }}
                </span>
              </td>
              <td v-if="visibleColumns.status" class="px-4 py-3">
                <span
                  class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap"
                  :class="statusBadgeClasses[app.status] ?? 'bg-surface-100 text-surface-600'"
                >
                  <span class="size-1.5 rounded-full" :class="statusDotClasses[app.status] ?? 'bg-surface-400'" />
                  {{ statusLabels[app.status as Status] ?? app.status }}
                </span>
              </td>
              <td v-if="visibleColumns.score" class="px-4 py-3 text-center hidden sm:table-cell">
                <span
                  v-if="app.score != null"
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset"
                  :class="scoreClass(app.score)"
                >
                  {{ app.score }}%
                </span>
                <span v-else class="text-surface-300 dark:text-surface-600">—</span>
              </td>
              <td v-if="visibleColumns.applied" class="px-4 py-3 text-surface-400 whitespace-nowrap">
                <TimelineDateLink :date="app.createdAt" class="inline-flex items-center gap-1.5">
                  <Clock class="size-3.5 shrink-0" />
                  {{ timeAgo(app.createdAt) }}
                </TimelineDateLink>
              </td>
              <!-- Property columns -->
              <template v-for="d in propertyDefs" :key="d.id">
                <td v-if="visibleColumns[`prop_${d.id}`]" class="px-4 py-3 text-surface-500 dark:text-surface-400 align-top max-w-[220px]">
                  <PropertyTableCell
                    v-if="!d.jobId || d.jobId === app.jobId"
                    entity-type="application"
                    :entity-id="app.id"
                    :definition="d"
                    :value="getPropertyValue(app, d.id)"
                    compact
                  />
                  <span v-else class="text-surface-300 dark:text-surface-600">—</span>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="shrink-0 flex flex-col gap-3 border-t border-surface-200 dark:border-surface-800 bg-surface-50/80 dark:bg-surface-900 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
          <span>
            Showing {{ pageStart }}-{{ pageEnd }} of {{ total }} application{{ total === 1 ? '' : 's' }}
          </span>
          <label class="inline-flex items-center gap-1.5">
            <span>Rows</span>
            <select
              v-model.number="pageSize"
              class="h-8 rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-950 px-2 text-xs text-surface-700 dark:text-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
            </select>
          </label>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-surface-500 dark:text-surface-400">
            Page {{ page }} of {{ totalPages }}
          </span>
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-950 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="page <= 1"
            title="Previous page"
            @click="page--"
          >
            <ChevronLeft class="size-4" />
          </button>
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-950 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="page >= totalPages"
            title="Next page"
            @click="page++"
          >
            <ChevronRight class="size-4" />
          </button>
        </div>
      </div>
            </div>
          </div>
        </div>
      </Teleport>
    </div>

    <!-- Application detail drawer -->
    <ApplicationDetailDrawer
      v-if="selectedApplicationId"
      :application-id="selectedApplicationId"
      @close="selectedApplicationId = null"
      @deleted="handleApplicationDeleted"
    />
  </div>
</template>
