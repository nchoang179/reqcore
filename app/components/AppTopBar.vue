<script setup lang="ts">
import {
  Briefcase, Plus, Bell,
  Kanban, FileText, LogOut, Table2,
  Sun, Moon, MessageSquarePlus, Settings,
  ChevronDown, Menu, X, Users, ChevronLeft,
  LayoutDashboard, Calendar, ArrowUpCircle,
  Sparkles, Radio, History,
  MessageCircle, Languages, Lock, Inbox, Upload, Zap, Megaphone,
} from 'lucide-vue-next'
import type { PlanFeature } from '~~/shared/billing'

const route = useRoute()
const localePath = useLocalePath()
const getRouteBaseName = useRouteBaseName()
const { data: session } = await authClient.useSession(useFetch)
const isSigningOut = ref(false)
const { isDark, toggle: toggleColorMode } = useColorMode()

const showFeedbackModal = ref(false)
const showUserMenu = ref(false)
const showMobileMenu = ref(false)
const showMoreNav = ref(false)
const showDemoPlanMenu = ref(false)

const config = useRuntimeConfig()
const { activeOrg } = useCurrentOrg()

const isDemo = computed(() => {
  const slug = config.public.demoOrgSlug
  return (slug && activeOrg.value?.slug === slug) || session.value?.user?.email === 'demo@reqcore.com'
})


const userName = computed(() => session.value?.user?.name ?? 'User')
const userEmail = computed(() => session.value?.user?.email ?? '')
const userInitials = computed(() => {
  const name = userName.value
  const parts = name.split(' ').filter(Boolean)
  if (parts.length >= 2) {
    const first = parts[0] ?? ''
    const second = parts[1] ?? ''
    return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
})

async function handleSignOut() {
  isSigningOut.value = true
  await authClient.signOut()
  clearNuxtData()
  await navigateTo(localePath('/auth/sign-in'))
}

// ─────────────────────────────────────────────
// Dynamic job context
// ─────────────────────────────────────────────

const activeJobId = computed(() => {
  const baseName = getRouteBaseName(route)
  if (typeof baseName !== 'string' || !baseName.startsWith('dashboard-jobs-id')) return null
  const idParam = route.params.id
  if (typeof idParam !== 'string' || idParam === 'new') return null
  return idParam
})

const {
  data: sidebarJobsData,
} = useFetch('/api/jobs', {
  key: 'sidebar-jobs-list',
  query: { limit: 100 },
  headers: useRequestHeaders(['cookie']),
})

const sidebarJobs = computed(() => sidebarJobsData.value?.data ?? [])

const activeJobTitle = computed(() => {
  if (!activeJobId.value) return null
  const found = sidebarJobs.value.find((j: any) => j.id === activeJobId.value)
  return found?.title ?? 'Job'
})

const activeJobStatus = computed(() => {
  if (!activeJobId.value) return null
  const found = sidebarJobs.value.find((j: any) => j.id === activeJobId.value)
  return (found as any)?.status ?? null
})

const jobStatusBadgeClasses: Record<string, string> = {
  draft: 'bg-surface-50 text-surface-600 ring-surface-200 dark:bg-surface-800/60 dark:text-surface-400 dark:ring-surface-700',
  open: 'bg-success-50 text-success-700 ring-success-200 dark:bg-success-950/60 dark:text-success-400 dark:ring-success-800',
  closed: 'bg-warning-50 text-warning-700 ring-warning-200 dark:bg-warning-950/60 dark:text-warning-400 dark:ring-warning-800',
  archived: 'bg-surface-50 text-surface-400 ring-surface-200 dark:bg-surface-800/60 dark:text-surface-500 dark:ring-surface-700',
}

const { data: feedbackConfig } = useFetch('/api/feedback/config', {
  key: 'feedback-config',
  headers: useRequestHeaders(['cookie']),
})

const isFeedbackEnabled = computed(() => feedbackConfig.value?.enabled === true)

const jobTabs = computed(() => {
  if (!activeJobId.value) return []
  const base = `/dashboard/jobs/${activeJobId.value}`
  return [
    { label: 'Pipeline', to: base, icon: Kanban, exact: true },
    { label: 'Promote', to: `${base}/promote`, icon: Megaphone, exact: true },
    { label: 'Table', to: `${base}/candidates`, icon: Table2, exact: true },
    { label: 'Import', to: `${base}/import`, icon: Upload, exact: true },
    { label: 'Inbox', to: `${base}/inbox`, icon: Inbox, exact: true },
    { label: 'Application Form', to: `${base}/application-form`, icon: FileText, exact: true },
    { label: 'Automation', to: `${base}/rules`, icon: Zap, exact: true },
    { label: 'Source Tracking', to: `${base}/source-tracking`, icon: Radio, exact: true },
    { label: 'AI Analysis', to: `${base}/ai-analysis`, icon: Sparkles, exact: true },
    { label: 'Settings', to: `${base}/settings`, icon: Settings, exact: true },
  ]
})

// ─────────────────────────────────────────────
// Main navigation
// ─────────────────────────────────────────────

const navItems: Array<{ label: string; to: string; icon: typeof Briefcase; exact: boolean; comingSoon?: boolean; feature?: PlanFeature }> = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, exact: true },
  { label: 'Jobs', to: '/dashboard/jobs', icon: Briefcase, exact: false },
  { label: 'Candidates', to: '/dashboard/candidates', icon: Users, exact: false },
  { label: 'Applications', to: '/dashboard/applications', icon: FileText, exact: false },
  { label: 'Inbox', to: '/dashboard/inbox', icon: Inbox, exact: true, feature: 'candidateMessaging' },
  { label: 'Interviews', to: '/dashboard/interviews', icon: Calendar, exact: false },
  { label: 'Assistant', to: '/dashboard/chatbot', icon: MessageCircle, exact: false, feature: 'chatbot' },
  { label: 'Timeline', to: '/dashboard/timeline', icon: History, exact: true, feature: 'activityTimeline' },
  { label: 'Source Tracking', to: '/dashboard/source-tracking', icon: Radio, exact: true, feature: 'sourceAnalytics' },
  { label: 'AI Analysis', to: '/dashboard/ai-analysis', icon: Sparkles, exact: true, feature: 'aiAnalytics' },
  { label: 'Settings', to: '/dashboard/settings', icon: Settings, exact: false },
]

// Show a lock affordance on nav items the org's plan can't access yet. The
// link still works — it lands on the page's in-context upgrade card.
const { hasFeature } = usePlanFeature()
function isNavLocked(item: { feature?: PlanFeature }): boolean {
  return item.feature != null && !hasFeature(item.feature)
}

function isActiveRoute(to: string, exact: boolean) {
  const localizedTo = localePath(to)
  if (exact) return route.path === localizedTo
  return route.path === localizedTo || route.path.startsWith(`${localizedTo}/`)
}

// A plain mouse wheel only scrolls vertically, so on a narrow desktop window the
// overflowing nav links would be unreachable without a trackpad. Translate the
// vertical delta into horizontal scrolling while there's somewhere left to go.
const navScroller = useTemplateRef<HTMLElement>('navScrollerRoot')
function onNavWheel(e: WheelEvent) {
  const el = navScroller.value
  if (!el || e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  const max = el.scrollWidth - el.clientWidth
  if (max <= 0) return
  const next = Math.min(Math.max(el.scrollLeft + e.deltaY, 0), max)
  if (next === el.scrollLeft) return
  e.preventDefault()
  el.scrollLeft = next
}

const primaryNavLabels = ['Dashboard', 'Jobs', 'Candidates', 'Applications', 'Inbox', 'Interviews', 'Assistant', 'Settings']
const primaryNavItems = computed(() => navItems.filter(i => primaryNavLabels.includes(i.label)))
const moreNavItems = computed(() => navItems.filter(i => !primaryNavLabels.includes(i.label)))

// Close menus on route change
watch(() => route.path, () => {
  showUserMenu.value = false
  showMobileMenu.value = false
  showDemoPlanMenu.value = false
})

// ─────────────────────────────────────────────
// New Job button
// ─────────────────────────────────────────────

const newJobResetSignal = useState('new-job-reset-signal', () => 0)

function handleNewJobClick() {
  const newJobPath = localePath('/dashboard/jobs/new')
  // The test walkthrough sits on this same path under ?mode=test. From there
  // this button has to navigate, so the query — and the sample role it fills
  // the wizard with — is actually dropped.
  if (route.path === newJobPath && !route.query.mode) {
    // Already on the page: signal the wizard to reset instead of navigating
    newJobResetSignal.value++
  } else {
    navigateTo(newJobPath)
  }
}

// Close user menu on outside click
const userMenuRef = useTemplateRef<HTMLElement>('userMenuRoot')
function onClickOutsideUser(e: MouseEvent) {
  if (userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) {
    showUserMenu.value = false
  }
}
onMounted(() => {
  document.addEventListener('click', onClickOutsideUser)
})
onUnmounted(() => {
  document.removeEventListener('click', onClickOutsideUser)
})
</script>

<template>
  <header class="sticky top-0 z-50 w-full">
    <!-- Primary navigation bar -->
  <div v-if="!activeJobId" class="relative z-20 border-b border-surface-200/80 dark:border-surface-800/80 bg-white/80 dark:bg-surface-900/80 backdrop-blur-xl">
      <div class="flex h-14 items-center justify-between px-4 lg:px-6">
        <!-- Left: Logo + Nav -->
        <div class="flex min-w-0 flex-1 items-center self-stretch gap-1 lg:gap-2">
          <!-- Logo — static brand text, no link -->
          <span class="flex shrink-0 items-center px-2 py-1.5 mr-1 lg:mr-4">
            <span class="text-[15px] font-bold text-surface-900 dark:text-surface-100 hidden sm:block tracking-tight">ATS</span>
          </span>

          <!-- Desktop nav links — scroll horizontally once they outgrow the bar.
               The More dropdown sits outside the scroll box so its panel, which
               hangs below the 56px row, isn't clipped by the overflow. -->
          <nav class="hidden md:flex min-w-0 flex-1 items-stretch self-stretch gap-0.5">
            <div
              ref="navScrollerRoot"
              class="flex min-w-0 items-stretch gap-0.5 overflow-x-auto scrollbar-none"
              @wheel="onNavWheel"
            >
              <NuxtLink
                v-for="item in primaryNavItems"
                :key="item.to"
                :to="$localePath(item.to)"
                class="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-medium transition-colors duration-200 no-underline border-b-2"
                :class="isActiveRoute(item.to, item.exact)
                  ? 'text-brand-700 dark:text-brand-300 border-brand-600 dark:border-brand-400'
                  : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 border-transparent hover:border-surface-200 dark:hover:border-surface-700'"
              >
                <component :is="item.icon" class="size-4" />
                {{ item.label }}
              </NuxtLink>
            </div>

            <!-- More nav dropdown -->
            <div
              v-if="moreNavItems.length"
              class="relative shrink-0"
              @mouseenter="showMoreNav = true"
              @mouseleave="showMoreNav = false"
            >
              <button
                class="relative flex h-full items-center gap-1.5 px-3 text-[13px] font-medium transition-colors duration-200 cursor-pointer border-0 bg-transparent border-b-2"
                :class="moreNavItems.some(i => isActiveRoute(i.to, i.exact))
                  ? 'text-brand-700 dark:text-brand-300 border-brand-600 dark:border-brand-400'
                  : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 border-transparent hover:border-surface-200 dark:hover:border-surface-700'"
              >
                More
                <ChevronDown
                  class="size-3 opacity-60 transition-transform duration-200"
                  :class="showMoreNav ? 'rotate-180' : ''"
                />
              </button>
  <Transition
    v-if="!activeJobId"
                enter-active-class="transition duration-150 ease-out"
                enter-from-class="opacity-0 scale-95 -translate-y-1"
                enter-to-class="opacity-100 scale-100 translate-y-0"
                leave-active-class="transition duration-100 ease-in"
                leave-from-class="opacity-100 scale-100 translate-y-0"
                leave-to-class="opacity-0 scale-95 -translate-y-1"
              >
                <div
                  v-if="showMoreNav"
                  class="absolute left-0 top-full z-50 pt-1.5"
                >
                  <div class="w-52 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/8 dark:shadow-surface-950/30 overflow-hidden py-1">
                    <NuxtLink
                      v-for="item in moreNavItems"
                      :key="item.to"
                      :to="$localePath(item.to)"
                      class="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors no-underline"
                      :class="isActiveRoute(item.to, item.exact)
                        ? 'text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-950/40'
                        : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800'"
                    >
                      <component :is="item.icon" class="size-4" />
                      {{ item.label }}
                      <Lock
                        v-if="isNavLocked(item)"
                        class="ml-auto size-3 text-surface-400 dark:text-surface-500"
                      />
                    </NuxtLink>
                  </div>
                </div>
              </Transition>
            </div>
          </nav>
        </div>

        <!-- Right: Actions -->
        <div class="flex shrink-0 items-center gap-1 lg:gap-1.5 pl-2">
          <!-- Get Started CTA (demo mode only) -->
          <div
            v-if="isDemo"
            class="relative hidden sm:block"
            @mouseenter="showDemoPlanMenu = true"
            @mouseleave="showDemoPlanMenu = false"
          >
            <button
              type="button"
              class="group inline-flex items-center gap-2 rounded-lg border-0 bg-gradient-to-r from-brand-600 to-violet-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-md shadow-brand-600/25 transition-all duration-200 hover:-translate-y-px hover:shadow-lg hover:shadow-brand-600/30 active:translate-y-0 active:shadow-sm"
              :aria-expanded="showDemoPlanMenu"
              aria-haspopup="menu"
              @click="showDemoPlanMenu = !showDemoPlanMenu"
            >
              <Sparkles class="size-3.5 transition-transform duration-300 group-hover:rotate-12" />
              Get Started
              <ChevronDown class="size-3 opacity-70 transition-transform duration-200" :class="showDemoPlanMenu ? 'rotate-180' : ''" />
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
                v-if="showDemoPlanMenu"
                class="absolute right-0 top-[calc(100%+6px)] z-50 w-[420px] overflow-hidden rounded-xl border border-surface-200 bg-white shadow-2xl shadow-surface-900/10 dark:border-surface-700 dark:bg-surface-950 dark:shadow-black/40"
              >
                <div class="border-b border-surface-100 bg-gradient-to-br from-brand-50 to-violet-50 px-4 py-3 dark:border-surface-800 dark:from-brand-950/30 dark:to-violet-950/30">
                  <p class="text-sm font-semibold text-surface-950 dark:text-white">Start from the demo</p>
                  <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                    Create a workspace with the plan already selected.
                  </p>
                </div>
                <div class="p-3">
                  <DemoSignupOptions compact @select="showDemoPlanMenu = false" />
                </div>
              </div>
            </Transition>
          </div>

          <!-- Email verification pill (only while the signed-in user is unverified) -->
          <ClientOnly>
            <EmailVerificationPill
              v-if="session?.user && !session.user.emailVerified"
              :email="session.user.email"
            />
          </ClientOnly>

          <!-- Free-plan upgrade pill (hidden in demo, which has its own CTA) -->
          <ClientOnly>
            <FreePlanUpgradeMenu v-if="!isDemo" />
          </ClientOnly>

          <!-- New Job button (desktop) -->
          <button
            class="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 hover:shadow-md hover:shadow-brand-600/25 active:bg-brand-800 transition-all duration-200 border-0 cursor-pointer"
            @click="handleNewJobClick"
          >
            <Plus class="size-3.5" />
            New Job
          </button>

          <!-- Divider -->
          <div class="hidden sm:block w-px h-6 bg-surface-200 dark:bg-surface-700 mx-0.5" />

          <!-- User menu -->
          <div ref="userMenuRoot" class="relative">
            <button
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-100/80 dark:hover:bg-surface-800/60 transition-all duration-200 cursor-pointer border-0 bg-transparent"
              @click="showUserMenu = !showUserMenu"
            >
              <div class="flex items-center justify-center size-7 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white text-[11px] font-bold shadow-sm">
                {{ userInitials }}
              </div>
              <ChevronDown
                class="size-3 text-surface-400 transition-transform duration-200"
                :class="showUserMenu ? 'rotate-180' : ''"
              />
            </button>

            <!-- User dropdown -->
            <Transition
              enter-active-class="transition duration-150 ease-out"
              enter-from-class="opacity-0 scale-95 -translate-y-1"
              enter-to-class="opacity-100 scale-100 translate-y-0"
              leave-active-class="transition duration-100 ease-in"
              leave-from-class="opacity-100 scale-100 translate-y-0"
              leave-to-class="opacity-0 scale-95 -translate-y-1"
            >
              <div
                v-if="showUserMenu"
                class="absolute right-0 top-[calc(100%+6px)] w-64 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/8 dark:shadow-surface-950/30"
              >
                <!-- User info header -->
                <div class="rounded-t-xl overflow-hidden px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                  <div class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ userName }}</div>
                  <div class="text-xs text-surface-500 dark:text-surface-400 truncate mt-0.5">{{ userEmail }}</div>
                </div>

                <!-- Mobile-only items -->
                <div class="md:hidden border-b border-surface-100 dark:border-surface-800 py-1">
                  <NuxtLink
                    v-for="item in navItems"
                    :key="item.to"
                    :to="$localePath(item.to)"
                    class="flex items-center gap-2.5 px-4 py-2 text-sm text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-100 transition-colors no-underline"
                    :class="isActiveRoute(item.to, item.exact) ? 'text-brand-600 dark:text-brand-400 font-medium' : ''"
                  >
                    <component :is="item.icon" class="size-4" />
                    {{ item.label }}
                    <span
                      v-if="item.comingSoon"
                      class="ml-auto inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-200/60 dark:ring-amber-800/40"
                    >
                      Soon
                    </span>
                    <Lock
                      v-else-if="isNavLocked(item)"
                      class="ml-auto size-3 text-surface-400 dark:text-surface-500"
                    />
                  </NuxtLink>
                </div>

                <!-- Org switcher -->
                <div class="border-b border-surface-100 dark:border-surface-800 p-2">
                  <OrgSwitcher />
                </div>

                <!-- Preferences -->
                <div class="border-b border-surface-100 dark:border-surface-800 py-1">
                  <button
                    class="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-100 transition-colors cursor-pointer border-0 bg-transparent text-left"
                    @click="toggleColorMode"
                  >
                    <Sun v-if="isDark" class="size-4" />
                    <Moon v-else class="size-4" />
                    {{ isDark ? 'Light mode' : 'Dark mode' }}
                  </button>
                  <div class="flex items-center justify-between gap-2 px-4 py-2">
                    <span class="flex items-center gap-2.5 text-sm text-surface-600 dark:text-surface-400">
                      <Languages class="size-4" />
                      Language
                    </span>
                    <LanguageSwitcher drop-up />
                  </div>
                </div>

                <!-- Links -->
                <div class="border-b border-surface-100 dark:border-surface-800 py-1">
                  <NuxtLink
                    :to="$localePath('/dashboard/settings')"
                    class="flex items-center gap-2.5 px-4 py-2 text-sm transition-colors no-underline"
                    :class="isActiveRoute('/dashboard/settings', false)
                      ? 'text-brand-600 dark:text-brand-400 font-medium'
                      : 'text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-100'"
                  >
                    <Settings class="size-4" />
                    Settings
                  </NuxtLink>
                  <NuxtLink
                    :to="$localePath('/dashboard/updates')"
                    class="flex items-center gap-2.5 px-4 py-2 text-sm transition-colors no-underline"
                    :class="isActiveRoute('/dashboard/updates', false)
                      ? 'text-brand-600 dark:text-brand-400 font-medium'
                      : 'text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-100'"
                  >
                    <ArrowUpCircle class="size-4" />
                    Updates & changelog
                  </NuxtLink>
                  <button
                    v-if="isFeedbackEnabled"
                    class="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-100 transition-colors cursor-pointer border-0 bg-transparent text-left"
                    @click="showFeedbackModal = true; showUserMenu = false"
                  >
                    <MessageSquarePlus class="size-4" />
                    Report issue
                  </button>
                </div>

                <!-- Sign out -->
                <div class="rounded-b-xl overflow-hidden py-1">
                  <button
                    class="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-100 transition-colors cursor-pointer border-0 bg-transparent text-left"
                    :disabled="isSigningOut"
                    @click="handleSignOut"
                  >
                    <LogOut class="size-4" />
                    {{ isSigningOut ? 'Signing out…' : 'Sign out' }}
                  </button>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Mobile hamburger -->
          <button
            class="flex md:hidden items-center justify-center size-8 rounded-lg text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all duration-200 cursor-pointer border-0 bg-transparent"
            @click="showMobileMenu = !showMobileMenu"
          >
            <X v-if="showMobileMenu" class="size-4" />
            <Menu v-else class="size-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Job context sub-navigation bar -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
    >
      <div
        v-if="activeJobId"
        class="relative z-10 border-b border-surface-200/60 dark:border-surface-800/60 bg-surface-50/90 dark:bg-surface-950/90 backdrop-blur-lg"
      >
        <div class="flex items-center gap-2 sm:gap-4 px-3 sm:px-4 lg:px-6 h-10 overflow-x-auto scrollbar-none">
          <NuxtLink
            :to="$localePath('/dashboard/jobs')"
            class="hidden sm:flex items-center gap-1 text-xs font-medium text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 transition-colors no-underline shrink-0"
          >
            <ChevronLeft class="size-3.5" />
            All Jobs
          </NuxtLink>

          <div class="hidden sm:block w-px h-4 bg-surface-200 dark:bg-surface-700 shrink-0" />

          <div class="hidden md:flex items-center gap-2 shrink-0 min-w-0">
            <Briefcase class="size-3.5 text-brand-500 shrink-0" />
            <span class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate max-w-48">
              {{ activeJobTitle }}
            </span>
            <span
              v-if="activeJobStatus"
              class="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize ring-1 ring-inset"
              :class="jobStatusBadgeClasses[activeJobStatus] ?? 'bg-surface-50 text-surface-600 ring-surface-200'"
            >
              {{ activeJobStatus }}
            </span>
          </div>

          <nav class="flex items-center gap-0.5 md:ml-2">
            <NuxtLink
              v-for="tab in jobTabs"
              :key="tab.to"
              :to="$localePath(tab.to)"
              class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200 no-underline whitespace-nowrap shrink-0"
              :class="isActiveRoute(tab.to, tab.exact)
                ? 'bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 shadow-sm'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-white/60 dark:hover:bg-surface-800/60'"
            >
              <component :is="tab.icon" class="size-3.5" />
              <span class="hidden sm:inline">{{ tab.label }}</span>
            </NuxtLink>
          </nav>

          <div class="ml-auto flex items-center gap-2 shrink-0">
            <div id="job-sub-nav-actions" class="flex items-center gap-2" />
          </div>
        </div>
      </div>
    </Transition>

    <!-- Mobile navigation menu -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div
        v-if="showMobileMenu"
        class="relative z-10 md:hidden border-b border-surface-200 dark:border-surface-800 bg-white/95 dark:bg-surface-900/95 backdrop-blur-xl"
      >
        <nav class="px-4 py-3 flex flex-col gap-1">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="$localePath(item.to)"
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all no-underline"
            :class="isActiveRoute(item.to, item.exact)
              ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
              : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'"
          >
            <component :is="item.icon" class="size-4" />
            {{ item.label }}
            <span
              v-if="item.comingSoon"
              class="ml-auto inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-200/60 dark:ring-amber-800/40"
            >
              Soon
            </span>
            <Lock
              v-else-if="isNavLocked(item)"
              class="ml-auto size-3.5 text-surface-400 dark:text-surface-500"
            />
          </NuxtLink>

          <button
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors sm:hidden mt-1 border-0 cursor-pointer w-full"
            @click="handleNewJobClick(); showMobileMenu = false"
          >
            <Plus class="size-4" />
            New Job
          </button>

          <!-- Get Started CTA (demo mode, mobile) -->
          <template v-if="isDemo">
            <div class="mt-2 pt-2 border-t border-surface-200 dark:border-surface-700">
              <p class="px-3 mb-1.5 text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Get Started</p>
              <DemoSignupOptions compact @select="showMobileMenu = false" />
            </div>
          </template>
        </nav>

        <div class="px-4 pb-3 flex flex-col gap-2 border-t border-surface-100 dark:border-surface-800 pt-3 lg:hidden">
          <OrgSwitcher />
          <LanguageSwitcher drop-up />
        </div>
      </div>
    </Transition>
  </header>

  <!-- Feedback modal -->
  <FeedbackModal v-if="showFeedbackModal" @close="showFeedbackModal = false" />
</template>
