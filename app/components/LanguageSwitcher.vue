<script setup lang="ts">
import { Check, ChevronDown } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  dropUp?: boolean
  /**
   * Horizontal edge the menu aligns to. Defaults follow `dropUp` for backwards
   * compatibility (drop-up menus align left, drop-down menus align right). Set
   * explicitly when the trigger sits near a screen edge so the menu opens
   * inward instead of off-screen.
   */
  align?: 'left' | 'right'
  /** Show the translated "Language" label next to the trigger. */
  showLabel?: boolean
  /** Use the configured language name in the trigger instead of only the code. */
  showName?: boolean
  /** Slightly larger, higher-contrast trigger for pages where language choice matters. */
  prominent?: boolean
}>(), {
  dropUp: false,
  showLabel: false,
  showName: false,
  prominent: false,
})

const preferredHorizontalAlign = computed(() =>
  props.align ?? (props.dropUp ? 'left' : 'right'),
)
const renderedHorizontalAlign = ref<'left' | 'right'>(preferredHorizontalAlign.value)
const menuOffsetX = ref(0)
const renderedDropUp = ref(props.dropUp)
const menuMaxHeight = ref<number | null>(null)

const route = useRoute()
const requestURL = useRequestURL()
const { locale, locales, t } = useI18n()

const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)

function closeDropdown() {
  isOpen.value = false
}

function updateMenuPlacement() {
  if (!import.meta.client || !isOpen.value || !dropdownRef.value || !menuRef.value) return

  const triggerRect = dropdownRef.value.getBoundingClientRect()
  const menuRect = menuRef.value.getBoundingClientRect()
  const viewportPadding = 8
  const menuWidth = menuRect.width
  const wouldFitLeftAligned = triggerRect.left + menuWidth <= window.innerWidth - viewportPadding
  const wouldFitRightAligned = triggerRect.right - menuWidth >= viewportPadding

  // Prefer the alignment that keeps the menu on-screen without shifting.
  if (preferredHorizontalAlign.value === 'left' && !wouldFitLeftAligned && wouldFitRightAligned) {
    renderedHorizontalAlign.value = 'right'
  }
  else if (preferredHorizontalAlign.value === 'right' && !wouldFitRightAligned && wouldFitLeftAligned) {
    renderedHorizontalAlign.value = 'left'
  }
  else {
    renderedHorizontalAlign.value = preferredHorizontalAlign.value
  }

  // Even the chosen alignment can overflow when the trigger sits inside a
  // narrow popup near a screen edge (e.g. the user menu). Nudge the menu back
  // into the viewport so it never renders off-screen.
  const menuLeft = renderedHorizontalAlign.value === 'left'
    ? triggerRect.left
    : triggerRect.right - menuWidth
  const menuRight = menuLeft + menuWidth
  const overflowRight = menuRight - (window.innerWidth - viewportPadding)
  const overflowLeft = viewportPadding - menuLeft

  if (overflowRight > 0) {
    menuOffsetX.value = -overflowRight
  }
  else if (overflowLeft > 0) {
    menuOffsetX.value = overflowLeft
  }
  else {
    menuOffsetX.value = 0
  }

  // Vertical placement: a drop-up trigger sitting near the top of the window
  // (e.g. inside the top bar user menu) would otherwise open off-screen, and a
  // drop-down trigger near the bottom has the mirror problem.
  const menuGap = 4 // matches the mt-1 / mb-1 offset below
  const naturalHeight = Math.max(menuRef.value.scrollHeight, menuRect.height)
  const spaceAbove = triggerRect.top - viewportPadding - menuGap
  const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding - menuGap

  if (props.dropUp && naturalHeight > spaceAbove && naturalHeight <= spaceBelow) {
    renderedDropUp.value = false
  }
  else if (!props.dropUp && naturalHeight > spaceBelow && naturalHeight <= spaceAbove) {
    renderedDropUp.value = true
  }
  else {
    // Neither side fits outright: keep the preferred side, but favour the
    // roomier one so the clamped menu shows as many options as possible.
    renderedDropUp.value = naturalHeight > spaceAbove && naturalHeight > spaceBelow
      ? spaceAbove > spaceBelow
      : props.dropUp
  }

  const availableHeight = renderedDropUp.value ? spaceAbove : spaceBelow
  menuMaxHeight.value = naturalHeight > availableHeight
    ? Math.max(availableHeight, 120)
    : null
}

watch(preferredHorizontalAlign, async (nextAlign) => {
  renderedHorizontalAlign.value = nextAlign
  if (!isOpen.value) return
  await nextTick()
  updateMenuPlacement()
})

watch(() => props.dropUp, async (nextDropUp) => {
  renderedDropUp.value = nextDropUp
  if (!isOpen.value) return
  await nextTick()
  updateMenuPlacement()
})

watch(isOpen, async (open) => {
  if (!open) {
    menuOffsetX.value = 0
    menuMaxHeight.value = null
    return
  }
  renderedHorizontalAlign.value = preferredHorizontalAlign.value
  renderedDropUp.value = props.dropUp
  await nextTick()
  updateMenuPlacement()
})

const menuStyle = computed(() => {
  const style: Record<string, string> = {}
  if (menuOffsetX.value) style.transform = `translateX(${menuOffsetX.value}px)`
  if (menuMaxHeight.value !== null) style.maxHeight = `${menuMaxHeight.value}px`
  return Object.keys(style).length ? style : undefined
})

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
  window.addEventListener('resize', updateMenuPlacement)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  window.removeEventListener('resize', updateMenuPlacement)
})
const localePath = useLocalePath()
const switchLocalePath = useSwitchLocalePath()
type SwitchLocale = Parameters<typeof switchLocalePath>[0]

type LocaleParam = string | string[] | undefined
type RouteName = string | symbol | null | undefined

const localeFlags: Record<string, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
  fr: '🇫🇷',
  de: '🇩🇪',
  vi: '🇻🇳',
  nb: '🇳🇴',
}

type LocaleEntry = string | { code?: string | null, name?: string | null }

function getLocaleCode(entry: LocaleEntry): string | null {
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry.code !== 'string') return null
  return entry.code
}

function getLocaleName(entry: LocaleEntry, code: string): string {
  if (typeof entry !== 'string' && typeof entry.name === 'string' && entry.name.trim()) {
    return entry.name
  }
  return code.toUpperCase()
}

function getLocaleFromRouteParam(value: LocaleParam): string | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' ? candidate : null
}

function getFirstPathSegment(path: string): string | null {
  return path.split('?')[0]?.split('/').filter(Boolean)[0] ?? null
}

function normalizePath(path: string | null | undefined): string {
  if (!path) return '/'
  const [withoutQuery = '/'] = path.split('?')
  const [withoutHash = '/'] = withoutQuery.split('#')
  const trimmed = withoutHash.replace(/\/+$/, '')
  return trimmed || '/'
}

function getLocaleFromRouteName(name: RouteName): string | null {
  if (typeof name !== 'string') return null
  const parts = name.split('___')
  return parts[1] ?? null
}

type LocaleWithPartial = { code?: string | null, partial?: boolean }

const localeOptions = computed(() => {
  return locales.value
    .map((entry) => {
      const code = getLocaleCode(entry as LocaleEntry)
      const partial = (entry as LocaleWithPartial).partial === true
      return code ? { code, partial, name: getLocaleName(entry as LocaleEntry, code) } : null
    })
    .filter((item): item is { code: string, partial: boolean, name: string } => !!item)
    .map(({ code, partial, name }) => ({
      code,
      partial,
      name,
      flag: localeFlags[code] ?? '🌐',
    }))
})

function isSwitchLocale(code: string): code is SwitchLocale {
  return localeOptions.value.some(option => option.code === code)
}

const resolvedLocaleCode = computed(() => {
  const currentPath = normalizePath(
    import.meta.client ? window.location.pathname : requestURL.pathname,
  )
  const matchedBySwitchPath = localeOptions.value.find((option) => {
    const localizedPath = switchLocalePath(option.code as SwitchLocale)
    return normalizePath(localizedPath) === currentPath
  })
  if (matchedBySwitchPath) {
    return matchedBySwitchPath.code
  }

  const routeNameLocale = getLocaleFromRouteName(route.name)
  if (routeNameLocale && localeOptions.value.some(option => option.code === routeNameLocale)) {
    return routeNameLocale
  }

  const routeLocale = getLocaleFromRouteParam(route.params?.locale as LocaleParam)
  if (routeLocale && localeOptions.value.some(option => option.code === routeLocale)) {
    return routeLocale
  }

  const routePathLocale = getFirstPathSegment(route.path)
  if (routePathLocale && localeOptions.value.some(option => option.code === routePathLocale)) {
    return routePathLocale
  }

  const routeFullPathLocale = getFirstPathSegment(route.fullPath)
  if (routeFullPathLocale && localeOptions.value.some(option => option.code === routeFullPathLocale)) {
    return routeFullPathLocale
  }

  const requestPathLocale = getFirstPathSegment(requestURL.pathname)
  if (requestPathLocale && localeOptions.value.some(option => option.code === requestPathLocale)) {
    return requestPathLocale
  }

  const localeCode = String(locale.value)
  if (localeOptions.value.some(option => option.code === localeCode)) {
    return localeCode
  }

  return localeOptions.value[0]?.code ?? ''
})

const selectedLocaleCode = computed({
  get: () => resolvedLocaleCode.value,
  set: (nextLocale: string) => {
    void handleLocaleChange(nextLocale)
  },
})

const selectedLocaleOption = computed(() =>
  localeOptions.value.find(option => option.code === selectedLocaleCode.value),
)

const selectedLocaleDisplay = computed(() =>
  props.showName
    ? (selectedLocaleOption.value?.name ?? selectedLocaleCode.value.toUpperCase())
    : selectedLocaleCode.value,
)

const showI18nProbe = computed(() => {
  const i18nTestQuery = route.query.i18nTest
  if (Array.isArray(i18nTestQuery)) return i18nTestQuery.includes('1')
  return i18nTestQuery === '1'
})

const i18nProbeText = computed(() => t('common.language'))

async function handleLocaleChange(nextLocale: string) {
  if (!nextLocale || nextLocale === selectedLocaleCode.value) {
    closeDropdown()
    return
  }
  if (!isSwitchLocale(nextLocale)) return
  closeDropdown()
  const switchPath = switchLocalePath(nextLocale)
  await navigateTo(switchPath || localePath('/'))
}
</script>

<template>
  <div class="flex items-center gap-2">
    <span
      v-if="showI18nProbe"
      data-testid="i18n-probe"
      class="text-xs font-medium text-surface-500 dark:text-surface-400"
    >
      {{ i18nProbeText }}
    </span>
    <span
      v-else-if="props.showLabel"
      class="text-xs font-medium text-surface-500 dark:text-surface-400"
    >
      {{ t('common.language') }}
    </span>

    <div ref="dropdownRef" class="relative">
      <!-- Trigger button -->
      <button
        type="button"
        :aria-label="t('common.selectLanguage')"
        :aria-expanded="isOpen"
        aria-haspopup="listbox"
        class="flex items-center gap-1.5 border outline-none transition-colors focus:border-brand-500/70 focus:text-surface-800 dark:focus:text-surface-100"
        :class="props.prominent
          ? 'h-10 rounded-lg border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 text-sm font-semibold text-surface-800 dark:text-surface-100 shadow-sm hover:border-surface-400 dark:hover:border-surface-600'
          : 'h-8 rounded-md border-surface-300/45 dark:border-surface-700/55 bg-transparent px-2 text-xs font-medium lowercase text-surface-500 dark:text-surface-400 hover:border-surface-400/60 hover:text-surface-700 dark:hover:border-surface-600 dark:hover:text-surface-200'"
        @click="isOpen = !isOpen"
      >
        <span>{{ selectedLocaleOption?.flag ?? '🌐' }} {{ selectedLocaleDisplay }}</span>
        <ChevronDown class="size-3 opacity-60 transition-transform duration-150" :class="{ 'rotate-180': isOpen }" />
      </button>

      <!-- Dropdown list -->
      <ul
        v-if="isOpen"
        ref="menuRef"
        role="listbox"
        :aria-label="t('common.selectLanguage')"
        class="absolute z-50 w-48 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg py-1 text-xs"
        :class="[
          renderedDropUp ? 'bottom-full mb-1' : 'top-full mt-1',
          renderedHorizontalAlign === 'left' ? 'left-0' : 'right-0',
        ]"
        :style="menuStyle"
      >
        <li
          v-for="option in localeOptions"
          :key="option.code"
          role="option"
          :aria-selected="option.code === selectedLocaleCode"
          class="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 transition-colors"
          :class="option.code === selectedLocaleCode
            ? 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100'
            : 'text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800'"
          @click="handleLocaleChange(option.code)"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span>{{ option.flag }}</span>
            <span class="min-w-0">
              <span class="block truncate font-medium">{{ option.name }}</span>
              <span class="block text-[10px] uppercase text-surface-400">{{ option.code }}</span>
            </span>
          </span>
          <Check
            v-if="option.code === selectedLocaleCode"
            class="size-3.5 shrink-0 text-brand-600 dark:text-brand-400"
          />
          <span
            v-else-if="option.partial"
            class="rounded bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400"
            title="Translation incomplete"
          >
            partial
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
