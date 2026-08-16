<script setup lang="ts">
import {
  ArrowLeft, ArrowRight, Briefcase, Calendar, Clock, Hash, UserRound, Mail, MessageSquare,
  FileText, Paperclip, Download, Eye, Phone, Search, ExternalLink,
  Pencil, Trash2, Globe, ChevronDown, X,
  Video, Building2, Code2, UsersRound, Save, Check, MapPin, Users, Plus,
  CheckCircle2, XCircle, AlertTriangle, ArrowUpDown, ListFilter,
  Maximize2, Minimize2, Brain, History, SlidersHorizontal,
  ChevronLeft, ChevronRight, UnfoldHorizontal, FoldHorizontal,
  StickyNote, MoreHorizontal, Inbox, Zap, Megaphone,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import type { Interview, InterviewMutationResult } from '~/composables/useInterviews'
import type { PropertyEntry, PropertyFilter } from '~~/shared/properties'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'
import { APPLICATION_STATUS_TRANSITIONS, INTERVIEW_STATUS_TRANSITIONS } from '~~/shared/status-transitions'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const localePath = useLocalePath()
const jobId = route.params.id as string
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const { track } = useTrack()
const toast = useToast()
const { formatPersonName } = useOrgSettings()
const { reportStatus, reportCandidateUpdate } = useInterviewMutationFeedback()

// ─────────────────────────────────────────────
// Job data (with update/delete support)
// ─────────────────────────────────────────────

const { job: jobData, status: jobFetchStatus, error: jobError } = useJob(jobId)

// ─────────────────────────────────────────────
// Applications data
// ─────────────────────────────────────────────

const PIPELINE_STATUSES = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const
type PipelineStatus = typeof PIPELINE_STATUSES[number]

// Read initial pipeline stage from URL query param (?stage=screening)
const initialStage = PIPELINE_STATUSES.includes(route.query.stage as any)
  ? (route.query.stage as PipelineStatus)
  : 'new'
const focusStatus = ref<PipelineStatus>(initialStage)
const searchTerm = ref('')
const debouncedSearchTerm = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout>
watch(searchTerm, (value) => {
  clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    debouncedSearchTerm.value = value.trim()
  }, 250)
})

// ─────────────────────────────────────────────
// Filters & Sorting
// ─────────────────────────────────────────────

type SortOption = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'score-desc' | 'score-asc' | 'updated-desc'
type ScoreFilter = 'all' | 'high' | 'medium' | 'low' | 'none'
type InterviewFilter = 'all' | 'has-interview' | 'no-interview'

const sortBy = ref<SortOption>('score-desc')
const scoreFilter = ref<ScoreFilter>('all')
const interviewFilter = ref<InterviewFilter>('all')
const propertyFilters = ref<PropertyFilter[]>([])
const showSortPanel = ref(false)
const showFilterPanel = ref(false)

const hasActiveFilters = computed(() => scoreFilter.value !== 'all' || interviewFilter.value !== 'all' || propertyFilters.value.length > 0)
const activeFilterCount = computed(() => {
  let count = 0
  if (scoreFilter.value !== 'all') count++
  if (interviewFilter.value !== 'all') count++
  count += propertyFilters.value.length
  return count
})

function clearFilters() {
  scoreFilter.value = 'all'
  interviewFilter.value = 'all'
  propertyFilters.value = []
}

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'name-asc', label: 'Name A \u2192 Z' },
  { value: 'name-desc', label: 'Name Z \u2192 A' },
  { value: 'score-desc', label: 'Highest score' },
  { value: 'score-asc', label: 'Lowest score' },
  { value: 'updated-desc', label: 'Recently updated' },
]

const currentSortLabel = computed(() =>
  sortOptions.find(o => o.value === sortBy.value)?.label ?? 'Sort',
)

const scoreFilterOptions: { value: ScoreFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'high', label: '75+' },
  { value: 'medium', label: '40\u201374' },
  { value: 'low', label: '< 40' },
  { value: 'none', label: 'No score' },
]

const interviewFilterOptions: { value: InterviewFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'has-interview', label: 'Scheduled' },
  { value: 'no-interview', label: 'None' },
]

function selectSort(option: SortOption) {
  sortBy.value = option
  showSortPanel.value = false
}

const PIPELINE_PAGE_SIZE = 50
const page = ref(1)
const applicationQuery = computed(() => ({
  jobId,
  status: focusStatus.value,
  page: page.value,
  limit: PIPELINE_PAGE_SIZE,
  ...(debouncedSearchTerm.value && { search: debouncedSearchTerm.value }),
  ...(scoreFilter.value !== 'all' && { score: scoreFilter.value }),
  ...(interviewFilter.value !== 'all' && { interview: interviewFilter.value }),
  ...(propertyFilters.value.length > 0 && { propertyFilters: JSON.stringify(propertyFilters.value) }),
  sort: sortBy.value,
}))

const {
  data: appData,
  status: appFetchStatus,
  error: appError,
  refresh: refreshApps,
} = useFetch('/api/applications', {
  key: `pipeline-apps-${jobId}`,
  query: applicationQuery,
  headers: useRequestHeaders(['cookie']),
})

const { markViewedLocally, isViewed } = useApplicationViews()

const applications = computed(() => appData.value?.data ?? [])
const focusedApplicationTotal = computed(() => appData.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(focusedApplicationTotal.value / PIPELINE_PAGE_SIZE)))
const pageStart = computed(() => focusedApplicationTotal.value === 0 ? 0 : ((page.value - 1) * PIPELINE_PAGE_SIZE) + 1)
const pageEnd = computed(() => Math.min(focusedApplicationTotal.value, page.value * PIPELINE_PAGE_SIZE))

function closePanels() {
  showSortPanel.value = false
  showFilterPanel.value = false
  showOverviewDropdown.value = false
}

const filteredApplications = computed(() => applications.value)

type StatusCountMap = {
  new: number
  screening: number
  interview: number
  offer: number
  hired: number
  rejected: number
}

const statusCounts = computed(() => {
  const counts: StatusCountMap = { new: 0, screening: 0, interview: 0, offer: 0, hired: 0, rejected: 0 }
  const apiCounts = appData.value?.statusCounts
  if (apiCounts) {
    for (const status of PIPELINE_STATUSES) {
      counts[status] = apiCounts[status] ?? 0
    }
  }
  return counts
})

/**
 * True when the job has no applicants in any stage — not merely none in the
 * stage currently being viewed. Distinguishes "nothing here yet, go get
 * applicants" from "this stage is empty, look at another one".
 */
const hasNoApplicantsAtAll = computed(() =>
  Object.values(statusCounts.value).every(count => count === 0),
)

const selectedApplicationId = ref<string | null>(null)
// One-shot instruction for the next list arrival: paging backwards should land on
// the last candidate of the previous page instead of the default first.
const selectLastOnNextLoad = ref(false)

// Derived, not assigned from a watcher: the applications fetch resolves after
// setup() on the server and watchers never re-run there, so a watcher-set
// selection stays null in the server HTML while the client picks a candidate
// during hydration. Vue does not patch mismatched classes on hydration, which
// leaves the sidebar with nothing highlighted.
const currentSummary = computed(() => {
  const apps = filteredApplications.value
  if (apps.length === 0) return null
  return apps.find(app => app.id === selectedApplicationId.value) ?? apps[0]!
})

const currentIndex = computed({
  get: () => filteredApplications.value.findIndex(app => app.id === currentSummary.value?.id),
  set: (index: number) => {
    selectedApplicationId.value = filteredApplications.value[index]?.id ?? null
  },
})

// Mobile: toggle between candidate list and detail view
const showMobileDetail = ref(false)

watch(filteredApplications, (apps) => {
  if (selectLastOnNextLoad.value && apps.length > 0) {
    selectedApplicationId.value = apps[apps.length - 1]!.id
  }
  selectLastOnNextLoad.value = false
})

watch(focusStatus, () => {
  searchTerm.value = ''
  debouncedSearchTerm.value = ''
  propertyFilters.value = []
  closePanels()
  page.value = 1
  selectedApplicationId.value = null
})

watch([debouncedSearchTerm, sortBy, scoreFilter, interviewFilter, propertyFilters], () => {
  page.value = 1
  selectedApplicationId.value = null
}, { deep: true })

watch(totalPages, (next) => {
  if (page.value > next) page.value = next
})

// Auto-scroll mobile bottom bar and sidebar list to keep selected candidate visible
watch(currentIndex, () => {
  nextTick(() => {
    const bottomBar = mobileBottomBar.value
    if (bottomBar) {
      const selected = bottomBar.querySelector(`[data-candidate-idx="${currentIndex.value}"]`) as HTMLElement | null
      selected?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
    const list = sidebarList.value
    if (list) {
      const selected = list.querySelector(`[data-candidate-idx="${currentIndex.value}"]`) as HTMLElement | null
      selected?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  })
})

// Detail tab for center panel
type DetailTab = 'overview' | 'inbox' | 'cover-letter' | 'interviews' | 'documents' | 'responses' | 'ai-analysis' | 'timeline' | 'properties' | 'notes'
const detailTab = ref<DetailTab>('overview')

// Overview section visibility toggles
const overviewSections = reactive({
  coverLetter: true,
  aiAnalysis: true,
  interviews: true,
  documents: true,
  responses: true,
  properties: true,
  notes: true,
})
const showOverviewDropdown = ref(false)
const overviewDropdownRef = ref<HTMLElement | null>(null)

function handleOverviewDropdownClickOutside(event: MouseEvent) {
  if (overviewDropdownRef.value && !overviewDropdownRef.value.contains(event.target as Node)) {
    showOverviewDropdown.value = false
  }
}

watch(showOverviewDropdown, (val) => {
  if (val) {
    setTimeout(() => document.addEventListener('click', handleOverviewDropdownClickOutside), 0)
  } else {
    document.removeEventListener('click', handleOverviewDropdownClickOutside)
  }
})

// Which sections to display based on active tab
const showSection = computed(() => ({
  coverLetter: detailTab.value === 'overview' ? overviewSections.coverLetter : detailTab.value === 'cover-letter',
  aiAnalysis: detailTab.value === 'overview' ? overviewSections.aiAnalysis : detailTab.value === 'ai-analysis',
  interviews: detailTab.value === 'overview' ? overviewSections.interviews : detailTab.value === 'interviews',
  documents: detailTab.value === 'overview' ? overviewSections.documents : detailTab.value === 'documents',
  responses: detailTab.value === 'overview' ? overviewSections.responses : detailTab.value === 'responses',
  properties: detailTab.value === 'overview' ? overviewSections.properties : detailTab.value === 'properties',
  notes: detailTab.value === 'overview' ? overviewSections.notes : detailTab.value === 'notes',
  timeline: detailTab.value === 'timeline',
}))

// ─────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────

interface TimelineEntry {
  id: string
  action: string
  resourceType: string
  resourceId: string
  metadata: Record<string, unknown> | null
  createdAt: string
  actorName: string | null
  actorEmail: string | null
  resourceName: string | null
  jobTitle: string | null
  candidateName: string | null
}

const timelineItems = ref<TimelineEntry[]>([])
const timelineLoading = ref(false)
const timelineError = ref<string | null>(null)
const timelineLoaded = ref(false)

const timelineActionLabels: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  status_changed: 'Status changed',
  comment_added: 'Comment added',
  scored: 'Scored',
  scheduled: 'Scheduled',
}

function formatTimelineDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface TimelineActionStyle {
  icon: typeof Plus
  color: string
  bg: string
}

function getTimelineActionStyle(action: string): TimelineActionStyle {
  const map: Record<string, TimelineActionStyle> = {
    created: { icon: Plus, color: 'text-success-600 dark:text-success-400', bg: 'bg-success-50 dark:bg-success-950/50' },
    updated: { icon: Pencil, color: 'text-brand-600 dark:text-brand-400', bg: 'bg-brand-50 dark:bg-brand-950/50' },
    deleted: { icon: Trash2, color: 'text-danger-600 dark:text-danger-400', bg: 'bg-danger-50 dark:bg-danger-950/50' },
    status_changed: { icon: ArrowRight, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/50' },
    comment_added: { icon: MessageSquare, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/50' },
    scored: { icon: Brain, color: 'text-accent-600 dark:text-accent-400', bg: 'bg-accent-50 dark:bg-accent-950/50' },
    scheduled: { icon: Calendar, color: 'text-brand-600 dark:text-brand-400', bg: 'bg-brand-50 dark:bg-brand-950/50' },
  }
  return map[action] ?? { icon: Clock, color: 'text-surface-500 dark:text-surface-400', bg: 'bg-surface-100 dark:bg-surface-800' }
}

function getTimelineStatusBadge(status: string): string {
  const s = status.toLowerCase()
  const map: Record<string, string> = {
    new: 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300',
    screening: 'bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300',
    interview: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300',
    offer: 'bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-300',
    hired: 'bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300',
    rejected: 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300',
  }
  return map[s] ?? 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300'
}

function describeTimelineItem(item: TimelineEntry): string {
  const actor = item.actorName ?? item.actorEmail ?? 'System'
  const action = timelineActionLabels[item.action] ?? item.action
  const resource = item.resourceType

  if (item.action === 'status_changed' && item.metadata) {
    const from = item.metadata.from_status ?? item.metadata.fromStatus
    const to = item.metadata.to_status ?? item.metadata.toStatus
    if (from && to) return `${actor} changed ${resource} status from ${from} to ${to}`
  }

  if (item.action === 'scored' && item.metadata) {
    const score = item.metadata.score
    if (score != null) return `${actor} scored ${resource} — ${score} pts`
  }

  return `${actor} ${action.toLowerCase()} ${resource}`
}

// Section refs
const interviewsRef = ref<HTMLElement | null>(null)
const documentsRef = ref<HTMLElement | null>(null)
const responsesRef = ref<HTMLElement | null>(null)
const detailScrollContainer = ref<HTMLElement | null>(null)
const mobileBottomBar = ref<HTMLElement | null>(null)
const sidebarList = ref<HTMLElement | null>(null)

type SwipeDocument = {
  id: string
  type: 'resume' | 'cover_letter' | 'other'
  originalFilename: string
  mimeType: string
  createdAt: string | Date
}

type SwipeResponse = {
  id: string
  value: unknown
  question: {
    id: string
    label: string
    type: string
    options: string[] | null
  } | null
}

type SwipeApplicationDetail = {
  id: string
  status: string
  score: number | null
  notes: string | null
  coverLetterText: string | null
  autoRule: { ruleId: string; ruleName: string; action: string; matchedQuestionIds: string[] } | null
  createdAt: string | Date
  updatedAt: string | Date
  candidate: {
    id: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
    documents: SwipeDocument[]
  }
  responses: SwipeResponse[]
  properties: PropertyEntry[]
}

const currentApplicationId = ref('')

watch(currentSummary, (summary) => {
  if (!summary?.id) return
  currentApplicationId.value = summary.id
}, { immediate: true })

const {
  data: currentApplication,
  execute: executeDetailFetch,
} = useFetch<SwipeApplicationDetail | null>(
  () => `/api/applications/${currentApplicationId.value}`,
  {
    key: computed(() => `pipeline-application-${currentApplicationId.value}`),
    immediate: false,
    watch: false,
    headers: useRequestHeaders(['cookie']),
  },
)

// Keep the last successfully loaded application visible while the next one is
// being fetched, so switching candidates swaps the detail in place instead of
// flashing the skeleton (and header fields don't vanish/reappear). `useFetch`
// resets its own data ref every time the keyed request changes, so we hold on
// to the previous payload ourselves. Only before the very first load is this
// null.
const lastLoadedApplication = shallowRef<SwipeApplicationDetail | null>(currentApplication.value ?? null)
watch(currentApplication, (app) => {
  if (app) lastLoadedApplication.value = app
}, { immediate: true })

const resolvedCurrentApplication = computed(() => currentApplication.value ?? lastLoadedApplication.value)

// The automation rule (if any) that auto-set this application's status on
// submit, plus a lookup of which responses triggered it — drives the "Auto"
// status badge and the per-response trigger badges.
const autoRule = computed(() => resolvedCurrentApplication.value?.autoRule ?? null)
function isRuleTriggerQuestion(questionId: string | undefined): boolean {
  return !!questionId && !!autoRule.value?.matchedQuestionIds?.includes(questionId)
}

// True while what we're showing no longer belongs to the selected candidate,
// i.e. a fetch for the newly selected candidate is still in flight.
const isDetailStale = computed(() =>
  !currentApplication.value || currentApplication.value.id !== currentApplicationId.value,
)

// Once a candidate has been shown we never fall back to the skeleton again —
// the previous detail stays on screen and the new one swaps into it. For a
// genuinely slow fetch we instead dim the (now outdated) content after a short
// delay, so the user gets a loading cue without the layout tearing down. Fast
// and cached switches resolve before this fires and show nothing at all.
const showDetailLoadingVeil = ref(false)
let detailVeilTimer: ReturnType<typeof setTimeout> | null = null
watch(isDetailStale, (stale) => {
  if (detailVeilTimer) {
    clearTimeout(detailVeilTimer)
    detailVeilTimer = null
  }
  if (stale) {
    detailVeilTimer = setTimeout(() => {
      showDetailLoadingVeil.value = true
    }, 250)
  } else {
    showDetailLoadingVeil.value = false
  }
})
onBeforeUnmount(() => {
  if (detailVeilTimer) clearTimeout(detailVeilTimer)
})

const hasCoverLetter = computed(() => Boolean(resolvedCurrentApplication.value?.coverLetterText?.trim()))

watch(hasCoverLetter, (hasLetter) => {
  if (!hasLetter && detailTab.value === 'cover-letter') {
    detailTab.value = 'overview'
  }
})

watch(currentApplicationId, () => {
  timelineItems.value = []
  timelineLoading.value = false
  timelineLoaded.value = false
  timelineError.value = null
})

watch(currentApplicationId, async (id) => {
  if (!id) return
  await executeDetailFetch()
  // The detail request is what logs the view server-side; mirror it locally so
  // the sidebar's "not viewed" dot clears without waiting for a list refetch.
  markViewedLocally(id)
}, { immediate: true })

async function loadTimeline() {
  const candId = resolvedCurrentApplication.value?.candidate?.id
  if (!candId) return
  timelineLoading.value = true
  timelineError.value = null
  try {
    const result = await $fetch<{ items: TimelineEntry[] }>('/api/activity-log/candidate-timeline', {
      query: { candidateId: candId },
    })
    if (candId !== timelineCandidateId.value) return
    timelineItems.value = result.items
    timelineLoaded.value = true
  } catch (err: any) {
    if (candId !== timelineCandidateId.value) return
    timelineError.value = err?.data?.statusMessage ?? 'Failed to load timeline'
  } finally {
    if (candId === timelineCandidateId.value) {
      timelineLoading.value = false
    }
  }
}

const timelineCandidateId = computed(() => resolvedCurrentApplication.value?.candidate?.id)

watch([detailTab, timelineCandidateId], () => {
  if (detailTab.value === 'timeline' && !timelineLoaded.value && timelineCandidateId.value) {
    loadTimeline()
  }
})

// ─────────────────────────────────────────────
// Notes (comments on the application)
// ─────────────────────────────────────────────

interface ApplicationNote {
  id: string
  body: string
  createdAt: string
  updatedAt: string
  authorId: string
  authorName: string | null
  authorEmail: string | null
  authorImage: string | null
}

const { allowed: canCreateNote, role: noteRole } = usePermission({ comment: ['create'] })

// Only used to decide which notes the current user owns, and notes are never
// rendered during SSR — so resolve the session on the client rather than
// awaiting it in setup.
const currentUserId = ref<string | null>(null)
onMounted(async () => {
  const { data } = await authClient.getSession()
  currentUserId.value = data?.user?.id ?? null
})

// Every role can edit/delete its own note; admins & owners can delete anyone's.
const canDeleteAnyNote = computed(() => noteRole.value === 'admin' || noteRole.value === 'owner')

const notes = ref<ApplicationNote[]>([])
const notesLoading = ref(false)
const notesError = ref<string | null>(null)
const notesLoaded = ref(false)

const noteDraft = ref('')
const isSavingNote = ref(false)
const editingNoteId = ref<string | null>(null)
const editingNoteBody = ref('')
const isUpdatingNote = ref(false)
const deletingNoteId = ref<string | null>(null)

const NOTE_MAX_LENGTH = 10000

function canEditNote(note: ApplicationNote) {
  return note.authorId === currentUserId.value
}

function canRemoveNote(note: ApplicationNote) {
  return canDeleteAnyNote.value || note.authorId === currentUserId.value
}

function noteAuthorLabel(note: ApplicationNote) {
  return note.authorName ?? note.authorEmail ?? 'Unknown'
}

/** `silent` keeps the existing list on screen while refreshing after a mutation. */
async function loadNotes(silent = false) {
  const appId = currentApplicationId.value
  if (!appId) return
  if (!silent) notesLoading.value = true
  notesError.value = null
  try {
    const result = await $fetch<{ data: ApplicationNote[] }>('/api/comments', {
      query: { targetType: 'application', targetId: appId, limit: 100 },
    })
    if (appId !== currentApplicationId.value) return
    notes.value = result.data
    notesLoaded.value = true
  } catch (err: any) {
    if (appId !== currentApplicationId.value) return
    notesError.value = err?.data?.statusMessage ?? 'Failed to load notes'
  } finally {
    if (appId === currentApplicationId.value) notesLoading.value = false
  }
}

watch(currentApplicationId, () => {
  notes.value = []
  notesLoading.value = false
  notesLoaded.value = false
  notesError.value = null
  noteDraft.value = ''
  editingNoteId.value = null
  editingNoteBody.value = ''
})

// Notes live inside the detail pane, which only renders once the (client-side)
// detail fetch resolves — so a server-side fetch here would be thrown away.
watch([() => showSection.value.notes, currentApplicationId], () => {
  if (import.meta.server) return
  if (showSection.value.notes && !notesLoaded.value && currentApplicationId.value) {
    loadNotes()
  }
}, { immediate: true })

async function addNote() {
  const body = noteDraft.value.trim()
  const appId = currentApplicationId.value
  if (!body || !appId || isSavingNote.value) return

  isSavingNote.value = true
  try {
    await $fetch('/api/comments', {
      method: 'POST',
      body: { targetType: 'application', targetId: appId, body },
    })
    if (appId !== currentApplicationId.value) return
    noteDraft.value = ''
    timelineLoaded.value = false
    await loadNotes(true)
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to add note', { message: err?.data?.statusMessage, statusCode: err?.data?.statusCode })
  } finally {
    isSavingNote.value = false
  }
}

function startEditNote(note: ApplicationNote) {
  editingNoteId.value = note.id
  editingNoteBody.value = note.body
}

function cancelEditNote() {
  editingNoteId.value = null
  editingNoteBody.value = ''
}

async function saveNote() {
  const noteId = editingNoteId.value
  const body = editingNoteBody.value.trim()
  if (!noteId || !body || isUpdatingNote.value) return

  isUpdatingNote.value = true
  try {
    const updated = await $fetch<ApplicationNote>(`/api/comments/${noteId}`, {
      method: 'PATCH',
      body: { body },
    })
    const existing = notes.value.find(n => n.id === noteId)
    if (existing) {
      existing.body = updated.body
      existing.updatedAt = updated.updatedAt
    }
    cancelEditNote()
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to save note', { message: err?.data?.statusMessage, statusCode: err?.data?.statusCode })
  } finally {
    isUpdatingNote.value = false
  }
}

async function deleteNote(note: ApplicationNote) {
  if (deletingNoteId.value) return
  if (!confirm('Delete this note? This cannot be undone.')) return

  deletingNoteId.value = note.id
  try {
    await $fetch(`/api/comments/${note.id}`, { method: 'DELETE' })
    notes.value = notes.value.filter(n => n.id !== note.id)
    timelineLoaded.value = false
    if (editingNoteId.value === note.id) cancelEditNote()
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to delete note', { message: err?.data?.statusMessage, statusCode: err?.data?.statusCode })
  } finally {
    deletingNoteId.value = null
  }
}

useSeoMeta({
  title: computed(() =>
    jobData.value ? `Pipeline — ${jobData.value.title} — Reqcore` : 'Pipeline — Reqcore',
  ),
  robots: 'noindex, nofollow',
})

// ─────────────────────────────────────────────
// Application status transitions
// ─────────────────────────────────────────────

const statusBadgeClasses: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  screening: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  interview: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  offer: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  hired: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
  rejected: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
}

const transitionLabels: Record<string, string> = {
  new: 'Re-open',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Reject',
}

const transitionClasses: Record<string, string> = {
  new: 'border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800',
  screening: 'bg-violet-600 text-white hover:bg-violet-700',
  interview: 'bg-amber-600 text-white hover:bg-amber-700',
  offer: 'bg-teal-600 text-white hover:bg-teal-700',
  hired: 'bg-green-700 text-white hover:bg-green-800',
  rejected: 'bg-danger-600 text-white hover:bg-danger-700',
}

function formatStatusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatResponseValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value ?? '—')
}

function formatDocumentType(value: SwipeDocument['type']) {
  if (value === 'cover_letter') return 'Cover Letter'
  if (value === 'resume') return 'Resume'
  return 'Other'
}

function getCandidateInitials(firstName?: string, lastName?: string) {
  const first = firstName?.trim().charAt(0) ?? ''
  const last = lastName?.trim().charAt(0) ?? ''
  return `${first}${last}`.toUpperCase() || 'C'
}

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
  if (score >= 75) return 'bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-400'
  if (score >= 40) return 'bg-warning-50 text-warning-700 dark:bg-warning-950 dark:text-warning-400'
  return 'bg-danger-50 text-danger-700 dark:bg-danger-950 dark:text-danger-400'
}

const allowedTransitions = computed(() => {
  if (!currentSummary.value) return []
  return APPLICATION_STATUS_TRANSITIONS[currentSummary.value.status] ?? []
})

// "Change status" dropdown
const showStatusDropdown = ref(false)
const statusDropdownRef = ref<HTMLElement | null>(null)

const statusDotClasses: Record<string, string> = {
  new: 'bg-blue-500',
  screening: 'bg-violet-600',
  interview: 'bg-amber-500',
  offer: 'bg-teal-600',
  hired: 'bg-green-600',
  rejected: 'bg-surface-400',
}

function handleStatusDropdownClickOutside(event: MouseEvent) {
  if (statusDropdownRef.value && !statusDropdownRef.value.contains(event.target as Node)) {
    showStatusDropdown.value = false
  }
}

watch(showStatusDropdown, (val) => {
  if (val) {
    setTimeout(() => document.addEventListener('click', handleStatusDropdownClickOutside), 0)
  } else {
    document.removeEventListener('click', handleStatusDropdownClickOutside)
  }
})

function handleStatusOptionClick(nextStatus: string) {
  showStatusDropdown.value = false
  if (nextStatus === 'interview') {
    openInterviewSchedulerForStatus()
  } else {
    changeStatus(nextStatus)
  }
}

function isCurrentStatus(status: string) {
  return currentSummary.value?.status === status
}

function isStatusActionEnabled(status: string) {
  if (!currentSummary.value) return false
  if (isCurrentStatus(status)) return false
  return allowedTransitions.value.includes(status)
}

function isFocusStatus(status: PipelineStatus) {
  return focusStatus.value === status
}

function setFocusStatus(status: PipelineStatus) {
  focusStatus.value = status
}

function selectCandidate(index: number) {
  currentIndex.value = index
  showMobileDetail.value = true
}

const isMutating = ref(false)

// ─────────────────────────────────────────────
// Interview scheduling sidebar
// ─────────────────────────────────────────────

const showInterviewSidebar = ref(false)
const interviewTargetApplication = ref<{ id: string; name: string } | null>(null)
const interviewToReschedule = ref<Interview | null>(null)
const interviewSidebarAllowsSkip = ref(false)

function openInterviewScheduler() {
  if (!currentSummary.value) return
  interviewToReschedule.value = null
  interviewSidebarAllowsSkip.value = false
  interviewTargetApplication.value = {
    id: currentSummary.value.id,
    name: `${currentSummary.value.candidateFirstName} ${currentSummary.value.candidateLastName}`,
  }
  showInterviewSidebar.value = true
}

/** "Interview" status transition — scheduling is offered, but skippable. */
function openInterviewSchedulerForStatus() {
  openInterviewScheduler()
  interviewSidebarAllowsSkip.value = showInterviewSidebar.value
}

async function skipInterviewScheduling() {
  closeInterviewSidebar()
  await changeStatus('interview')
}

function closeInterviewSidebar() {
  showInterviewSidebar.value = false
  interviewTargetApplication.value = null
  interviewToReschedule.value = null
  interviewSidebarAllowsSkip.value = false
}

async function handleInterviewScheduled() {
  const wasRescheduled = !!interviewToReschedule.value
  showInterviewSidebar.value = false
  const scheduledApplicationId = interviewTargetApplication.value?.id ?? currentSummary.value?.id
  interviewTargetApplication.value = null
  interviewToReschedule.value = null

  track(wasRescheduled ? 'interview_rescheduled' : 'interview_scheduled')

  await refreshJobInterviews()

  if (wasRescheduled) return

  // Scheduling moves the candidate into the interview stage server-side. Refresh
  // the pipeline to reflect that, and when the transition applies, follow the
  // candidate to the interview column so the user sees the scheduled interview.
  if (currentSummary.value && currentSummary.value.status !== 'interview') {
    const allowed = APPLICATION_STATUS_TRANSITIONS[currentSummary.value.status] ?? []
    if (allowed.includes('interview')) {
      await refreshApps()

      if (scheduledApplicationId) {
        focusStatus.value = 'interview'
        await nextTick()
        if (filteredApplications.value.some(app => app.id === scheduledApplicationId)) {
          selectedApplicationId.value = scheduledApplicationId
        }
      }
    }
  }
}

// ─────────────────────────────────────────────
// Interviews for this job
// ─────────────────────────────────────────────

const { data: jobInterviewsData, refresh: refreshJobInterviews } = useFetch<{ data: Interview[] }>('/api/interviews', {
  key: computed(() => `pipeline-application-interviews-${currentApplicationId.value}`),
  query: computed(() => ({ applicationId: currentApplicationId.value, limit: 100 })),
  headers: useRequestHeaders(['cookie']),
})

const jobInterviews = computed(() => jobInterviewsData.value?.data ?? [])

const currentApplicationInterviews = computed(() => jobInterviews.value)

const applicationsWithInterviews = computed(() =>
  new Set(applications.value.filter(app => app.hasInterview).map(app => app.id)),
)

const interviewTypeIcons: Record<string, any> = {
  video: Video,
  phone: Phone,
  in_person: Building2,
  technical: Code2,
  panel: UsersRound,
  take_home: FileText,
}

const interviewTypeLabels: Record<string, string> = {
  video: 'Video',
  phone: 'Phone',
  in_person: 'In Person',
  technical: 'Technical',
  panel: 'Panel',
  take_home: 'Take Home',
}

const interviewStatusClasses: Record<string, string> = {
  scheduled: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-800',
  completed: 'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950/50 dark:text-success-300 dark:ring-success-800',
  cancelled: 'bg-surface-100 text-surface-500 ring-surface-200 dark:bg-surface-800/50 dark:text-surface-400 dark:ring-surface-700',
  no_show: 'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950/50 dark:text-danger-300 dark:ring-danger-800',
}

function formatInterviewDateTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    + ' at '
    + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatInterviewDateTimeFull(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function isInterviewUpcoming(dateStr: string) {
  return new Date(dateStr) > new Date()
}

// ─────────────────────────────────────────────
// Interview inline editing
// ─────────────────────────────────────────────

type InterviewStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show'

function getAllowedInterviewTransitions(status: string): InterviewStatus[] {
  return (INTERVIEW_STATUS_TRANSITIONS[status] ?? []) as InterviewStatus[]
}

const interviewTransitionClasses: Record<InterviewStatus, string> = {
  scheduled: 'border border-surface-300 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800',
  completed: 'bg-success-600 text-white hover:bg-success-700',
  cancelled: 'bg-surface-500 text-white hover:bg-surface-600',
  no_show: 'bg-danger-600 text-white hover:bg-danger-700',
}

const interviewTransitionLabels: Record<InterviewStatus, string> = {
  scheduled: 'Re-schedule',
  completed: 'Completed',
  cancelled: 'Cancel',
  no_show: 'No Show',
}

const interviewStatusIcons: Record<InterviewStatus, any> = {
  scheduled: Calendar,
  completed: CheckCircle2,
  cancelled: XCircle,
  no_show: AlertTriangle,
}

const expandedInterviewId = ref<string | null>(null)
const editingInterviewId = ref<string | null>(null)
const interviewEditForm = reactive({
  title: '',
  type: 'video' as string,
  location: '',
  notes: '',
  interviewers: [''] as string[],
})
const interviewEditErrors = ref<Record<string, string>>({})
const isInterviewSaving = ref(false)
const isInterviewTransitioning = ref(false)

function toggleInterviewExpand(id: string) {
  if (expandedInterviewId.value === id) {
    expandedInterviewId.value = null
    editingInterviewId.value = null
  } else {
    expandedInterviewId.value = id
    editingInterviewId.value = null
  }
}

function startInterviewEdit(iv: Interview) {
  editingInterviewId.value = iv.id
  interviewEditForm.title = iv.title
  interviewEditForm.type = iv.type
  interviewEditForm.location = iv.location ?? ''
  interviewEditForm.notes = iv.notes ?? ''
  interviewEditForm.interviewers = iv.interviewers?.length ? [...iv.interviewers] : ['']
  interviewEditErrors.value = {}
}

function cancelInterviewEdit() {
  editingInterviewId.value = null
  interviewEditErrors.value = {}
}

function addEditInterviewer() {
  interviewEditForm.interviewers.push('')
}

function removeEditInterviewer(idx: number) {
  interviewEditForm.interviewers.splice(idx, 1)
}

async function saveInterviewEdit() {
  interviewEditErrors.value = {}
  if (!interviewEditForm.title.trim()) {
    interviewEditErrors.value.title = 'Title is required'
    return
  }

  isInterviewSaving.value = true
  try {
    const current = jobInterviews.value.find(item => item.id === editingInterviewId.value)
    const filteredInterviewers = interviewEditForm.interviewers.filter(i => i.trim())
    const result = await $fetch<InterviewMutationResult>(`/api/interviews/${editingInterviewId.value}`, {
      method: 'PATCH',
      body: {
        title: interviewEditForm.title.trim(),
        type: interviewEditForm.type,
        location: interviewEditForm.location.trim() || null,
        notes: interviewEditForm.notes.trim() || null,
        interviewers: filteredInterviewers.length > 0 ? filteredInterviewers : null,
      },
    })
    if (current && result.notification.intent) {
      reportCandidateUpdate(result, current.candidateEmail)
    }
    editingInterviewId.value = null
    await refreshJobInterviews()
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    interviewEditErrors.value.submit = err?.data?.statusMessage ?? 'Failed to save changes'
  } finally {
    isInterviewSaving.value = false
  }
}

const pendingInterviewStatus = ref<{
  interview: Interview
  status: Exclude<InterviewStatus, 'scheduled'>
} | null>(null)

function requestInterviewTransition(iv: Interview, newStatus: InterviewStatus) {
  if (newStatus === 'scheduled') {
    openReschedule(iv)
    return
  }
  pendingInterviewStatus.value = { interview: iv, status: newStatus }
}

async function handleInterviewTransition(iv: Interview, newStatus: InterviewStatus) {
  isInterviewTransitioning.value = true
  try {
    const result = await $fetch<InterviewMutationResult>(`/api/interviews/${iv.id}`, {
      method: 'PATCH',
      body: { status: newStatus },
    })
    pendingInterviewStatus.value = null
    reportStatus(newStatus, result, iv.candidateEmail)
    await refreshJobInterviews()
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to update status', { message: err?.data?.statusMessage, statusCode: err?.data?.statusCode })
  } finally {
    isInterviewTransitioning.value = false
  }
}

function openReschedule(iv: Interview) {
  interviewToReschedule.value = iv
  interviewTargetApplication.value = {
    id: iv.applicationId,
    name: formatPersonName(iv.candidateFirstName, iv.candidateLastName),
  }
  showInterviewSidebar.value = true
}

async function changeStatus(status: string) {
  if (!currentSummary.value || isMutating.value) return
  const applicationId = currentSummary.value.id
  const selectedIndex = currentIndex.value
  const nextApplicationId = filteredApplications.value[selectedIndex + 1]?.id
    ?? filteredApplications.value[selectedIndex - 1]?.id
    ?? null

  isMutating.value = true

  try {
    await $fetch(`/api/applications/${applicationId}`, {
      method: 'PATCH',
      body: { status },
    })

    track('pipeline_stage_changed', {
      from_stage: currentSummary.value.status,
      to_stage: status,
    })

    await refreshApps()

    // Move to the next visible candidate when the selected application leaves this stage.
    selectedApplicationId.value = nextApplicationId
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to update status', { message: err?.data?.statusMessage, statusCode: err?.data?.statusCode })
  } finally {
    isMutating.value = false
  }
}

async function goToPreviousCard() {
  if (currentIndex.value > 0) {
    currentIndex.value -= 1
    return
  }
  if (page.value > 1) {
    selectLastOnNextLoad.value = true
    page.value -= 1
  }
}

async function goToNextCard() {
  if (currentIndex.value < filteredApplications.value.length - 1) {
    currentIndex.value += 1
    return
  }
  if (page.value < totalPages.value) {
    selectLastOnNextLoad.value = false
    page.value += 1
  }
}

// ─────────────────────────────────────────────
// Fullscreen (focus) mode
// ─────────────────────────────────────────────
const isFullscreen = ref(false)
const isWideDetail = ref(false)
const detailWidthClass = computed(() => isWideDetail.value ? 'max-w-none' : 'max-w-4xl')
const pipelineContainer = useTemplateRef<HTMLElement>('pipelineContainer')
const teleportTarget = computed(() => isFullscreen.value && pipelineContainer.value ? pipelineContainer.value : 'body')

async function toggleFullscreen() {
  if (!isFullscreen.value) {
    isFullscreen.value = true
    await nextTick()
    pipelineContainer.value?.requestFullscreen?.()
  }
  else {
    isFullscreen.value = false
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
    }
  }
}

function onFullscreenChange() {
  if (!document.fullscreenElement) {
    isFullscreen.value = false
  }
}

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreenChange))

// ─────────────────────────────────────────────
// Detail tab overflow ("priority+" tab bar)
//
// Overview is pinned; the remaining tabs are shown inline as long as they fit
// the detail pane, and collapse into a "more" menu from the right when they
// don't. Widths come from an invisible ghost row that always renders the full
// tab set, so measuring never depends on what is currently visible.
// ─────────────────────────────────────────────
type OverflowTab = Exclude<DetailTab, 'overview'>

interface DetailTabDef {
  key: OverflowTab
  label: string
  icon?: Component
  count?: number
}

const detailTabDefs = computed<DetailTabDef[]>(() => {
  const defs: DetailTabDef[] = []
  defs.push({ key: 'inbox', label: 'Inbox', icon: Inbox })
  if (hasCoverLetter.value) {
    defs.push({ key: 'cover-letter', label: 'Cover Letter', icon: FileText })
  }
  defs.push({ key: 'ai-analysis', label: 'AI Analysis' })
  defs.push({ key: 'interviews', label: 'Interviews', count: currentApplicationInterviews.value.length })
  defs.push({ key: 'documents', label: 'Documents', count: resolvedCurrentApplication.value?.candidate.documents?.length ?? 0 })
  defs.push({ key: 'responses', label: 'Responses', count: resolvedCurrentApplication.value?.responses?.length ?? 0 })
  defs.push({ key: 'notes', label: 'Notes', icon: StickyNote, count: notes.value.length })
  defs.push({ key: 'timeline', label: 'Timeline', icon: History })
  defs.push({ key: 'properties', label: 'Properties', icon: SlidersHorizontal })
  return defs
})

const tabBar = useTemplateRef<HTMLElement>('tabBar')
const tabGhost = useTemplateRef<HTMLElement>('tabGhost')
const tabOverflowRef = ref<HTMLElement | null>(null)
const showTabOverflowMenu = ref(false)
const visibleTabCount = ref(Number.POSITIVE_INFINITY)

const visibleTabs = computed(() => detailTabDefs.value.slice(0, visibleTabCount.value))
const overflowTabs = computed(() => detailTabDefs.value.slice(visibleTabCount.value))
const isOverflowTabActive = computed(() => overflowTabs.value.some(tab => tab.key === detailTab.value))

// Matches the `gap-1` between tab buttons.
const TAB_GAP_PX = 4

function recomputeTabOverflow() {
  const bar = tabBar.value
  const ghost = tabGhost.value
  if (!bar || !ghost) return

  const pinned = ghost.querySelector<HTMLElement>('[data-ghost-pinned]')
  const more = ghost.querySelector<HTMLElement>('[data-ghost-more]')
  const items = [...ghost.querySelectorAll<HTMLElement>('[data-ghost-tab]')]
  if (!pinned || !more || items.length !== detailTabDefs.value.length) return

  const widths = items.map(el => el.offsetWidth + TAB_GAP_PX)
  const available = bar.clientWidth - pinned.offsetWidth
  if (widths.reduce((sum, w) => sum + w, 0) <= available) {
    visibleTabCount.value = items.length
    return
  }

  const budget = available - (more.offsetWidth + TAB_GAP_PX)
  let used = 0
  let count = 0
  for (const width of widths) {
    if (used + width > budget) break
    used += width
    count++
  }
  visibleTabCount.value = count
}

function selectOverflowTab(key: OverflowTab) {
  detailTab.value = key
  showTabOverflowMenu.value = false
}

function handleTabOverflowClickOutside(event: MouseEvent) {
  if (tabOverflowRef.value && !tabOverflowRef.value.contains(event.target as Node)) {
    showTabOverflowMenu.value = false
  }
}

watch(showTabOverflowMenu, (val) => {
  if (val) {
    showOverviewDropdown.value = false
    setTimeout(() => document.addEventListener('click', handleTabOverflowClickOutside), 0)
  } else {
    document.removeEventListener('click', handleTabOverflowClickOutside)
  }
})

if (import.meta.client) {
  let tabResizeObserver: ResizeObserver | null = null

  // The ghost row is `w-max`, so observing it also catches label/count changes.
  watch([tabBar, tabGhost], ([bar, ghost]) => {
    tabResizeObserver?.disconnect()
    if (!bar || !ghost || typeof ResizeObserver === 'undefined') return
    tabResizeObserver ??= new ResizeObserver(() => recomputeTabOverflow())
    tabResizeObserver.observe(bar)
    tabResizeObserver.observe(ghost)
    recomputeTabOverflow()
  }, { flush: 'post' })

  onBeforeUnmount(() => {
    tabResizeObserver?.disconnect()
    document.removeEventListener('click', handleTabOverflowClickOutside)
  })
}

function goToPreviousStage() {
  const idx = PIPELINE_STATUSES.indexOf(focusStatus.value)
  if (idx > 0) {
    focusStatus.value = PIPELINE_STATUSES[idx - 1]!
  }
}

function goToNextStage() {
  const idx = PIPELINE_STATUSES.indexOf(focusStatus.value)
  if (idx < PIPELINE_STATUSES.length - 1) {
    focusStatus.value = PIPELINE_STATUSES[idx + 1]!
  }
}

function handleKeyNavigation(event: KeyboardEvent) {
  if (event.key === 'Escape' && showDocPreview.value) {
    closeDocPreview()
    return
  }

  // Trap Tab inside the document preview dialog while it is open.
  if (event.key === 'Tab' && showDocPreview.value) {
    const dialog = docPreviewDialog.value
    if (dialog) {
      const focusables = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])')
      if (focusables.length > 0) {
        const first = focusables[0]!
        const last = focusables[focusables.length - 1]!
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
  }

  const t = event.target as HTMLElement
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    goToPreviousCard()
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    goToNextCard()
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    goToPreviousStage()
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    goToNextStage()
  }

  // Number keys 1-9 trigger status transition buttons
  const num = parseInt(event.key)
  if (num >= 1 && num <= 9 && allowedTransitions.value.length >= num) {
    event.preventDefault()
    showStatusDropdown.value = false
    const targetStatus = allowedTransitions.value[num - 1]!
    if (targetStatus === 'interview') {
      openInterviewSchedulerForStatus()
    } else {
      changeStatus(targetStatus)
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyNavigation)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyNavigation)
})

// ─────────────────────────────────────────────
// Job status transitions (Publish, Close, etc.)
// ─────────────────────────────────────────────

const jobStatusBadgeClasses: Record<string, string> = {
  draft: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400',
  open: 'bg-success-50 dark:bg-success-950 text-success-700 dark:text-success-400',
  closed: 'bg-warning-50 dark:bg-warning-950 text-warning-700 dark:text-warning-400',
  archived: 'bg-surface-100 dark:bg-surface-800 text-surface-400',
}

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOverviewDropdownClickOutside)
  document.removeEventListener('click', handleStatusDropdownClickOutside)
})

/**
 * Only the very first load may swap the whole pipeline for a spinner. Later
 * fetches — search, sort, filters, changing stage — keep the previous list on
 * screen: tearing down the layout mid-request unmounts the search input and
 * steals focus on every keystroke.
 */
const isLoading = computed(() => {
  return (jobFetchStatus.value === 'pending' && !jobData.value)
    || (appFetchStatus.value === 'pending' && !appData.value)
})

/** Background refetch of the candidate list — shown inline, never as a full-page state. */
const isRefreshingApps = computed(() => appFetchStatus.value === 'pending' && !!appData.value)

// ─────────────────────────────────────────────
// Document preview
// ─────────────────────────────────────────────

const { getPreviewUrl } = useDocuments()

const showDocPreview = ref(false)
const docPreviewUrl = ref<string | null>(null)
const docPreviewFilename = ref('')
const docPreviewMimeType = ref('')
const docPreviewDocId = ref<string | null>(null)
const docPreviewDialog = ref<HTMLElement | null>(null)
const lastFocusedBeforePreview = ref<HTMLElement | null>(null)

const isDocPreviewPdf = computed(() => docPreviewMimeType.value === 'application/pdf')

function handleDocPreview(doc: SwipeDocument) {
  track('document_viewed', { document_type: doc.type, mime_type: doc.mimeType })
  if (doc.mimeType !== 'application/pdf') {
    // Non-PDFs: fall back to download
    window.open(`/api/documents/${doc.id}/download`, '_blank')
    return
  }
  docPreviewDocId.value = doc.id
  docPreviewFilename.value = doc.originalFilename
  docPreviewMimeType.value = doc.mimeType
  docPreviewUrl.value = getPreviewUrl(doc.id)
  showDocPreview.value = true
  lastFocusedBeforePreview.value = document.activeElement as HTMLElement | null
  nextTick(() => docPreviewDialog.value?.focus())
}

function closeDocPreview() {
  showDocPreview.value = false
  docPreviewUrl.value = null
  docPreviewFilename.value = ''
  docPreviewMimeType.value = ''
  docPreviewDocId.value = null
  lastFocusedBeforePreview.value?.focus()
}
</script>

<template>
  <div
    ref="pipelineContainer"
    :class="isFullscreen
      ? 'flex h-screen flex-col overflow-hidden bg-surface-50 dark:bg-surface-950'
      : 'absolute inset-0 flex flex-col overflow-hidden'"
  >
    <!-- Loading -->
    <div v-if="isLoading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="size-8 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin" />
      <p class="text-sm font-medium text-surface-400 dark:text-surface-500">Loading pipeline…</p>
    </div>

    <!-- Error -->
    <div
      v-else-if="(jobError && !jobData) || (appError && !appData)"
      class="m-6 rounded-xl border border-danger-200/80 bg-danger-50 p-5 text-sm text-danger-700 dark:border-danger-800/60 dark:bg-danger-950/40 dark:text-danger-300"
    >
      {{ jobError ? 'Job not found or failed to load.' : 'Failed to load applications.' }}
      <NuxtLink :to="$localePath('/dashboard')" class="ml-1 font-medium underline hover:no-underline">Back to Jobs</NuxtLink>
    </div>

    <template v-else-if="jobData">
      <!-- Quick actions teleported to sub-nav bar -->
      <JobSubNavActions :job-id="jobId" />

      <!-- Keyboard shortcut hints in sub-nav bar (pipeline-specific) -->
      <Teleport to="#job-sub-nav-actions">
        <div class="hidden sm:flex items-center gap-2 text-[10px] font-medium text-surface-400 dark:text-surface-500">
          <div class="flex items-center gap-1 rounded-md bg-surface-100/80 px-2 py-0.5 dark:bg-surface-800/60">
            <span class="font-mono text-[10px]">↑↓</span>
            <span>candidates</span>
          </div>
          <div class="flex items-center gap-1 rounded-md bg-surface-100/80 px-2 py-0.5 dark:bg-surface-800/60">
            <span class="font-mono text-[10px]">←→</span>
            <span>stages</span>
          </div>
          <div class="flex items-center gap-1 rounded-md bg-surface-100/80 px-2 py-0.5 dark:bg-surface-800/60">
            <span class="font-mono text-[10px]">1-9</span>
            <span>actions</span>
          </div>
        </div>
      </Teleport>

      <!-- ═══════════════════════════════════════ -->
      <!-- PIPELINE STATUS TABS                     -->
      <!-- ═══════════════════════════════════════ -->
      <div class="shrink-0 border-b border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900">
        <div role="tablist" aria-label="Pipeline stages" class="flex items-center gap-1 overflow-x-auto scrollbar-thin sm:scrollbar-none px-3 sm:px-5 py-2">
          <button
            v-for="status in PIPELINE_STATUSES"
            :key="`tab-${status}`"
            role="tab"
            :aria-selected="isFocusStatus(status)"
            :tabindex="isFocusStatus(status) ? 0 : -1"
            class="relative flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            :class="isFocusStatus(status)
              ? 'bg-brand-50 text-brand-700 shadow-sm ring-1 ring-brand-200/60 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-800/40'
              : 'text-surface-500 hover:bg-surface-50 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-800/60 dark:hover:text-surface-200'"
            @click="setFocusStatus(status)"
          >
            <span class="pipeline-status-dot size-2 rounded-full" :class="{
              'bg-blue-500 dark:bg-blue-400': status === 'new',
              'bg-violet-500 dark:bg-violet-400': status === 'screening',
              'bg-amber-500 dark:bg-amber-400': status === 'interview',
              'bg-teal-500 dark:bg-teal-400': status === 'offer',
              'bg-green-600 dark:bg-green-300': status === 'hired',
              'bg-surface-400 dark:bg-surface-500': status === 'rejected',
            }" />
            {{ formatStatusLabel(status) }}
            <span
              class="inline-flex min-w-[20px] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors duration-200"
              :class="isFocusStatus(status)
                ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300'
                : 'bg-surface-100 text-surface-500 dark:bg-surface-800/80 dark:text-surface-400'"
            >
              {{ statusCounts[status] ?? 0 }}
            </span>
          </button>

          <!-- Fullscreen toggle -->
          <button
            class="ml-auto flex shrink-0 cursor-pointer items-center justify-center rounded-lg p-2 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-300 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            :title="isFullscreen ? 'Exit focus mode (Esc)' : 'Focus mode'"
            :aria-label="isFullscreen ? 'Exit focus mode' : 'Focus mode'"
            @click="toggleFullscreen"
          >
            <Minimize2 v-if="isFullscreen" class="size-4" />
            <Maximize2 v-else class="size-4" />
          </button>
        </div>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- THREE-PANEL LAYOUT                       -->
      <!-- ═══════════════════════════════════════ -->
      <div class="flex flex-1 min-h-0 overflow-hidden">

        <!-- LEFT PANEL — Candidate list (desktop only; mobile uses bottom bar) -->
        <div
          class="hidden md:flex md:w-72 md:shrink-0 flex-col border-r border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900"
        >
          <!-- Search + Sort + Filter controls -->
          <div class="shrink-0 px-3.5 pt-3 pb-2 space-y-2 dark:border-surface-800">
            <!-- Search input -->
            <div class="relative">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-surface-400 dark:text-surface-500" />
              <input
                v-model="searchTerm"
                type="text"
                aria-label="Search candidates"
                placeholder="Search candidates…"
                class="w-full rounded-lg border border-surface-200/80 bg-surface-50/80 py-2 pl-8 pr-3 text-sm text-surface-900 placeholder:text-surface-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-surface-700/80 dark:bg-surface-800/60 dark:text-surface-100 dark:placeholder:text-surface-500 dark:focus:border-brand-500 dark:focus:ring-brand-500/20 transition-all duration-150"
                @focus="closePanels"
              />
            </div>

            <!-- Sort & Filter row -->
            <div class="flex items-center gap-1.5">
              <!-- Sort dropdown -->
              <div class="relative flex-1 min-w-0">
                <button
                  class="flex w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-all duration-150"
                  aria-haspopup="true"
                  :aria-expanded="showSortPanel"
                  :class="showSortPanel
                    ? 'border-brand-300 bg-brand-50/50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/30 dark:text-brand-300'
                    : 'border-surface-200/80 bg-surface-50/50 text-surface-600 hover:border-surface-300 hover:bg-surface-50 dark:border-surface-700/80 dark:bg-surface-800/40 dark:text-surface-300 dark:hover:border-surface-600 dark:hover:bg-surface-800'"
                  @click="showSortPanel = !showSortPanel; showFilterPanel = false"
                >
                  <ArrowUpDown class="size-3 shrink-0" />
                  <span class="truncate text-[11px] font-medium">{{ currentSortLabel }}</span>
                  <ChevronDown class="ml-auto size-3 shrink-0 transition-transform duration-150" :class="showSortPanel ? 'rotate-180' : ''" />
                </button>

                <!-- Sort dropdown panel -->
                <Transition
                  enter-active-class="transition duration-150 ease-out"
                  enter-from-class="opacity-0 scale-95 -translate-y-1"
                  enter-to-class="opacity-100 scale-100 translate-y-0"
                  leave-active-class="transition duration-100 ease-in"
                  leave-from-class="opacity-100 scale-100 translate-y-0"
                  leave-to-class="opacity-0 scale-95 -translate-y-1"
                >
                  <div
                    v-if="showSortPanel"
                    class="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-surface-200 bg-white py-1 shadow-lg shadow-surface-900/5 dark:border-surface-700 dark:bg-surface-900 dark:shadow-black/20 origin-top"
                  >
                    <button
                      v-for="option in sortOptions"
                      :key="option.value"
                      class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] font-medium transition-colors"
                      :class="sortBy === option.value
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                        : 'text-surface-600 hover:bg-surface-50 dark:text-surface-300 dark:hover:bg-surface-800'"
                      @click="selectSort(option.value)"
                    >
                      <Check v-if="sortBy === option.value" class="size-3 shrink-0" />
                      <span v-else class="size-3 shrink-0" />
                      {{ option.label }}
                    </button>
                  </div>
                </Transition>
              </div>

              <!-- Filter button -->
              <button
                class="relative flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 transition-all duration-150"
                aria-label="Filters"
                aria-haspopup="true"
                :aria-expanded="showFilterPanel"
                :class="showFilterPanel || hasActiveFilters
                  ? 'border-brand-300 bg-brand-50/50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/30 dark:text-brand-300'
                  : 'border-surface-200/80 bg-surface-50/50 text-surface-600 hover:border-surface-300 hover:bg-surface-50 dark:border-surface-700/80 dark:bg-surface-800/40 dark:text-surface-300 dark:hover:border-surface-600 dark:hover:bg-surface-800'"
                @click="showFilterPanel = !showFilterPanel; showSortPanel = false"
              >
                <ListFilter class="size-3" />
                <span
                  v-if="activeFilterCount > 0"
                  class="flex size-3.5 items-center justify-center rounded-full bg-brand-600 text-[9px] font-bold text-white dark:bg-brand-500"
                >
                  {{ activeFilterCount }}
                </span>
              </button>
            </div>

            <!-- Filter panel -->
            <Transition
              enter-active-class="transition duration-150 ease-out"
              enter-from-class="opacity-0 -translate-y-1"
              enter-to-class="opacity-100 translate-y-0"
              leave-active-class="transition duration-100 ease-in"
              leave-from-class="opacity-100 translate-y-0"
              leave-to-class="opacity-0 -translate-y-1"
            >
              <div
                v-if="showFilterPanel"
                class="rounded-lg border border-surface-200/80 bg-surface-50/80 p-2.5 space-y-2.5 dark:border-surface-700/80 dark:bg-surface-800/40"
              >
                <!-- Score filter -->
                <div>
                  <p class="text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1">Score</p>
                  <div class="flex flex-wrap gap-1">
                    <button
                      v-for="opt in scoreFilterOptions"
                      :key="opt.value"
                      class="cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-150"
                      :class="scoreFilter === opt.value
                        ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                        : 'bg-white text-surface-600 ring-1 ring-inset ring-surface-200 hover:bg-surface-50 dark:bg-surface-800 dark:text-surface-300 dark:ring-surface-700 dark:hover:bg-surface-700'"
                      @click="scoreFilter = opt.value"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>

                <!-- Interview filter -->
                <div>
                  <p class="text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1">Interview</p>
                  <div class="flex flex-wrap gap-1">
                    <button
                      v-for="opt in interviewFilterOptions"
                      :key="opt.value"
                      class="cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-150"
                      :class="interviewFilter === opt.value
                        ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                        : 'bg-white text-surface-600 ring-1 ring-inset ring-surface-200 hover:bg-surface-50 dark:bg-surface-800 dark:text-surface-300 dark:ring-surface-700 dark:hover:bg-surface-700'"
                      @click="interviewFilter = opt.value"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>

                <!-- Property filters -->
                <div>
                  <p class="text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">Properties</p>
                  <PropertyFilterBar
                    v-model="propertyFilters"
                    entity-type="application"
                    :job-id="jobId"
                  />
                </div>

                <!-- Clear filters -->
                <button
                  v-if="hasActiveFilters"
                  class="flex w-full cursor-pointer items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200 transition-colors"
                  @click="clearFilters"
                >
                  <X class="size-3" />
                  Clear filters
                </button>
              </div>
            </Transition>
          </div>

          <!-- Count bar -->
          <div class="shrink-0 px-3.5 pb-2 flex items-center justify-between">
            <span class="flex min-w-0 items-center gap-1.5 text-xs font-medium text-surface-500 dark:text-surface-400">
              <span class="truncate">
                Showing {{ pageStart }}-{{ pageEnd }} of {{ focusedApplicationTotal }} candidate{{ focusedApplicationTotal === 1 ? '' : 's' }}
                <span v-if="searchTerm.trim() || hasActiveFilters" class="text-surface-400 dark:text-surface-500">
                  {{ hasActiveFilters ? ' filtered' : ' matching' }}
                </span>
              </span>
              <span
                v-if="isRefreshingApps"
                class="size-3 shrink-0 rounded-full border border-surface-300 border-t-brand-500 animate-spin dark:border-surface-600 dark:border-t-brand-400"
              />
            </span>
            <div v-if="totalPages > 1" class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                class="inline-flex size-6 items-center justify-center rounded-md text-surface-500 hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-surface-400 dark:hover:bg-surface-800"
                :disabled="page <= 1"
                aria-label="Previous page"
                title="Previous page"
                @click="page--"
              >
                <ChevronLeft class="size-3.5" />
              </button>
              <span class="text-[10px] tabular-nums text-surface-400 dark:text-surface-500">{{ page }}/{{ totalPages }}</span>
              <button
                type="button"
                class="inline-flex size-6 items-center justify-center rounded-md text-surface-500 hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-surface-400 dark:hover:bg-surface-800"
                :disabled="page >= totalPages"
                aria-label="Next page"
                title="Next page"
                @click="page++"
              >
                <ChevronRight class="size-3.5" />
              </button>
            </div>
          </div>

          <!-- Scrollable list -->
          <div
            ref="sidebarList"
            class="flex-1 overflow-y-auto scrollbar-thin border-t border-surface-100 transition-opacity duration-150 dark:border-surface-800/60"
            :class="isRefreshingApps ? 'opacity-60' : 'opacity-100'"
          >
            <div v-if="filteredApplications.length === 0" class="p-8 text-center">
              <div class="flex size-12 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                <UserRound class="size-5 text-surface-400 dark:text-surface-500" />
              </div>
              <p class="text-sm font-medium text-surface-600 dark:text-surface-300">
                {{ (searchTerm.trim() || hasActiveFilters) ? 'No matching candidates' : `No candidates yet` }}
              </p>
              <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">
                {{ (searchTerm.trim() || hasActiveFilters) ? 'Try adjusting your search or filters.' : `No one in ${formatStatusLabel(focusStatus)} stage.` }}
              </p>
              <NuxtLink
                v-if="hasNoApplicantsAtAll && !searchTerm.trim() && !hasActiveFilters"
                :to="localePath(`/dashboard/jobs/${jobId}/promote`)"
                class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white no-underline transition-colors hover:bg-brand-700"
              >
                <Megaphone class="size-3.5" />
                Promote this job
              </NuxtLink>
              <button
                v-if="hasActiveFilters"
                class="mt-2 cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                @click="clearFilters"
              >
                Clear filters
              </button>
            </div>

            <button
              v-for="(app, idx) in filteredApplications"
              :key="app.id"
              :data-candidate-idx="idx"
              :aria-current="currentIndex === idx ? 'true' : undefined"
              class="pipeline-candidate-card group flex w-full cursor-pointer items-start gap-3 px-3.5 py-3 text-left transition-all duration-150"
              :class="currentIndex === idx
                ? 'bg-brand-50/70 dark:bg-brand-950/20 border-l-[3px] border-l-brand-500 dark:border-l-brand-400'
                : 'border-l-[3px] border-l-transparent hover:bg-surface-50/80 dark:hover:bg-surface-800/40'"
              @click="selectCandidate(idx)"
            >
              <div
                class="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-150"
                :class="currentIndex === idx
                  ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/20 dark:bg-brand-600 dark:shadow-brand-500/10'
                  : 'bg-surface-100 text-surface-600 group-hover:bg-brand-100 group-hover:text-brand-700 dark:bg-surface-800 dark:text-surface-300 dark:group-hover:bg-brand-950 dark:group-hover:text-brand-300'"
              >
                {{ getCandidateInitials(app.candidateFirstName, app.candidateLastName) }}
              </div>
              <div class="min-w-0 flex-1">
                <p
                  class="flex items-center gap-1.5 truncate text-sm text-surface-900 dark:text-surface-100"
                  :class="isViewed(app) ? 'font-medium' : 'font-semibold'"
                >
                  <!-- Unread-mail convention: the dot marks applicants this
                       recruiter has never opened. -->
                  <span
                    v-if="!isViewed(app)"
                    aria-hidden="true"
                    class="size-1.5 shrink-0 rounded-full bg-brand-500 dark:bg-brand-400"
                  />
                  <span v-if="!isViewed(app)" class="sr-only">unviewed</span>
                  <span class="truncate">{{ formatPersonName(app.candidateFirstName, app.candidateLastName) }}</span>
                </p>
                <p class="mt-0.5 block truncate text-xs text-surface-500 dark:text-surface-400">{{ app.candidateEmail }}</p>
                <div class="mt-1.5 flex items-center gap-2">
                  <span
                    v-if="app.score != null"
                    class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset"
                    :class="{
                      'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950/60 dark:text-success-400 dark:ring-success-800': app.score >= 75,
                      'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-950/60 dark:text-warning-400 dark:ring-warning-800': app.score >= 40 && app.score < 75,
                      'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950/60 dark:text-danger-400 dark:ring-danger-800': app.score < 40,
                    }"
                  >
                    {{ app.score }} pts
                  </span>
                  <span class="text-[11px] text-surface-400 dark:text-surface-500">{{ timeAgo(app.createdAt) }}</span>
                  <span v-if="applicationsWithInterviews.has(app.id)" class="inline-flex items-center text-warning-500 dark:text-warning-400" title="Interview scheduled">
                    <Calendar class="size-3" />
                  </span>
                </div>
              </div>
            </button>
          </div>
        </div>

        <!-- CENTER PANEL — Candidate detail -->
        <div
          class="flex flex-1 flex-col overflow-hidden"
        >

          <!-- Empty state -->
          <div
            v-if="!currentSummary"
            class="flex flex-1 flex-col items-center justify-center p-8 text-center"
          >
            <div class="flex size-16 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800/60 mb-4">
              <UserRound class="size-7 text-surface-400 dark:text-surface-500" />
            </div>
            <p class="text-base font-semibold text-surface-700 dark:text-surface-200">
              {{ hasNoApplicantsAtAll ? 'No applicants yet' : `No candidates in ${formatStatusLabel(focusStatus)}` }}
            </p>
            <p class="mt-1.5 text-sm text-surface-500 dark:text-surface-400 max-w-xs">
              {{ hasNoApplicantsAtAll
                ? 'This role is live. Share it to start getting applicants.'
                : 'Switch to another pipeline stage to review candidates.' }}
            </p>
            <NuxtLink
              v-if="hasNoApplicantsAtAll"
              :to="localePath(`/dashboard/jobs/${jobId}/promote`)"
              class="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white no-underline transition-colors hover:bg-brand-700"
            >
              <Megaphone class="size-4" />
              Promote this job
            </NuxtLink>
          </div>

          <template v-else>
            <!-- Scrollable container: header + tabs + content -->
            <div
              ref="detailScrollContainer"
              class="min-h-0 flex-1 scrollbar-thin pb-20 md:pb-0"
              :class="detailTab === 'inbox' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'"
            >

            <!-- Candidate header -->
            <div class="shrink-0 border-b border-surface-200 bg-white px-4 sm:px-6 py-3 sm:py-4 dark:border-surface-800 dark:bg-surface-900">
              <div class="mx-auto" :class="detailWidthClass">
                <div class="flex items-start gap-4">
                  <div class="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-lg font-bold text-white shadow-lg shadow-brand-500/20 dark:from-brand-500 dark:to-brand-700 dark:shadow-brand-500/10">
                    {{ getCandidateInitials(currentSummary.candidateFirstName, currentSummary.candidateLastName) }}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div class="flex min-w-0 flex-wrap items-center gap-2.5">
                        <h2 class="truncate text-xl font-semibold tracking-tight text-surface-900 dark:text-surface-50">
                          {{ formatPersonName(currentSummary.candidateFirstName, currentSummary.candidateLastName) }}
                        </h2>
                        <span
                          class="inline-flex shrink-0 items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset"
                          :class="{
                            'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:ring-blue-800': currentSummary.status === 'new',
                            'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:ring-violet-800': currentSummary.status === 'screening',
                            'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:ring-amber-800': currentSummary.status === 'interview',
                            'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/50 dark:text-teal-400 dark:ring-teal-800': currentSummary.status === 'offer',
                            'bg-green-50 text-green-700 ring-green-200 dark:bg-green-950/50 dark:text-green-400 dark:ring-green-800': currentSummary.status === 'hired',
                            'bg-surface-100 text-surface-500 ring-surface-200 dark:bg-surface-800/50 dark:text-surface-400 dark:ring-surface-700': currentSummary.status === 'rejected',
                          }"
                        >
                          {{ currentSummary.status }}
                        </span>
                        <span
                          v-if="resolvedCurrentApplication?.autoRule"
                          class="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 ring-1 ring-inset ring-brand-200 dark:bg-brand-950/50 dark:text-brand-400 dark:ring-brand-800"
                          :title="`Status set automatically by rule “${resolvedCurrentApplication.autoRule.ruleName}”`"
                        >
                          <Zap class="size-2.5" />
                          Auto
                        </span>
                        <div v-if="allowedTransitions.length > 0" ref="statusDropdownRef" class="relative inline-flex">
                          <button
                            type="button"
                            :disabled="isMutating"
                            class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-surface-300 bg-white px-2 py-1 text-[11px] font-semibold text-surface-600 shadow-sm transition-colors hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
                            @click="showStatusDropdown = !showStatusDropdown"
                          >
                            Change status
                            <ChevronDown class="size-3" :class="{ 'rotate-180': showStatusDropdown }" />
                          </button>
                          <div
                            v-if="showStatusDropdown"
                            class="absolute left-0 top-full z-30 mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-surface-200 bg-white py-1 shadow-xl dark:border-surface-700 dark:bg-surface-800"
                          >
                            <button
                              v-for="(nextStatus, idx) in allowedTransitions"
                              :key="nextStatus"
                              type="button"
                              class="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm font-medium text-surface-700 transition-colors hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-700/60"
                              @click="handleStatusOptionClick(nextStatus)"
                            >
                              <span class="size-2 shrink-0 rounded-full" :class="statusDotClasses[nextStatus] ?? 'bg-surface-400'" />
                              {{ transitionLabels[nextStatus] ?? nextStatus }}
                              <kbd class="ml-auto inline-flex items-center justify-center rounded bg-surface-100 px-1 py-0.5 font-mono text-[10px] leading-none text-surface-400 dark:bg-surface-700 dark:text-surface-400">{{ idx + 1 }}</kbd>
                            </button>
                          </div>
                        </div>
                        <span
                          v-if="currentSummary.score != null"
                          class="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset"
                          :class="{
                            'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950/60 dark:text-success-400 dark:ring-success-800': currentSummary.score >= 75,
                            'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-950/60 dark:text-warning-400 dark:ring-warning-800': currentSummary.score >= 40 && currentSummary.score < 75,
                            'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950/60 dark:text-danger-400 dark:ring-danger-800': currentSummary.score < 40,
                          }"
                        >
                          {{ currentSummary.score }} pts
                        </span>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <div class="mr-2 flex items-center gap-1.5">
                          <button
                            :disabled="currentIndex <= 0 && page <= 1"
                            class="flex cursor-pointer items-center justify-center rounded-lg border border-surface-200 p-1.5 text-surface-500 transition-all duration-150 hover:border-surface-300 hover:bg-white hover:text-surface-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-surface-700 dark:text-surface-400 dark:hover:border-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
                            aria-label="Previous candidate"
                            @click="goToPreviousCard"
                          >
                            <ArrowLeft class="size-4" />
                          </button>
                          <span class="px-0.5 text-xs font-medium tabular-nums text-surface-500 dark:text-surface-400">
                            {{ pageStart + currentIndex }}/{{ focusedApplicationTotal }}
                          </span>
                          <button
                            :disabled="currentIndex >= filteredApplications.length - 1 && page >= totalPages"
                            class="flex cursor-pointer items-center justify-center rounded-lg border border-surface-200 p-1.5 text-surface-500 transition-all duration-150 hover:border-surface-300 hover:bg-white hover:text-surface-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-surface-700 dark:text-surface-400 dark:hover:border-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
                            aria-label="Next candidate"
                            @click="goToNextCard"
                          >
                            <ArrowRight class="size-4" />
                          </button>
                        </div>
                        <button
                          class="hidden cursor-pointer items-center justify-center rounded-lg border border-surface-200 p-1.5 text-surface-500 transition-all duration-150 hover:border-surface-300 hover:bg-white hover:text-surface-700 dark:border-surface-700 dark:text-surface-400 dark:hover:border-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300 lg:flex"
                          :aria-pressed="isWideDetail"
                          :aria-label="isWideDetail ? 'Use centered width' : 'Use full width'"
                          :title="isWideDetail ? 'Use centered width' : 'Use full width'"
                          @click="isWideDetail = !isWideDetail"
                        >
                          <FoldHorizontal v-if="isWideDetail" class="size-4" />
                          <UnfoldHorizontal v-else class="size-4" />
                        </button>
                        <NuxtLink
                          :to="$localePath(`/dashboard/applications/${currentSummary.id}`)"
                          class="flex items-center justify-center rounded-lg border border-surface-200 p-1.5 text-surface-500 transition-all duration-150 hover:border-surface-300 hover:bg-white hover:text-surface-700 dark:border-surface-700 dark:text-surface-400 dark:hover:border-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
                          aria-label="Open full application page"
                          title="Full application page"
                        >
                          <ExternalLink class="size-4" />
                        </NuxtLink>
                      </div>
                    </div>
                    <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-surface-500 dark:text-surface-400">
                      <a
                        :href="`mailto:${currentSummary.candidateEmail}`"
                        target="_blank"
                        class="inline-flex items-center gap-1.5 hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
                      >
                        <Mail class="size-3.5" />
                        {{ currentSummary.candidateEmail }}
                      </a>
                      <span v-if="resolvedCurrentApplication?.candidate.phone" class="inline-flex items-center gap-1.5">
                        <Phone class="size-3.5" />
                        {{ resolvedCurrentApplication.candidate.phone }}
                      </span>
                      <TimelineDateLink :date="currentSummary.createdAt" class="inline-flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500">
                        <Clock class="size-3" />
                        Applied {{ new Date(currentSummary.createdAt).toLocaleDateString() }}
                      </TimelineDateLink>
                      <span v-if="currentSummary.updatedAt !== currentSummary.createdAt" class="inline-flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500">
                        · <TimelineDateLink :date="currentSummary.updatedAt">Updated {{ new Date(currentSummary.updatedAt).toLocaleDateString() }}</TimelineDateLink>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Detail tabs -->
            <div class="shrink-0 border-b border-surface-200/80 bg-white px-4 sm:px-6 py-1 dark:border-surface-800/60 dark:bg-surface-900">
              <div ref="tabBar" role="tablist" aria-label="Candidate detail" class="relative mx-auto flex items-center justify-center gap-0.5 whitespace-nowrap" :class="detailWidthClass">
                <div ref="overviewDropdownRef" class="relative shrink-0">
                  <div class="flex items-center rounded-md transition-colors duration-150" :class="detailTab === 'overview'
                    ? 'bg-brand-50 dark:bg-brand-500/15'
                    : 'hover:bg-surface-100 dark:hover:bg-surface-800/60'">
                    <button
                      role="tab"
                      :aria-selected="detailTab === 'overview'"
                      :tabindex="detailTab === 'overview' ? 0 : -1"
                      class="cursor-pointer px-2.5 py-1 text-[13px] font-medium transition-colors duration-150"
                      :class="detailTab === 'overview'
                        ? 'text-brand-700 dark:text-brand-300'
                        : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'"
                      @click="detailTab = 'overview'"
                    >
                      Overview
                    </button>
                    <button
                      v-if="detailTab === 'overview'"
                      class="cursor-pointer -ml-1.5 pr-1.5 py-1 rounded transition-colors duration-150 text-brand-400 hover:text-brand-600 dark:text-brand-400/70 dark:hover:text-brand-300"
                      aria-label="Toggle overview sections"
                      aria-haspopup="true"
                      :aria-expanded="showOverviewDropdown"
                      @click.stop="showOverviewDropdown = !showOverviewDropdown"
                    >
                      <ChevronDown class="size-3.5 transition-transform duration-150" :class="showOverviewDropdown ? 'rotate-180' : ''" />
                    </button>
                  </div>

                  <!-- Overview sections dropdown -->
                  <Transition
                    enter-active-class="transition duration-150 ease-out"
                    enter-from-class="opacity-0 scale-95 -translate-y-1"
                    enter-to-class="opacity-100 scale-100 translate-y-0"
                    leave-active-class="transition duration-100 ease-in"
                    leave-from-class="opacity-100 scale-100 translate-y-0"
                    leave-to-class="opacity-0 scale-95 -translate-y-1"
                  >
                    <div
                      v-if="showOverviewDropdown"
                      class="absolute left-0 top-full z-50 mt-1 w-44 rounded-xl border border-surface-200 dark:border-surface-700/80 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/5 dark:shadow-black/20 py-1.5 origin-top-left"
                    >
                      <span class="block px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">Sections</span>
                      <label v-if="hasCoverLetter" class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.coverLetter" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        Cover Letter
                      </label>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.aiAnalysis" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        AI Analysis
                      </label>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.interviews" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        Interviews
                      </label>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.documents" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        Documents
                      </label>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.responses" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        Responses
                      </label>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.notes" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        Notes
                      </label>
                      <label class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/80 cursor-pointer select-none transition-colors">
                        <input v-model="overviewSections.properties" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-600 dark:bg-surface-800" />
                        Properties
                      </label>
                    </div>
                  </Transition>
                </div>
                <!-- Tabs that fit the current pane width -->
                <button
                  v-for="tab in visibleTabs"
                  :key="tab.key"
                  role="tab"
                  :aria-selected="detailTab === tab.key"
                  :tabindex="detailTab === tab.key ? 0 : -1"
                  class="shrink-0 cursor-pointer rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors duration-150 flex items-center gap-1.5"
                  :class="detailTab === tab.key
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'text-surface-500 hover:text-surface-700 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-300 dark:hover:bg-surface-800/60'"
                  @click="detailTab = tab.key"
                >
                  <component :is="tab.icon" v-if="tab.icon" class="size-3.5" />
                  {{ tab.label }}
                  <span v-if="tab.count" class="text-xs tabular-nums" :class="detailTab === tab.key ? 'text-brand-500/70 dark:text-brand-400/70' : 'text-surface-400'">
                    {{ tab.count }}
                  </span>
                </button>

                <!-- Tabs that don't fit -->
                <div v-if="overflowTabs.length > 0" ref="tabOverflowRef" class="relative ml-auto shrink-0">
                  <button
                    class="cursor-pointer rounded-md px-2 py-1 text-[13px] font-medium transition-colors duration-150 flex items-center gap-1"
                    :class="isOverflowTabActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                      : 'text-surface-500 hover:text-surface-700 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-300 dark:hover:bg-surface-800/60'"
                    :aria-expanded="showTabOverflowMenu"
                    aria-haspopup="menu"
                    aria-label="More tabs"
                    @click.stop="showTabOverflowMenu = !showTabOverflowMenu"
                  >
                    <MoreHorizontal class="size-4" />
                    <span class="text-xs tabular-nums">{{ overflowTabs.length }}</span>
                  </button>

                  <Transition
                    enter-active-class="transition duration-150 ease-out"
                    enter-from-class="opacity-0 scale-95 -translate-y-1"
                    enter-to-class="opacity-100 scale-100 translate-y-0"
                    leave-active-class="transition duration-100 ease-in"
                    leave-from-class="opacity-100 scale-100 translate-y-0"
                    leave-to-class="opacity-0 scale-95 -translate-y-1"
                  >
                    <div
                      v-if="showTabOverflowMenu"
                      class="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-surface-200 dark:border-surface-700/80 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/5 dark:shadow-black/20 py-1.5 origin-top-right"
                    >
                      <button
                        v-for="tab in overflowTabs"
                        :key="tab.key"
                        class="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm transition-colors cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/80"
                        :class="detailTab === tab.key
                          ? 'text-brand-700 dark:text-brand-300 font-medium'
                          : 'text-surface-700 dark:text-surface-300'"
                        @click="selectOverflowTab(tab.key)"
                      >
                        <component :is="tab.icon" v-if="tab.icon" class="size-3.5 shrink-0" />
                        <span v-else class="size-3.5 shrink-0" />
                        <span class="truncate">{{ tab.label }}</span>
                        <span v-if="tab.count" class="ml-auto text-xs text-surface-400 tabular-nums">
                          {{ tab.count }}
                        </span>
                      </button>
                    </div>
                  </Transition>
                </div>

                <!--
                  Invisible measurement row: always renders every tab (plus the
                  pinned Overview group and the overflow button) so widths stay
                  known regardless of what is currently collapsed.
                -->
                <div
                  ref="tabGhost"
                  aria-hidden="true"
                  class="pointer-events-none invisible absolute left-0 top-0 flex w-max gap-1"
                >
                  <div data-ghost-pinned class="flex items-center">
                    <span class="px-2.5 py-1 text-[13px] font-medium">Overview</span>
                    <span class="-ml-1.5 pr-1.5 py-1"><ChevronDown class="size-3.5" /></span>
                  </div>
                  <span
                    v-for="tab in detailTabDefs"
                    :key="tab.key"
                    data-ghost-tab
                    class="px-2.5 py-1 text-[13px] font-medium flex items-center gap-1.5"
                  >
                    <component :is="tab.icon" v-if="tab.icon" class="size-3.5" />
                    {{ tab.label }}
                    <span v-if="tab.count" class="text-xs tabular-nums">{{ tab.count }}</span>
                  </span>
                  <span data-ghost-more class="px-2 py-1 text-[13px] font-medium flex items-center gap-1">
                    <MoreHorizontal class="size-4" />
                    <span class="text-xs tabular-nums">{{ detailTabDefs.length }}</span>
                  </span>
                </div>
              </div>
            </div>

            <!-- Detail content -->
            <div
              class="bg-surface-50/80 px-4 transition-opacity duration-300 ease-out dark:bg-surface-950/80 sm:px-6"
              :class="[
                detailTab === 'inbox' ? 'flex min-h-0 flex-1 flex-col overflow-hidden py-4 sm:py-5' : 'py-5 sm:py-8',
                showDetailLoadingVeil ? 'pointer-events-none select-none opacity-50' : 'opacity-100',
              ]"
              :aria-busy="isDetailStale ? 'true' : undefined"
            >
              <div v-if="!resolvedCurrentApplication" class="space-y-5 mx-auto animate-pulse" :class="detailWidthClass" aria-label="Loading candidate details">
                <div class="h-28 rounded-xl border border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900" />
                <div class="h-40 rounded-xl border border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900" />
                <div class="h-32 rounded-xl border border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900" />
              </div>

              <template v-else>



              <!-- CANDIDATE INBOX -->
              <div v-if="detailTab === 'inbox'" class="mx-auto h-full min-h-0 min-w-0 w-full" :class="detailWidthClass">
                <CandidateMessagingPanel
                  :key="currentSummary.id"
                  :application-id="currentSummary.id"
                  :candidate-name="formatPersonName(currentSummary.candidateFirstName, currentSummary.candidateLastName)"
                  :candidate-email="currentSummary.candidateEmail"
                  :job-title="jobData?.title ?? ''"
                />
              </div>

              <!-- COVER LETTER SECTION -->
              <div v-if="showSection.coverLetter && hasCoverLetter" class="mx-auto" :class="[detailWidthClass, detailTab === 'overview' ? 'mt-5' : '']">
                <div class="rounded-xl border border-surface-200/80 bg-white p-4 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                  <div class="flex items-center gap-2.5 mb-4">
                    <div class="flex size-7 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950/40">
                      <FileText class="size-3.5 text-brand-600 dark:text-brand-400" />
                    </div>
                    <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">Cover letter</h3>
                  </div>
                  <p class="text-sm leading-relaxed text-surface-600 dark:text-surface-300 whitespace-pre-wrap">
                    {{ resolvedCurrentApplication?.coverLetterText }}
                  </p>
                </div>

              </div>

              <!-- AI SCORE BREAKDOWN -->
              <div v-if="showSection.aiAnalysis" class="space-y-3 mx-auto" :class="[detailWidthClass, detailTab === 'overview' ? 'mt-6' : '']">
                <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
                  <Brain class="size-4 text-surface-400 dark:text-surface-500" />
                  AI Analysis
                </h2>
                <ScoreBreakdown
                  v-if="currentSummary"
                  :application-id="currentSummary.id"
                  @scored="refreshApps()"
                />
              </div>

              <!-- INTERVIEWS SECTION -->
              <div v-if="showSection.interviews" ref="interviewsRef" class="space-y-3 mx-auto" :class="[detailWidthClass, detailTab === 'overview' ? 'mt-6' : '']">
                <div class="flex items-center justify-between mb-3">
                  <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2">
                    <Calendar class="size-4 text-surface-400 dark:text-surface-500" />
                    Interviews
                  </h2>
                  <button
                    class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700/80 px-2.5 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-white hover:border-surface-300 dark:hover:bg-surface-800 dark:hover:border-surface-600 transition-all duration-150"
                    @click="openInterviewScheduler"
                  >
                    <Plus class="size-3.5" />
                    Schedule Interview
                  </button>
                </div>

                <div v-if="currentApplicationInterviews.length > 0" class="space-y-3">
                  <div
                    v-for="iv in currentApplicationInterviews"
                    :key="iv.id"
                    class="rounded-xl border bg-white shadow-sm shadow-surface-900/[0.03] dark:bg-surface-900 dark:shadow-none transition-all duration-200"
                    :class="expandedInterviewId === iv.id
                      ? 'border-brand-300 dark:border-brand-700 shadow-md'
                      : 'border-surface-200/80 dark:border-surface-800/60 hover:border-surface-300 dark:hover:border-surface-700'"
                  >
                    <!-- Interview card header (always visible) -->
                    <button
                      class="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3 text-left"
                      :aria-expanded="expandedInterviewId === iv.id"
                      @click="toggleInterviewExpand(iv.id)"
                    >
                      <div class="flex items-center gap-3 min-w-0">
                        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950/40">
                          <component :is="interviewTypeIcons[iv.type] ?? Calendar" class="size-4 text-brand-600 dark:text-brand-400" />
                        </div>
                        <div class="min-w-0">
                          <p class="text-sm font-medium text-surface-800 dark:text-surface-100 truncate">
                            {{ iv.title }}
                          </p>
                          <p class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                            <TimelineDateLink :date="iv.scheduledAt">{{ formatInterviewDateTime(iv.scheduledAt) }}</TimelineDateLink> · {{ iv.duration }} min · {{ interviewTypeLabels[iv.type] ?? iv.type }}
                          </p>
                          <div v-if="iv.googleCalendarEventId" class="mt-1">
                            <a
                              v-if="iv.googleCalendarEventLink"
                              :href="iv.googleCalendarEventLink"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors"
                              @click.stop
                            >
                              <Calendar class="size-2.5" />
                              Google Calendar
                              <ExternalLink class="size-2" />
                            </a>
                            <span v-else class="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                              <Calendar class="size-2.5" />
                              Google Calendar
                            </span>
                          </div>
                        </div>
                      </div>
                      <div class="flex items-center gap-2.5 shrink-0">
                        <span
                          class="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset"
                          :class="interviewStatusClasses[iv.status] ?? 'bg-surface-100 text-surface-500 ring-surface-200'"
                        >
                          <component :is="interviewStatusIcons[iv.status as InterviewStatus] ?? Calendar" class="size-3" />
                          {{ iv.status === 'no_show' ? 'No Show' : iv.status }}
                        </span>
                        <ChevronDown
                          class="size-4 text-surface-400 transition-transform duration-200"
                          :class="{ 'rotate-180': expandedInterviewId === iv.id }"
                        />
                      </div>
                    </button>

                    <!-- Expanded interview detail -->
                    <div v-if="expandedInterviewId === iv.id" class="border-t border-surface-200/80 dark:border-surface-800/60">
                      <!-- Status transition buttons -->
                      <div v-if="getAllowedInterviewTransitions(iv.status).length > 0" class="px-5 pt-4 pb-2">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mr-1">Actions:</span>
                          <button
                            v-for="nextStatus in getAllowedInterviewTransitions(iv.status)"
                            :key="nextStatus"
                            :disabled="isInterviewTransitioning"
                            class="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                            :class="interviewTransitionClasses[nextStatus]"
                            @click.stop="requestInterviewTransition(iv, nextStatus)"
                          >
                            {{ nextStatus === 'cancelled' && iv.invitationSentAt
                              ? 'Cancel & notify'
                              : interviewTransitionLabels[nextStatus] }}
                          </button>
                          <button
                            v-if="iv.status === 'scheduled'"
                            type="button"
                            class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand-300 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-50 dark:border-brand-700 dark:text-brand-300 dark:hover:bg-brand-950/30"
                            @click.stop="openReschedule(iv)"
                          >
                            <Calendar class="size-3" />
                            Reschedule & notify
                          </button>
                        </div>
                      </div>

                      <!-- Interview details / edit form -->
                      <div class="px-5 py-4">
                        <!-- View mode -->
                        <template v-if="editingInterviewId !== iv.id">
                          <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                            <div>
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">Date & Time</dt>
                              <dd class="text-surface-800 dark:text-surface-200 font-medium text-[13px]">
                                <TimelineDateLink :date="iv.scheduledAt">{{ formatInterviewDateTimeFull(iv.scheduledAt) }}</TimelineDateLink>
                              </dd>
                            </div>
                            <div>
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">Duration</dt>
                              <dd class="text-surface-800 dark:text-surface-200 font-medium text-[13px] flex items-center gap-1.5">
                                <Clock class="size-3.5 text-surface-400" />
                                {{ iv.duration }} minutes
                              </dd>
                            </div>
                            <div>
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">Type</dt>
                              <dd class="text-surface-800 dark:text-surface-200 font-medium text-[13px] flex items-center gap-1.5">
                                <component :is="interviewTypeIcons[iv.type] ?? Calendar" class="size-3.5 text-surface-400" />
                                {{ interviewTypeLabels[iv.type] ?? iv.type }}
                              </dd>
                            </div>
                            <div v-if="iv.location">
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">Location</dt>
                              <dd class="text-surface-800 dark:text-surface-200 font-medium text-[13px] flex items-center gap-1.5">
                                <MapPin class="size-3.5 text-surface-400" />
                                {{ iv.location }}
                              </dd>
                            </div>
                            <div v-if="iv.interviewers?.length" class="col-span-2">
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">Interviewers</dt>
                              <dd class="text-surface-800 dark:text-surface-200 font-medium text-[13px] flex items-center gap-1.5">
                                <Users class="size-3.5 text-surface-400" />
                                {{ iv.interviewers.join(', ') }}
                              </dd>
                            </div>
                            <div v-if="iv.notes" class="col-span-2">
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">Notes</dt>
                              <dd class="text-surface-700 dark:text-surface-300 text-[13px] leading-relaxed whitespace-pre-wrap">
                                {{ iv.notes }}
                              </dd>
                            </div>
                            <div v-if="iv.googleCalendarEventId" class="col-span-2">
                              <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">Calendar Sync</dt>
                              <dd class="text-[13px]">
                                <a
                                  v-if="iv.googleCalendarEventLink"
                                  :href="iv.googleCalendarEventLink"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-emerald-700 dark:text-emerald-400 font-medium hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors"
                                >
                                  <Calendar class="size-3.5" />
                                  Open in Google Calendar
                                  <ExternalLink class="size-3" />
                                </a>
                                <span v-else class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-emerald-700 dark:text-emerald-400 font-medium">
                                  <Calendar class="size-3.5" />
                                  Synced to Google Calendar
                                </span>
                              </dd>
                            </div>
                          </dl>
                          <div class="flex items-center gap-3 mt-4 pt-3 border-t border-surface-100 dark:border-surface-800/60">
                            <button
                              class="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
                              @click.stop="startInterviewEdit(iv)"
                            >
                              <Pencil class="size-3" />
                              Edit Details
                            </button>
                            <NuxtLink
                              :to="$localePath(`/dashboard/interviews/${iv.id}`)"
                              class="inline-flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300 transition-colors"
                              @click.stop
                            >
                              <ExternalLink class="size-3" />
                              Full Page
                            </NuxtLink>
                          </div>
                        </template>

                        <!-- Edit mode -->
                        <template v-else>
                          <div class="space-y-3">
                            <div>
                              <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">Title</label>
                              <input
                                v-model="interviewEditForm.title"
                                type="text"
                                class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                                :class="interviewEditErrors.title ? 'border-danger-300 dark:border-danger-600' : 'border-surface-200 dark:border-surface-700'"
                                @click.stop
                              />
                              <p v-if="interviewEditErrors.title" class="mt-1 text-[11px] text-danger-600 dark:text-danger-400">{{ interviewEditErrors.title }}</p>
                            </div>

                            <div>
                              <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">Type</label>
                              <select
                                v-model="interviewEditForm.type"
                                class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                                @click.stop
                              >
                                <option value="video">Video Call</option>
                                <option value="phone">Phone</option>
                                <option value="in_person">In Person</option>
                                <option value="technical">Technical</option>
                                <option value="panel">Panel</option>
                                <option value="take_home">Take Home</option>
                              </select>
                            </div>

                            <div>
                              <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">Location / Link</label>
                              <input
                                v-model="interviewEditForm.location"
                                type="text"
                                placeholder="Zoom link, office address…"
                                class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                                @click.stop
                              />
                            </div>

                            <div>
                              <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">Notes</label>
                              <textarea
                                v-model="interviewEditForm.notes"
                                rows="3"
                                placeholder="Interview notes…"
                                class="w-full rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                                @click.stop
                              />
                            </div>

                            <div>
                              <label class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1.5">Interviewers</label>
                              <div class="space-y-2">
                                <div v-for="(_, idx) in interviewEditForm.interviewers" :key="idx" class="flex items-center gap-2">
                                  <input
                                    v-model="interviewEditForm.interviewers[idx]"
                                    type="text"
                                    placeholder="Name or email"
                                    class="flex-1 rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                                    @click.stop
                                  />
                                  <button
                                    v-if="interviewEditForm.interviewers.length > 1"
                                    class="cursor-pointer rounded-md p-1 text-surface-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-950/40 transition-colors"
                                    aria-label="Remove interviewer"
                                    @click.stop="removeEditInterviewer(idx)"
                                  >
                                    <X class="size-3.5" />
                                  </button>
                                </div>
                              </div>
                              <button
                                class="mt-2 inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
                                @click.stop="addEditInterviewer"
                              >
                                <Plus class="size-3" />
                                Add interviewer
                              </button>
                            </div>

                            <p v-if="interviewEditErrors.submit" class="text-xs text-danger-600 dark:text-danger-400">{{ interviewEditErrors.submit }}</p>

                            <p v-if="iv.invitationSentAt && iv.status === 'scheduled'" class="text-xs leading-5 text-surface-500 dark:text-surface-400">
                              Candidate-facing changes send an update to {{ iv.candidateEmail }}.
                            </p>

                            <div class="flex items-center justify-end gap-2 pt-2">
                              <button
                                class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                                @click.stop="cancelInterviewEdit"
                              >
                                Cancel
                              </button>
                              <button
                                :disabled="isInterviewSaving"
                                class="cursor-pointer rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                @click.stop="saveInterviewEdit"
                              >
                                {{ isInterviewSaving ? 'Saving…' : 'Save Changes' }}
                              </button>
                            </div>
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Empty state (compact in overview) -->
                <div v-else-if="detailTab === 'overview'" class="flex items-center gap-2.5 rounded-lg border border-dashed border-surface-200 px-3.5 py-2.5 dark:border-surface-800/70">
                  <Calendar class="size-4 shrink-0 text-surface-300 dark:text-surface-600" />
                  <p class="text-xs text-surface-400 dark:text-surface-500">No interviews scheduled yet.</p>
                </div>

                <!-- Empty state -->
                <div v-else class="rounded-xl border border-surface-200/80 bg-white px-6 py-9 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                  <div class="flex size-11 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                    <Calendar class="size-5 text-surface-400 dark:text-surface-500" />
                  </div>
                  <p class="text-sm font-medium text-surface-600 dark:text-surface-300">No interviews scheduled</p>
                  <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">Schedule an interview to start the process.</p>
                  <button
                    class="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700 transition-colors shadow-sm"
                    @click="openInterviewScheduler"
                  >
                    <Plus class="size-3.5" />
                    Schedule Interview
                  </button>
                </div>
              </div>

              <!-- DOCUMENTS SECTION -->
              <div v-if="showSection.documents" ref="documentsRef" class="space-y-3 mx-auto" :class="[detailWidthClass, detailTab === 'overview' ? 'mt-6' : '']">
                <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
                  <Paperclip class="size-4 text-surface-400 dark:text-surface-500" />
                  Documents
                </h2>
                <div v-if="resolvedCurrentApplication?.candidate.documents?.length" class="space-y-3">
                  <div
                    v-for="doc in resolvedCurrentApplication.candidate.documents"
                    :key="doc.id"
                    class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-200/80 bg-white px-4 py-3 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none transition-colors hover:border-surface-300 dark:hover:border-surface-700"
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-800/60">
                        <FileText class="size-4 text-surface-500 dark:text-surface-400" />
                      </div>
                      <div class="min-w-0">
                        <p class="text-sm font-medium text-surface-800 dark:text-surface-100 truncate">
                          {{ doc.originalFilename }}
                        </p>
                        <p class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                          {{ formatDocumentType(doc.type) }} · <TimelineDateLink :date="doc.createdAt">{{ new Date(doc.createdAt).toLocaleDateString() }}</TimelineDateLink>
                        </p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 hover:border-surface-300 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:border-surface-600 transition-all duration-150"
                        @click="handleDocPreview(doc)"
                      >
                        <Eye class="size-3.5" />
                        Preview
                      </button>
                      <a
                        :href="`/api/documents/${doc.id}/download`"
                        class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 hover:border-surface-300 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:border-surface-600 transition-all duration-150"
                      >
                        <Download class="size-3.5" />
                        Download
                      </a>
                    </div>
                  </div>
                </div>
                <div v-else-if="detailTab === 'overview'" class="flex items-center gap-2.5 rounded-lg border border-dashed border-surface-200 px-3.5 py-2.5 dark:border-surface-800/70">
                  <FileText class="size-4 shrink-0 text-surface-300 dark:text-surface-600" />
                  <p class="text-xs text-surface-400 dark:text-surface-500">No documents uploaded.</p>
                </div>
                <div v-else class="rounded-xl border border-surface-200/80 bg-white px-6 py-9 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                  <div class="flex size-11 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                    <FileText class="size-5 text-surface-400 dark:text-surface-500" />
                  </div>
                  <p class="text-sm font-medium text-surface-600 dark:text-surface-300">No documents uploaded</p>
                  <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">Documents will appear here once uploaded.</p>
                </div>
              </div>

              <!-- RESPONSES SECTION -->
              <div v-if="showSection.responses" ref="responsesRef" class="space-y-3 mx-auto" :class="[detailWidthClass, detailTab === 'overview' ? 'mt-6' : '']">
                <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
                  <MessageSquare class="size-4 text-surface-400 dark:text-surface-500" />
                  Responses
                </h2>                <template v-if="resolvedCurrentApplication?.responses?.length">
                  <div class="divide-y divide-surface-100 rounded-xl border border-surface-200/80 bg-white shadow-sm shadow-surface-900/[0.03] dark:divide-surface-800/60 dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                    <div
                      v-for="response in resolvedCurrentApplication.responses"
                      :key="response.id"
                      class="px-4 py-3"
                      :class="isRuleTriggerQuestion(response.question?.id) ? 'bg-brand-50/40 dark:bg-brand-950/20' : ''"
                    >
                      <div class="flex flex-wrap items-center gap-2 mb-1">
                        <p class="text-[11px] font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider">
                          {{ response.question?.label ?? 'Unknown question' }}
                        </p>
                        <span
                          v-if="isRuleTriggerQuestion(response.question?.id)"
                          class="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-brand-600 ring-1 ring-inset ring-brand-200 dark:bg-brand-950/50 dark:text-brand-400 dark:ring-brand-800"
                          :title="`This answer triggered the automation rule “${autoRule?.ruleName}”`"
                        >
                          <Zap class="size-2.5" />
                          Triggered “{{ autoRule?.ruleName }}”
                        </span>
                      </div>
                      <p class="text-sm text-surface-700 dark:text-surface-200 leading-relaxed">
                        {{ formatResponseValue(response.value) }}
                      </p>
                    </div>
                  </div>
                </template>
                <div v-else-if="detailTab === 'overview'" class="flex items-center gap-2.5 rounded-lg border border-dashed border-surface-200 px-3.5 py-2.5 dark:border-surface-800/70">
                  <MessageSquare class="size-4 shrink-0 text-surface-300 dark:text-surface-600" />
                  <p class="text-xs text-surface-400 dark:text-surface-500">No application form responses.</p>
                </div>
                <div v-else class="rounded-xl border border-surface-200/80 bg-white px-6 py-9 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                  <div class="flex size-11 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                    <MessageSquare class="size-5 text-surface-400 dark:text-surface-500" />
                  </div>
                  <p class="text-sm font-medium text-surface-600 dark:text-surface-300">No responses</p>
                  <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">Application form responses will appear here.</p>
                </div>
              </div>

              <!-- PROPERTIES SECTION -->
              <div v-if="showSection.properties && resolvedCurrentApplication" class="space-y-3 mx-auto" :class="[detailWidthClass, detailTab === 'overview' ? 'mt-6' : '']">
                <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
                  <SlidersHorizontal class="size-4 text-surface-400 dark:text-surface-500" />
                  Properties
                </h2>
                <div class="rounded-xl border border-surface-200/80 bg-white p-4 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                  <PropertyBlock
                    entity-type="application"
                    :entity-id="resolvedCurrentApplication.id"
                    :job-id="jobId"
                    :entries="resolvedCurrentApplication.properties ?? []"
                    @refresh="executeDetailFetch(); refreshApps()"
                  />
                </div>
              </div>

              <!-- NOTES SECTION -->
              <div v-if="showSection.notes" class="space-y-3 mx-auto" :class="[detailWidthClass, detailTab === 'overview' ? 'mt-6' : '']">
                <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
                  <StickyNote class="size-4 text-surface-400 dark:text-surface-500" />
                  Notes
                </h2>

                <!-- Composer -->
                <div v-if="canCreateNote" class="rounded-xl border border-surface-200/80 bg-white p-4 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
                  <textarea
                    v-model="noteDraft"
                    rows="3"
                    :maxlength="NOTE_MAX_LENGTH"
                    placeholder="Add a note about this candidate…"
                    class="w-full resize-y rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 placeholder:text-surface-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 dark:placeholder:text-surface-500"
                    @keydown.enter.meta.prevent="addNote"
                    @keydown.enter.ctrl.prevent="addNote"
                  />
                  <div class="mt-2 flex items-center justify-between gap-3">
                    <span class="text-[11px] text-surface-400 dark:text-surface-500">
                      Only your team can see notes. <kbd class="font-mono">⌘</kbd>+<kbd class="font-mono">Enter</kbd> to save.
                    </span>
                    <button
                      type="button"
                      class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-400"
                      :disabled="!noteDraft.trim() || isSavingNote"
                      @click="addNote"
                    >
                      <Plus class="size-3.5" />
                      {{ isSavingNote ? 'Saving…' : 'Add note' }}
                    </button>
                  </div>
                </div>

                <!-- Loading -->
                <div v-if="notesLoading" class="text-center py-12 text-surface-400">
                  <div class="size-6 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin mx-auto mb-3" />
                  <p class="text-sm">Loading notes…</p>
                </div>

                <!-- Error -->
                <div
                  v-else-if="notesError"
                  class="rounded-xl border border-danger-200 bg-danger-50/60 p-6 text-center dark:border-danger-900/60 dark:bg-danger-950/30"
                >
                  <AlertTriangle class="size-6 text-danger-400 mx-auto mb-2" />
                  <p class="text-sm text-danger-700 dark:text-danger-400">{{ notesError }}</p>
                  <button
                    type="button"
                    class="mt-3 cursor-pointer rounded-lg border border-danger-200 px-3 py-1.5 text-xs font-medium text-danger-700 transition-colors hover:bg-danger-100 dark:border-danger-800 dark:text-danger-400 dark:hover:bg-danger-950/60"
                    @click="loadNotes()"
                  >
                    Try again
                  </button>
                </div>

                <!-- Empty (compact in overview) -->
                <div
                  v-else-if="notes.length === 0 && detailTab === 'overview'"
                  class="flex items-center gap-2.5 rounded-lg border border-dashed border-surface-200 px-3.5 py-2.5 dark:border-surface-800/70"
                >
                  <StickyNote class="size-4 shrink-0 text-surface-300 dark:text-surface-600" />
                  <p class="text-xs text-surface-400 dark:text-surface-500">No notes yet.</p>
                </div>

                <!-- Empty -->
                <div
                  v-else-if="notes.length === 0"
                  class="rounded-xl border border-surface-200/80 bg-white px-6 py-9 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none"
                >
                  <div class="flex size-11 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                    <StickyNote class="size-5 text-surface-400 dark:text-surface-500" />
                  </div>
                  <p class="text-sm font-medium text-surface-600 dark:text-surface-300">No notes yet</p>
                  <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">Notes you and your team write about this candidate appear here.</p>
                </div>

                <!-- List -->
                <div v-else class="space-y-3">
                  <div
                    v-for="note in notes"
                    :key="note.id"
                    class="rounded-xl border border-surface-200/80 bg-white p-4 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="flex items-center gap-2.5 min-w-0">
                        <img
                          v-if="note.authorImage"
                          :src="note.authorImage"
                          :alt="noteAuthorLabel(note)"
                          class="size-7 shrink-0 rounded-full object-cover"
                        >
                        <div v-else class="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/40 dark:text-brand-400">
                          {{ noteAuthorLabel(note).charAt(0).toUpperCase() }}
                        </div>
                        <div class="min-w-0">
                          <p class="truncate text-[13px] font-medium text-surface-800 dark:text-surface-100">
                            {{ noteAuthorLabel(note) }}
                          </p>
                          <p class="text-[11px] text-surface-400 dark:text-surface-500">
                            <TimelineDateLink :date="note.createdAt">{{ timeAgo(note.createdAt) }}</TimelineDateLink>
                            <span v-if="note.updatedAt !== note.createdAt"> · edited</span>
                          </p>
                        </div>
                      </div>
                      <div v-if="editingNoteId !== note.id" class="flex shrink-0 items-center gap-1">
                        <button
                          v-if="canEditNote(note)"
                          type="button"
                          class="cursor-pointer rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
                          aria-label="Edit note"
                          title="Edit note"
                          @click="startEditNote(note)"
                        >
                          <Pencil class="size-3.5" />
                        </button>
                        <button
                          v-if="canRemoveNote(note)"
                          type="button"
                          class="cursor-pointer rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-danger-50 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-danger-950/40 dark:hover:text-danger-400"
                          :disabled="deletingNoteId === note.id"
                          aria-label="Delete note"
                          title="Delete note"
                          @click="deleteNote(note)"
                        >
                          <Trash2 class="size-3.5" />
                        </button>
                      </div>
                    </div>

                    <template v-if="editingNoteId === note.id">
                      <textarea
                        v-model="editingNoteBody"
                        rows="3"
                        :maxlength="NOTE_MAX_LENGTH"
                        class="mt-3 w-full resize-y rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
                        @keydown.enter.meta.prevent="saveNote"
                        @keydown.enter.ctrl.prevent="saveNote"
                        @keydown.esc="cancelEditNote"
                      />
                      <div class="mt-2 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          class="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-surface-500 transition-colors hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
                          @click="cancelEditNote"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-400"
                          :disabled="!editingNoteBody.trim() || isUpdatingNote"
                          @click="saveNote"
                        >
                          <Save class="size-3" />
                          {{ isUpdatingNote ? 'Saving…' : 'Save' }}
                        </button>
                      </div>
                    </template>
                    <p v-else class="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-surface-700 dark:text-surface-300">
                      {{ note.body }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- TIMELINE SECTION -->
              <div v-if="showSection.timeline" class="space-y-3 mx-auto" :class="detailWidthClass">
                <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
                  <History class="size-4 text-surface-400 dark:text-surface-500" />
                  Timeline
                </h2>

                <!-- Loading -->
                <div v-if="timelineLoading" class="text-center py-12 text-surface-400">
                  <div class="size-6 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin mx-auto mb-3" />
                  Loading timeline…
                </div>

                <!-- Error -->
                <div
                  v-else-if="timelineError"
                  class="rounded-xl border border-danger-200/80 dark:border-danger-800/60 bg-danger-50 dark:bg-danger-950/40 p-5 text-center"
                >
                  <AlertTriangle class="size-6 text-danger-400 mx-auto mb-2" />
                  <p class="text-sm text-danger-700 dark:text-danger-400">{{ timelineError }}</p>
                  <button
                    class="mt-3 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium cursor-pointer"
                    @click="loadTimeline"
                  >
                    Retry
                  </button>
                </div>

                <!-- Empty -->
                <div
                  v-else-if="timelineItems.length === 0"
                  class="rounded-xl border border-surface-200/80 bg-white px-6 py-9 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none"
                >
                  <div class="flex size-11 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
                    <History class="size-5 text-surface-400 dark:text-surface-500" />
                  </div>
                  <p class="text-sm font-medium text-surface-600 dark:text-surface-300">No activity recorded yet.</p>
                  <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">Activity for this candidate will appear here.</p>
                </div>

                <!-- Timeline list -->
                <div v-else>
                  <div
                    v-for="(item, index) in timelineItems"
                    :key="item.id"
                    class="group flex items-start gap-3 py-1.5 px-1 transition-colors duration-150 hover:bg-surface-50 dark:hover:bg-surface-800/40 rounded-lg"
                  >
                    <!-- Left column: icon + connector -->
                    <div class="flex flex-col items-center shrink-0">
                      <div class="flex items-center justify-center size-6 rounded shrink-0" :class="getTimelineActionStyle(item.action).bg">
                        <component :is="getTimelineActionStyle(item.action).icon" class="size-3" :class="getTimelineActionStyle(item.action).color" />
                      </div>
                      <div
                        v-if="index < timelineItems.length - 1"
                        class="w-px flex-1 min-h-[10px] bg-surface-200 dark:bg-surface-800 mt-0.5"
                      />
                    </div>

                      <!-- Content -->
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <span class="text-[13px] font-medium text-surface-900 dark:text-surface-100 shrink-0">{{ timelineActionLabels[item.action] ?? item.action }}</span>
                          <span class="text-[13px] text-surface-500 dark:text-surface-400">{{ item.resourceType }}</span>
                          <template v-if="item.action === 'status_changed' && item.metadata">
                            <span v-if="item.metadata.from_status || item.metadata.fromStatus" class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none" :class="getTimelineStatusBadge(String(item.metadata.from_status ?? item.metadata.fromStatus))">{{ item.metadata.from_status ?? item.metadata.fromStatus }}</span>
                            <ArrowRight class="size-2.5 text-surface-400 dark:text-surface-500 shrink-0" />
                            <span v-if="item.metadata.to_status || item.metadata.toStatus" class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none" :class="getTimelineStatusBadge(String(item.metadata.to_status ?? item.metadata.toStatus))">{{ item.metadata.to_status ?? item.metadata.toStatus }}</span>
                          </template>
                          <template v-else-if="item.action === 'scored' && item.metadata?.score">
                            <span class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none bg-accent-100 text-accent-700 dark:bg-accent-900/60 dark:text-accent-300">{{ item.metadata.score }} pts</span>
                          </template>
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                          <span v-if="item.actorName || item.actorEmail" class="text-[11px] text-surface-400 dark:text-surface-500">{{ item.actorName ?? item.actorEmail }}</span>
                          <span class="text-[11px] text-surface-400 dark:text-surface-500 tabular-nums">{{ formatTimelineDate(item.createdAt) }}</span>
                          <span
                            v-if="item.jobTitle"
                            class="text-[10px] text-surface-400 dark:text-surface-500 bg-surface-100 dark:bg-surface-800 rounded px-1.5 py-0.5 truncate max-w-[140px]"
                          >
                            {{ item.jobTitle }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </template>
            </div>
            </div>
          </template>
        </div>


      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- MOBILE BOTTOM CANDIDATE BAR              -->
      <!-- ═══════════════════════════════════════ -->
      <div
        v-if="filteredApplications.length > 0"
        class="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900"
        :style="{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }"
      >
        <!-- Horizontal scrollable candidate cards -->
        <div
          ref="mobileBottomBar"
          class="flex items-stretch gap-2 overflow-x-auto snap-x snap-mandatory px-3 py-2.5 scrollbar-thin"
        >
          <button
            v-for="(app, idx) in filteredApplications"
            :key="app.id"
            :data-candidate-idx="idx"
            class="snap-center shrink-0 flex items-center gap-2.5 rounded-xl px-3 py-2 min-w-[130px] max-w-[180px] transition-all duration-150 cursor-pointer"
            :class="currentIndex === idx
              ? 'bg-brand-50 ring-2 ring-brand-500 shadow-sm dark:bg-brand-950/30 dark:ring-brand-400'
              : 'bg-surface-50 ring-1 ring-surface-200 hover:ring-surface-300 dark:bg-surface-800/60 dark:ring-surface-700 dark:hover:ring-surface-600'"
            @click="currentIndex = idx"
          >
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors duration-150"
              :class="currentIndex === idx
                ? 'bg-brand-500 text-white dark:bg-brand-600'
                : 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300'"
            >
              {{ getCandidateInitials(app.candidateFirstName, app.candidateLastName) }}
            </div>
            <div class="min-w-0 text-left">
              <p
                class="flex items-center gap-1 text-xs text-surface-800 dark:text-surface-100 truncate"
                :class="isViewed(app) ? 'font-medium' : 'font-semibold'"
              >
                <span
                  v-if="!isViewed(app)"
                  aria-hidden="true"
                  class="size-1.5 shrink-0 rounded-full bg-brand-500 dark:bg-brand-400"
                />
                <span v-if="!isViewed(app)" class="sr-only">unviewed</span>
                <span class="truncate">{{ app.candidateFirstName }}</span>
              </p>
              <div class="flex items-center gap-1 mt-0.5">
                <span
                  v-if="app.score != null"
                  class="text-[10px] font-semibold"
                  :class="{
                    'text-success-600 dark:text-success-400': app.score >= 75,
                    'text-warning-600 dark:text-warning-400': app.score >= 40 && app.score < 75,
                    'text-danger-600 dark:text-danger-400': app.score < 40,
                  }"
                >
                  {{ app.score }}pts
                </span>
                <span class="text-[10px] text-surface-400 dark:text-surface-500">{{ timeAgo(app.createdAt) }}</span>
              </div>
            </div>
          </button>
        </div>
        <!-- Position indicator -->
        <div class="flex items-center justify-center pb-1.5">
          <span class="text-[10px] font-medium text-surface-400 dark:text-surface-500 tabular-nums">
            {{ pageStart + currentIndex }} / {{ focusedApplicationTotal }}
          </span>
        </div>
      </div>

      <!-- Mobile empty state for bottom bar -->
      <div
        v-else-if="focusedApplicationTotal === 0"
        class="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900 px-4 py-3 text-center"
        :style="{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }"
      >
        <p class="text-xs text-surface-400 dark:text-surface-500">
          No candidates in {{ formatStatusLabel(focusStatus) }}
        </p>
      </div>
    </template>

    <!-- ═══════════════════════════════════════ -->
    <!-- MODALS                                   -->
    <!-- ═══════════════════════════════════════ -->

    <!-- Interview Schedule Sidebar -->
    <InterviewScheduleSidebar
      v-if="showInterviewSidebar && interviewTargetApplication"
      :application-id="interviewTargetApplication.id"
      :candidate-name="interviewTargetApplication.name"
      :job-title="jobData?.title ?? ''"
      :interview="interviewToReschedule"
      :teleport-target="teleportTarget"
      :allow-skip="interviewSidebarAllowsSkip"
      @close="closeInterviewSidebar"
      @scheduled="handleInterviewScheduled"
      @skip="skipInterviewScheduling"
    />

    <InterviewStatusActionDialog
      :open="!!pendingInterviewStatus"
      :action="pendingInterviewStatus?.status ?? null"
      :candidate-name="pendingInterviewStatus ? formatPersonName(pendingInterviewStatus.interview.candidateFirstName, pendingInterviewStatus.interview.candidateLastName) : ''"
      :candidate-email="pendingInterviewStatus?.interview.candidateEmail ?? ''"
      :invitation-sent-at="pendingInterviewStatus?.interview.invitationSentAt ?? null"
      :loading="isInterviewTransitioning"
      @close="pendingInterviewStatus = null"
      @confirm="pendingInterviewStatus && handleInterviewTransition(pendingInterviewStatus.interview, pendingInterviewStatus.status)"
    />

    <!-- Document Preview Modal -->
    <Teleport :to="teleportTarget">
      <div v-if="showDocPreview" ref="docPreviewDialog" role="dialog" aria-modal="true" aria-label="Document preview" tabindex="-1" class="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeDocPreview" />
        <div class="relative flex flex-col bg-white dark:bg-surface-900 rounded-2xl shadow-2xl shadow-surface-900/10 dark:shadow-black/30 ring-1 ring-surface-200/80 dark:ring-surface-700/60 w-full max-w-4xl" style="height: calc(100vh - 3rem);">
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-3 border-b border-surface-200/80 dark:border-surface-800/60 shrink-0">
            <div class="flex items-center gap-2.5 min-w-0">
              <FileText class="size-4 text-surface-400 shrink-0" />
              <span class="text-sm font-medium text-surface-800 dark:text-surface-100 truncate">{{ docPreviewFilename }}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0 ml-4">
              <a
                v-if="docPreviewDocId"
                :href="`/api/documents/${docPreviewDocId}/download`"
                class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 hover:border-surface-300 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800 transition-all duration-150"
              >
                <Download class="size-3.5" />
                Download
              </a>
              <button
                class="rounded-lg p-1.5 text-surface-500 hover:text-surface-700 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-800 transition-colors"
                aria-label="Close preview"
                title="Close"
                @click="closeDocPreview"
              >
                <X class="size-4" />
              </button>
            </div>
          </div>
          <!-- PDF viewer -->
          <iframe
            v-if="docPreviewUrl && isDocPreviewPdf"
            :src="docPreviewUrl"
            class="flex-1 w-full rounded-b-2xl min-h-0"
            title="Document preview"
          />
          <!-- Non-PDF fallback -->
          <div v-else class="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <FileText class="size-12 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
              <p class="text-sm font-medium text-surface-600 dark:text-surface-300">Preview not available for this file type</p>
              <a
                v-if="docPreviewDocId"
                :href="`/api/documents/${docPreviewDocId}/download`"
                class="mt-3 inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium"
              >
                <Download class="size-3.5" />
                Download instead
              </a>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
