<script setup lang="ts">
import {
  ArrowRight, Calendar, Clock, FileText,
  MessageSquare, Trash2, Mail, Phone, ExternalLink, Inbox, SlidersHorizontal,
  Plus, Pencil, Download, Eye, X, Brain, History, StickyNote, MapPin, Users,
  CheckCircle2, XCircle, AlertTriangle, Video, Building2, Code2, UsersRound, ChevronDown,
  FoldHorizontal, UnfoldHorizontal,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import type { Interview } from '~/composables/useInterviews'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'
import { APPLICATION_STATUS_TRANSITIONS } from '~~/shared/status-transitions'

const props = withDefaults(defineProps<{
  applicationId: string
  variant?: 'page' | 'drawer'
}>(), {
  variant: 'page',
})

const emit = defineEmits<{
  deleted: []
  close: []
}>()

const localePath = useLocalePath()
const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const { track } = useTrack()
const toast = useToast()
const { formatCandidateName } = useOrgSettings()
const { getPreviewUrl } = useDocuments()

const { application, status: fetchStatus, error, refresh, updateApplication, deleteApplication } = useApplication(() => props.applicationId)

useSeoMeta({
  title: computed(() => {
    if (props.variant !== 'page') return undefined
    return application.value
      ? `${application.value.candidate.firstName} ${application.value.candidate.lastName} → ${application.value.job.title} — Reqcore`
      : 'Application — Reqcore'
  }),
})

// ─────────────────────────────────────────────
// Tabs & Overview section toggles
// ─────────────────────────────────────────────

type DetailTab = 'overview' | 'inbox' | 'cover-letter' | 'interviews' | 'documents' | 'responses' | 'ai-analysis' | 'timeline' | 'properties' | 'notes'
const detailTab = ref<DetailTab>('overview')

// Toggle the page between centered (max-w-4xl) and full width
const isWideDetail = ref(false)
const detailWidthClass = computed(() => isWideDetail.value ? 'max-w-none' : 'max-w-4xl')

// Full-page variant wraps content in a centered, toggleable width container; the drawer fills its panel.
const rootClass = computed(() =>
  props.variant === 'page'
    ? `mx-auto transition-[max-width] duration-300 ${detailWidthClass.value}`
    : '',
)

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
const overviewPanelRef = ref<HTMLElement | null>(null)
const overviewDropdownStyle = ref<Record<string, string>>({})

function toggleOverviewDropdown() {
  if (showOverviewDropdown.value) {
    showOverviewDropdown.value = false
    return
  }
  const rect = overviewDropdownRef.value?.getBoundingClientRect()
  if (rect) {
    overviewDropdownStyle.value = { top: `${rect.bottom + 4}px`, left: `${rect.left}px` }
  }
  showOverviewDropdown.value = true
}

function handleOverviewDropdownClickOutside(event: MouseEvent) {
  const target = event.target as Node
  if (overviewDropdownRef.value?.contains(target) || overviewPanelRef.value?.contains(target)) {
    return
  }
  showOverviewDropdown.value = false
}

watch(showOverviewDropdown, (val) => {
  if (val) {
    setTimeout(() => document.addEventListener('click', handleOverviewDropdownClickOutside), 0)
  } else {
    document.removeEventListener('click', handleOverviewDropdownClickOutside)
  }
})

const hasCoverLetter = computed(() => Boolean(application.value?.coverLetterText?.trim()))
const responseCount = computed(() => application.value?.responses?.length ?? 0)
const documentCount = computed(() => application.value?.candidate?.documents?.length ?? 0)

watch(hasCoverLetter, (hasLetter) => {
  if (!hasLetter && detailTab.value === 'cover-letter') {
    detailTab.value = 'overview'
  }
})

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

interface DetailTabDef {
  key: DetailTab
  label: string
  icon?: Component
  count?: number
}

const detailTabDefs = computed<DetailTabDef[]>(() => {
  const defs: DetailTabDef[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'inbox', label: 'Inbox', icon: Inbox },
  ]
  if (hasCoverLetter.value) {
    defs.push({ key: 'cover-letter', label: 'Cover Letter', icon: FileText })
  }
  defs.push({ key: 'ai-analysis', label: 'AI Analysis', icon: Brain })
  defs.push({ key: 'interviews', label: 'Interviews', icon: Calendar, count: currentApplicationInterviews.value.length })
  defs.push({ key: 'documents', label: 'Documents', icon: FileText, count: documentCount.value })
  defs.push({ key: 'responses', label: 'Responses', icon: MessageSquare, count: responseCount.value })
  defs.push({ key: 'notes', label: 'Notes', icon: StickyNote, count: notes.value.length })
  defs.push({ key: 'timeline', label: 'Timeline', icon: History })
  defs.push({ key: 'properties', label: 'Properties', icon: SlidersHorizontal })
  return defs
})

// ─────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────

const statusBadgeClasses: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:ring-blue-800',
  screening: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:ring-violet-800',
  interview: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:ring-amber-800',
  offer: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/50 dark:text-teal-400 dark:ring-teal-800',
  hired: 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-950/50 dark:text-green-400 dark:ring-green-800',
  rejected: 'bg-surface-100 text-surface-500 ring-surface-200 dark:bg-surface-800/50 dark:text-surface-400 dark:ring-surface-700',
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
  new: 'border border-surface-300 dark:border-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800',
  screening: 'bg-violet-600 text-white hover:bg-violet-700',
  interview: 'bg-amber-600 text-white hover:bg-amber-700',
  offer: 'bg-teal-600 text-white hover:bg-teal-700',
  hired: 'bg-green-700 text-white hover:bg-green-800',
  rejected: 'bg-danger-600 text-white hover:bg-danger-700',
}

const allowedTransitions = computed(() => {
  if (!application.value) return []
  return APPLICATION_STATUS_TRANSITIONS[application.value.status] ?? []
})

const isMutating = ref(false)

async function changeStatus(newStatus: string) {
  if (!application.value || isMutating.value) return
  isMutating.value = true
  try {
    track('application_status_changed', {
      from_stage: application.value.status,
      to_stage: newStatus,
    })
    await updateApplication({ status: newStatus as any })
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to update status', { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    isMutating.value = false
  }
}

// ─────────────────────────────────────────────
// Interviews for this application
// ─────────────────────────────────────────────

const { data: jobInterviewsData, refresh: refreshApplicationInterviews } = useFetch<{ data: Interview[] }>('/api/interviews', {
  key: computed(() => `application-interviews-${props.applicationId}`),
  query: computed(() => ({ applicationId: props.applicationId, limit: 100 })),
  headers: useRequestHeaders(['cookie']),
})

const currentApplicationInterviews = computed(() => jobInterviewsData.value?.data ?? [])

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

const interviewStatusIcons: Record<string, any> = {
  scheduled: Calendar,
  completed: CheckCircle2,
  cancelled: XCircle,
  no_show: AlertTriangle,
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

const expandedInterviewId = ref<string | null>(null)

function toggleInterviewExpand(id: string) {
  expandedInterviewId.value = expandedInterviewId.value === id ? null : id
}

// ── Interview scheduling sidebar ──────────────

const showInterviewSidebar = ref(false)
const interviewToReschedule = ref<Interview | null>(null)
const interviewSidebarAllowsSkip = ref(false)

function openInterviewScheduler() {
  interviewToReschedule.value = null
  interviewSidebarAllowsSkip.value = false
  showInterviewSidebar.value = true
}

/** "Interview" status transition — scheduling is offered, but skippable. */
function openInterviewSchedulerForStatus() {
  openInterviewScheduler()
  interviewSidebarAllowsSkip.value = true
}

async function skipInterviewScheduling() {
  closeInterviewSidebar()
  await changeStatus('interview')
}

function openReschedule(iv: Interview) {
  interviewToReschedule.value = iv
  showInterviewSidebar.value = true
}

function closeInterviewSidebar() {
  showInterviewSidebar.value = false
  interviewToReschedule.value = null
  interviewSidebarAllowsSkip.value = false
}

async function handleInterviewScheduled() {
  const wasRescheduled = !!interviewToReschedule.value
  showInterviewSidebar.value = false
  interviewToReschedule.value = null
  track(wasRescheduled ? 'interview_rescheduled' : 'interview_scheduled')
  await refreshApplicationInterviews()
  await refresh()
}

// ─────────────────────────────────────────────
// Notes (threaded comments)
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

const currentUserId = ref<string | null>(null)
onMounted(async () => {
  const { data } = await authClient.getSession()
  currentUserId.value = data?.user?.id ?? null
})

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

async function loadNotes(silent = false) {
  if (!props.applicationId) return
  if (!silent) notesLoading.value = true
  notesError.value = null
  try {
    const result = await $fetch<{ data: ApplicationNote[] }>('/api/comments', {
      query: { targetType: 'application', targetId: props.applicationId, limit: 100 },
    })
    notes.value = result.data
    notesLoaded.value = true
  } catch (err: any) {
    notesError.value = err?.data?.statusMessage ?? 'Failed to load notes'
  } finally {
    notesLoading.value = false
  }
}

watch([() => showSection.value.notes, () => props.applicationId], () => {
  if (import.meta.server) return
  if (showSection.value.notes && !notesLoaded.value && props.applicationId) {
    loadNotes()
  }
}, { immediate: true })

async function addNote() {
  const body = noteDraft.value.trim()
  if (!body || !props.applicationId || isSavingNote.value) return
  isSavingNote.value = true
  try {
    await $fetch('/api/comments', {
      method: 'POST',
      body: { targetType: 'application', targetId: props.applicationId, body },
    })
    noteDraft.value = ''
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
    if (editingNoteId.value === note.id) cancelEditNote()
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to delete note', { message: err?.data?.statusMessage, statusCode: err?.data?.statusCode })
  } finally {
    deletingNoteId.value = null
  }
}

// ─────────────────────────────────────────────
// Delete application
// ─────────────────────────────────────────────

const showDeleteConfirm = ref(false)
const isDeleting = ref(false)

async function handleDelete() {
  isDeleting.value = true
  try {
    await deleteApplication()
    emit('deleted')
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to delete application', { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    isDeleting.value = false
  }
}

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
  actorImage: string | null
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

async function loadTimeline() {
  const candId = application.value?.candidate?.id
  if (!candId) return
  timelineLoading.value = true
  timelineError.value = null
  try {
    const result = await $fetch<{ items: TimelineEntry[] }>('/api/activity-log/candidate-timeline', {
      query: { candidateId: candId },
    })
    timelineItems.value = result.items
    timelineLoaded.value = true
  } catch (err: any) {
    timelineError.value = err?.data?.statusMessage ?? 'Failed to load timeline'
  } finally {
    timelineLoading.value = false
  }
}

watch([() => showSection.value.timeline, application], () => {
  if (import.meta.server) return
  if (showSection.value.timeline && !timelineLoaded.value && application.value?.candidate?.id) {
    loadTimeline()
  }
}, { immediate: true })

// ─────────────────────────────────────────────
// Document preview
// ─────────────────────────────────────────────

const showDocPreview = ref(false)
const docPreviewUrl = ref<string | null>(null)
const docPreviewFilename = ref('')
const docPreviewMimeType = ref('')
const docPreviewDocId = ref<string | null>(null)

const isDocPreviewPdf = computed(() => docPreviewMimeType.value === 'application/pdf')

type SwipeDocument = {
  id: string
  type: 'resume' | 'cover_letter' | 'other'
  originalFilename: string
  mimeType: string
  createdAt: string | Date
}

function handleDocPreview(doc: SwipeDocument) {
  track('document_viewed', { document_type: doc.type, mime_type: doc.mimeType })
  if (doc.mimeType !== 'application/pdf') {
    window.open(`/api/documents/${doc.id}/download`, '_blank')
    return
  }
  docPreviewDocId.value = doc.id
  docPreviewFilename.value = doc.originalFilename
  docPreviewMimeType.value = doc.mimeType
  docPreviewUrl.value = getPreviewUrl(doc.id)
  showDocPreview.value = true
}

function closeDocPreview() {
  showDocPreview.value = false
  docPreviewUrl.value = null
  docPreviewFilename.value = ''
  docPreviewMimeType.value = ''
  docPreviewDocId.value = null
}

// Escape closes nested modals first, then bubbles `close` up to the host (drawer).
function handleKeyNavigation(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (showDocPreview.value) {
    closeDocPreview()
    return
  }
  if (showDeleteConfirm.value) {
    showDeleteConfirm.value = false
    return
  }
  emit('close')
}

onMounted(() => window.addEventListener('keydown', handleKeyNavigation))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeyNavigation))

// ─────────────────────────────────────────────
// Reset transient UI state when the underlying application changes
// (the drawer swaps applications without remounting; a no-op on the page).
// ─────────────────────────────────────────────

watch(() => props.applicationId, () => {
  detailTab.value = 'overview'
  isWideDetail.value = false
  expandedInterviewId.value = null
  showOverviewDropdown.value = false
  showDeleteConfirm.value = false
  closeInterviewSidebar()
  closeDocPreview()
  noteDraft.value = ''
  cancelEditNote()
  notes.value = []
  notesLoaded.value = false
  timelineItems.value = []
  timelineLoaded.value = false
})

// ─────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────

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
  if (score >= 75) return 'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950 dark:text-success-400 dark:ring-success-800'
  if (score >= 40) return 'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-950 dark:text-warning-400 dark:ring-warning-800'
  return 'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-950 dark:text-danger-400 dark:ring-danger-800'
}
</script>

<template>
  <div :class="rootClass">
    <!-- Host chrome (e.g. the page's back link) -->
    <slot name="top" />

    <!-- Loading -->
    <div v-if="fetchStatus === 'pending'" class="flex flex-col items-center justify-center gap-3 py-24">
      <div class="size-8 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin" />
      <p class="text-sm font-medium text-surface-400">Loading application…</p>
    </div>

    <!-- Error / not found -->
    <div
      v-else-if="error"
      class="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700"
    >
      {{ error.statusCode === 404 ? 'Application not found.' : 'Failed to load application.' }}
      <NuxtLink :to="$localePath('/dashboard/applications')" class="underline ml-1">Back to Applications</NuxtLink>
    </div>

    <!-- Application detail -->
    <template v-else-if="application">
      <!-- Sticky status-transition bar -->
      <div v-if="allowedTransitions.length > 0" class="sticky top-0 z-20 mb-4 rounded-xl border border-surface-200/80 bg-white/95 px-4 py-2.5 dark:border-surface-800/60 dark:bg-surface-900/95">
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="(nextStatus, idx) in allowedTransitions"
            :key="nextStatus"
            :disabled="isMutating"
            class="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm inline-flex items-center gap-1.5"
            :class="transitionClasses[nextStatus] ?? 'border border-surface-300 dark:border-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800'"
            @click="nextStatus === 'interview' ? openInterviewSchedulerForStatus() : changeStatus(nextStatus)"
          >
            {{ transitionLabels[nextStatus] ?? nextStatus }}
            <kbd class="inline-flex items-center justify-center rounded px-1 py-0.5 text-[10px] font-mono leading-none opacity-60 bg-black/10 dark:bg-white/10 min-w-[16px]">{{ idx + 1 }}</kbd>
          </button>
          <div class="ml-auto flex items-center gap-2">
            <button
              class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:border-brand-400 dark:hover:border-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30 hover:text-brand-700 dark:hover:text-brand-300 transition-all duration-150 focus:outline-none"
              @click="openInterviewScheduler"
            >
              <Calendar class="size-3.5" />
              Schedule Interview
            </button>
            <button
              class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-danger-300 dark:border-danger-700 px-3 py-1.5 text-xs font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950 transition-colors"
              @click="showDeleteConfirm = true"
            >
              <Trash2 class="size-3.5" />
              Delete application
            </button>
          </div>
        </div>
      </div>

      <!-- Candidate header (high density) -->
      <div class="mb-4 rounded-xl border border-surface-200 bg-white px-5 py-4 dark:border-surface-800 dark:bg-surface-900">
        <div class="flex items-start gap-4">
          <div class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-lg font-bold text-white shadow-sm ring-1 ring-inset ring-brand-700/20 dark:bg-brand-600 dark:ring-brand-500/40">
            {{ getCandidateInitials(application.candidate.firstName, application.candidate.lastName) }}
          </div>
          <div class="min-w-0 flex-1 space-y-2">
            <div class="flex flex-wrap items-center gap-2.5">
              <h1 class="truncate text-xl font-semibold tracking-tight text-surface-900 dark:text-surface-50">
                {{ formatCandidateName(application.candidate) }}
              </h1>
              <span
                class="inline-flex shrink-0 items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset capitalize"
                :class="statusBadgeClasses[application.status] ?? 'bg-surface-100 text-surface-600'"
              >
                {{ application.status }}
              </span>
              <span
                v-if="application.score != null"
                class="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset"
                :class="scoreClass(application.score)"
              >
                {{ application.score }} pts
              </span>
              <button
                v-if="variant === 'page'"
                class="ml-auto flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-surface-200 p-1.5 text-surface-500 transition-all duration-150 hover:border-surface-300 hover:bg-white hover:text-surface-700 dark:border-surface-700 dark:text-surface-400 dark:hover:border-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
                :aria-pressed="isWideDetail"
                :title="isWideDetail ? 'Use centered width' : 'Use full width'"
                @click="isWideDetail = !isWideDetail"
              >
                <FoldHorizontal v-if="isWideDetail" class="size-4" />
                <UnfoldHorizontal v-else class="size-4" />
              </button>
            </div>
            <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-surface-500 dark:text-surface-400">
              <a
                :href="`mailto:${application.candidate.email}`"
                target="_blank"
                class="inline-flex items-center gap-1.5 hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
              >
                <Mail class="size-3.5" />
                {{ application.candidate.email }}
              </a>
              <span v-if="application.candidate.phone" class="inline-flex items-center gap-1.5">
                <Phone class="size-3.5" />
                {{ application.candidate.phone }}
              </span>
              <span class="inline-flex items-center gap-1.5 text-surface-400 dark:text-surface-500">
                <ArrowRight class="size-3.5" />
                <NuxtLink
                  :to="$localePath(`/dashboard/jobs/${application.job.id}`)"
                  class="hover:text-brand-600 dark:hover:text-brand-400 hover:underline transition-colors"
                >
                  {{ application.job.title }}
                </NuxtLink>
              </span>
            </div>
            <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-surface-400 dark:text-surface-500">
              <TimelineDateLink :date="application.createdAt" class="inline-flex items-center gap-1">
                <Clock class="size-3" />
                Applied {{ new Date(application.createdAt).toLocaleDateString() }}
              </TimelineDateLink>
              <span v-if="application.updatedAt !== application.createdAt" class="inline-flex items-center gap-1">
                · <TimelineDateLink :date="application.updatedAt">Updated {{ new Date(application.updatedAt).toLocaleDateString() }}</TimelineDateLink>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="mb-5 border-b border-surface-200/80 dark:border-surface-800/60">
        <div class="flex items-center gap-0.5 overflow-x-auto scrollbar-thin">
          <!-- Overview tab with section toggles -->
          <div ref="overviewDropdownRef" class="relative shrink-0">
            <div
              class="flex items-center rounded-md transition-colors duration-150"
              :class="detailTab === 'overview' ? 'bg-brand-50 dark:bg-brand-500/15' : 'hover:bg-surface-100 dark:hover:bg-surface-800/60'"
            >
              <button
                class="cursor-pointer px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150"
                :class="detailTab === 'overview'
                  ? 'text-brand-700 dark:text-brand-300'
                  : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'"
                @click="detailTab = 'overview'"
              >
                Overview
              </button>
              <button
                v-if="detailTab === 'overview'"
                class="cursor-pointer -ml-1.5 pr-1.5 py-1.5 rounded transition-colors duration-150 text-brand-400 hover:text-brand-600 dark:text-brand-400/70 dark:hover:text-brand-300"
                @click.stop="toggleOverviewDropdown"
              >
                <ChevronDown class="size-3.5 transition-transform duration-150" :class="showOverviewDropdown ? 'rotate-180' : ''" />
              </button>
            </div>

            <Teleport to="body">
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
                  ref="overviewPanelRef"
                  :style="overviewDropdownStyle"
                  class="fixed z-[60] w-44 rounded-xl border border-surface-200 dark:border-surface-700/80 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/5 dark:shadow-black/20 py-1.5 origin-top-left"
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
            </Teleport>
          </div>

          <!-- Tab buttons -->
          <button
            v-for="tab in detailTabDefs.filter(t => t.key !== 'overview')"
            :key="tab.key"
            class="shrink-0 cursor-pointer rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 flex items-center gap-1.5"
            :class="detailTab === tab.key
              ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
              : 'text-surface-500 hover:text-surface-700 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-300 dark:hover:bg-surface-800/60'"
            @click="detailTab = tab.key"
          >
            <component :is="tab.icon" v-if="tab.icon" class="size-3.5" />
            {{ tab.label }}
            <span v-if="tab.count" class="text-xs tabular-nums" :class="detailTab === tab.key ? 'text-brand-500/70 dark:text-brand-400/70' : 'text-surface-400'">
              ({{ tab.count }})
            </span>
          </button>
        </div>
      </div>

      <!-- Detail content -->
      <div
        class="bg-surface-50/80 dark:bg-transparent"
        :class="detailTab === 'inbox' ? 'flex min-h-[60vh] flex-1 flex-col overflow-hidden' : 'rounded-xl'"
      >
        <!-- CANDIDATE INBOX -->
        <div v-if="detailTab === 'inbox'" class="h-full min-h-0 min-w-0 w-full">
          <CandidateMessagingPanel
            :key="application.id"
            :application-id="application.id"
            :candidate-name="formatCandidateName(application.candidate)"
            :candidate-email="application.candidate.email"
            :job-title="application.job.title"
          />
        </div>

        <!-- COVER LETTER SECTION -->
        <div v-if="showSection.coverLetter && hasCoverLetter" :class="detailTab === 'overview' ? 'mt-6' : ''">
          <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold text-surface-800 dark:text-surface-200">
            <FileText class="size-4 text-surface-400 dark:text-surface-500" />
            Cover letter
          </h2>
          <div class="rounded-xl border border-surface-200/80 bg-white p-4 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
            <p class="text-sm leading-relaxed text-surface-600 dark:text-surface-300 whitespace-pre-wrap">
              {{ application.coverLetterText }}
            </p>
          </div>
        </div>

        <!-- AI SCORE BREAKDOWN -->
        <div v-if="showSection.aiAnalysis" :class="detailTab === 'overview' ? 'mt-6' : ''">
          <ScoreBreakdown :application-id="application.id" @scored="refresh()" />
        </div>

        <!-- INTERVIEWS SECTION -->
        <div v-if="showSection.interviews" class="space-y-3" :class="detailTab === 'overview' ? 'mt-6' : ''">
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
              <!-- Interview card header -->
              <button
                class="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3 text-left"
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
                    <component :is="interviewStatusIcons[iv.status] ?? Calendar" class="size-3" />
                    {{ iv.status === 'no_show' ? 'No Show' : iv.status }}
                  </span>
                  <ChevronDown class="size-4 text-surface-400 transition-transform duration-200" :class="{ 'rotate-180': expandedInterviewId === iv.id }" />
                </div>
              </button>

              <!-- Expanded interview detail -->
              <div v-if="expandedInterviewId === iv.id" class="border-t border-surface-200/80 dark:border-surface-800/60">
                <div class="px-5 py-4">
                  <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <dt class="text-[11px] font-medium text-surface-400 dark:text-surface-500 mb-0.5">Date &amp; Time</dt>
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
                  </dl>
                  <div class="flex items-center gap-3 mt-4 pt-3 border-t border-surface-100 dark:border-surface-800/60">
                    <button
                      v-if="iv.status === 'scheduled'"
                      type="button"
                      class="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
                      @click.stop="openReschedule(iv)"
                    >
                      <Calendar class="size-3" />
                      Reschedule
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
                </div>
              </div>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else class="rounded-xl border border-surface-200/80 bg-white px-6 py-9 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
            <div class="flex size-11 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
              <Calendar class="size-5 text-surface-400 dark:text-surface-500" />
            </div>
            <p class="text-sm font-medium text-surface-600 dark:text-surface-300">No interviews scheduled</p>
            <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">Schedule an interview to start the process.</p>
          </div>
        </div>

        <!-- DOCUMENTS SECTION -->
        <div v-if="showSection.documents" class="space-y-3" :class="detailTab === 'overview' ? 'mt-6' : ''">
          <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
            <FileText class="size-4 text-surface-400 dark:text-surface-500" />
            Documents
          </h2>
          <div v-if="application.candidate.documents?.length" class="space-y-3">
            <div
              v-for="doc in application.candidate.documents"
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
        <div v-if="showSection.responses" class="space-y-3" :class="detailTab === 'overview' ? 'mt-6' : ''">
          <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200 flex items-center gap-2 mb-3">
            <MessageSquare class="size-4 text-surface-400 dark:text-surface-500" />
            Responses
          </h2>
          <template v-if="application.responses?.length">
            <div class="divide-y divide-surface-100 rounded-xl border border-surface-200/80 bg-white shadow-sm shadow-surface-900/[0.03] dark:divide-surface-800/60 dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
              <div
                v-for="response in application.responses"
                :key="response.id"
                class="px-4 py-3"
              >
                <p class="text-[11px] font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mb-1">
                  {{ response.question?.label ?? 'Unknown question' }}
                </p>
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
        <div v-if="showSection.properties" :class="detailTab === 'overview' ? 'mt-6' : ''">
          <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold text-surface-800 dark:text-surface-200">
            <SlidersHorizontal class="size-4 text-surface-400 dark:text-surface-500" />
            Properties
          </h2>
          <div class="rounded-xl border border-surface-200/80 bg-white p-4 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
            <PropertyBlock
              entity-type="application"
              :entity-id="application.id"
              :job-id="application.job.id"
              :entries="(application.properties ?? []) as import('~~/shared/properties').PropertyEntry[]"
              @refresh="refresh()"
            />
          </div>
        </div>

        <!-- NOTES SECTION -->
        <div v-if="showSection.notes" class="space-y-3" :class="detailTab === 'overview' ? 'mt-6' : ''">
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
          <div v-else-if="notesError" class="rounded-xl border border-danger-200 bg-danger-50/60 p-6 text-center dark:border-danger-900/60 dark:bg-danger-950/30">
            <AlertTriangle class="size-6 text-danger-400 mx-auto mb-2" />
            <p class="text-sm text-danger-700 dark:text-danger-400">{{ notesError }}</p>
            <button type="button" class="mt-3 cursor-pointer rounded-lg border border-danger-200 px-3 py-1.5 text-xs font-medium text-danger-700 transition-colors hover:bg-danger-100 dark:border-danger-800 dark:text-danger-400 dark:hover:bg-danger-950/60" @click="loadNotes()">
              Try again
            </button>
          </div>

          <!-- Empty -->
          <div v-else-if="notes.length === 0 && detailTab === 'overview'" class="flex items-center gap-2.5 rounded-lg border border-dashed border-surface-200 px-3.5 py-2.5 dark:border-surface-800/70">
            <StickyNote class="size-4 shrink-0 text-surface-300 dark:text-surface-600" />
            <p class="text-xs text-surface-400 dark:text-surface-500">No notes yet.</p>
          </div>
          <div v-else-if="notes.length === 0" class="rounded-xl border border-surface-200/80 bg-white px-6 py-9 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
            <div class="flex size-11 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60 mx-auto mb-3">
              <StickyNote class="size-5 text-surface-400 dark:text-surface-500" />
            </div>
            <p class="text-sm font-medium text-surface-600 dark:text-surface-300">No notes yet</p>
            <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">Notes you and your team write about this candidate appear here.</p>
          </div>

          <!-- Notes list -->
          <div v-else class="space-y-3">
            <div
              v-for="note in notes"
              :key="note.id"
              class="rounded-xl border border-surface-200/80 bg-white p-4 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-center gap-2.5 min-w-0">
                  <img v-if="note.authorImage" :src="note.authorImage" :alt="noteAuthorLabel(note)" class="size-7 shrink-0 rounded-full object-cover">
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
                  <button v-if="canEditNote(note)" type="button" class="cursor-pointer rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300" title="Edit note" @click="startEditNote(note)">
                    <Pencil class="size-3.5" />
                  </button>
                  <button v-if="canRemoveNote(note)" type="button" class="cursor-pointer rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-danger-50 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-danger-950/40 dark:hover:text-danger-400" :disabled="deletingNoteId === note.id" title="Delete note" @click="deleteNote(note)">
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
                  <button type="button" class="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-surface-500 transition-colors hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800" @click="cancelEditNote">
                    Cancel
                  </button>
                  <button type="button" class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-400" :disabled="!editingNoteBody.trim() || isUpdatingNote" @click="saveNote">
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
        <div v-if="showSection.timeline" class="space-y-3">
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
          <div v-else-if="timelineError" class="rounded-xl border border-danger-200/80 dark:border-danger-800/60 bg-danger-50 dark:bg-danger-950/40 p-5 text-center">
            <AlertTriangle class="size-6 text-danger-400 mx-auto mb-2" />
            <p class="text-sm text-danger-700 dark:text-danger-400">{{ timelineError }}</p>
            <button class="mt-3 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium cursor-pointer" @click="loadTimeline">
              Retry
            </button>
          </div>

          <!-- Empty -->
          <div v-else-if="timelineItems.length === 0" class="rounded-xl border border-surface-200/80 bg-white px-6 py-9 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none">
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
              <div class="flex flex-col items-center shrink-0">
                <div class="flex items-center justify-center size-6 rounded shrink-0" :class="getTimelineActionStyle(item.action).bg">
                  <component :is="getTimelineActionStyle(item.action).icon" class="size-3" :class="getTimelineActionStyle(item.action).color" />
                </div>
                <div v-if="index < timelineItems.length - 1" class="w-px flex-1 min-h-[10px] bg-surface-200 dark:bg-surface-800 mt-0.5" />
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 flex-wrap">
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
                  <span v-if="item.jobTitle" class="text-[10px] text-surface-400 dark:text-surface-500 bg-surface-100 dark:bg-surface-800 rounded px-1.5 py-0.5 truncate max-w-[140px]">
                    {{ item.jobTitle }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Delete confirmation dialog -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm && application" class="fixed inset-0 z-[70] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/50" @click="showDeleteConfirm = false" />
        <div class="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-surface-900 mx-4" role="dialog" aria-modal="true" aria-labelledby="delete-application-title">
          <h2 id="delete-application-title" class="mb-2 text-lg font-semibold text-surface-900 dark:text-surface-50">Delete Application</h2>
          <p class="mb-4 text-sm text-surface-600 dark:text-surface-400">
            Delete {{ formatCandidateName(application.candidate) }}'s application for
            <strong>{{ application.job.title }}</strong>? Application responses, interviews, scores, and messages will be permanently deleted. The candidate remains in your candidate list.
          </p>
          <div class="flex justify-end gap-2">
            <button
              :disabled="isDeleting"
              class="rounded-lg border border-surface-300 px-3 py-1.5 text-sm font-medium text-surface-700 hover:bg-surface-50 disabled:opacity-50 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
              @click="showDeleteConfirm = false"
            >
              Cancel
            </button>
            <button
              :disabled="isDeleting"
              class="rounded-lg bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50"
              @click="handleDelete"
            >
              {{ isDeleting ? 'Deleting…' : 'Delete application' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Interview Schedule Sidebar -->
    <InterviewScheduleSidebar
      v-if="showInterviewSidebar && application"
      :application-id="application.id"
      :candidate-name="formatCandidateName(application.candidate)"
      :job-title="application.job.title"
      :interview="interviewToReschedule"
      :allow-skip="interviewSidebarAllowsSkip"
      @close="closeInterviewSidebar"
      @scheduled="handleInterviewScheduled"
      @skip="skipInterviewScheduling"
    />

    <!-- Document Preview Modal -->
    <Teleport to="body">
      <div v-if="showDocPreview" class="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeDocPreview" />
        <div class="relative flex flex-col bg-white dark:bg-surface-900 rounded-2xl shadow-2xl shadow-surface-900/10 dark:shadow-black/30 ring-1 ring-surface-200/80 dark:ring-surface-700/60 w-full max-w-4xl" style="height: calc(100vh - 3rem);">
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
              <button class="rounded-lg p-1.5 text-surface-500 hover:text-surface-700 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-800 transition-colors" title="Close" @click="closeDocPreview">
                <X class="size-4" />
              </button>
            </div>
          </div>
          <iframe
            v-if="docPreviewUrl && isDocPreviewPdf"
            :src="docPreviewUrl"
            class="flex-1 w-full rounded-b-2xl min-h-0"
            title="Document preview"
          />
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
