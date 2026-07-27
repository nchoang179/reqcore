<script setup lang="ts">
/**
 * Job location picker.
 *
 * The whole point is that typing never commits a value — only picking a result
 * does. A recruiter can type anything, but what lands in the model is always a
 * real place from the bundled dataset, with an ISO country code the job board
 * feed can actually index. Blurring with unmatched text restores the last valid
 * selection rather than keeping the typed string.
 */
import { Loader2, MapPin, Search, X } from 'lucide-vue-next'
import { formatJobLocation } from '~~/shared/job-location'

export interface LocationSelection {
  city: string | null
  region: string | null
  /** ISO 3166-1 alpha-2. */
  country: string
}

interface GeoPlace extends LocationSelection {
  id: string
  countryName: string
  label: string
}

const props = withDefaults(defineProps<{
  id?: string
  /** Renders the error border/ring treatment used elsewhere in the job forms. */
  invalid?: boolean
  disabled?: boolean
  placeholder?: string
}>(), {
  id: 'location',
  invalid: false,
  disabled: false,
  placeholder: 'Search for a city or country…',
})

const model = defineModel<LocationSelection | null>({ default: null })

const query = ref('')
const debouncedQuery = ref('')
const isOpen = ref(false)
const activeIndex = ref(-1)
const rootRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const dropUp = ref(false)

/** The text a committed selection displays as. */
const selectedLabel = computed(() => formatJobLocation(model.value))

// Same 300 ms debounce the other typeaheads use. The min-length guard keeps a
// single keystroke from matching several thousand places.
let debounceTimer: ReturnType<typeof setTimeout>
watch(query, (val) => {
  clearTimeout(debounceTimer)
  const trimmed = val.trim()
  debounceTimer = setTimeout(() => {
    debouncedQuery.value = trimmed.length >= 2 ? trimmed : ''
  }, 300)
})

const { data, status } = useFetch<GeoPlace[]>('/api/geo/locations', {
  key: 'geo-location-search',
  query: computed(() => ({ q: debouncedQuery.value })),
  headers: useRequestHeaders(['cookie']),
  immediate: false,
  default: () => [],
})

const results = computed(() => (debouncedQuery.value ? data.value ?? [] : []))
const isSearching = computed(() => status.value === 'pending')
const showEmptyState = computed(() =>
  isOpen.value && !isSearching.value && !!debouncedQuery.value && results.value.length === 0,
)

watch(results, () => {
  activeIndex.value = results.value.length ? 0 : -1
})

/**
 * Open upwards when the field sits low in the viewport — the picker is used
 * near the bottom of a long wizard step, where a downward list would be clipped.
 */
function updatePlacement() {
  if (!import.meta.client || !rootRef.value) return
  const rect = rootRef.value.getBoundingClientRect()
  dropUp.value = window.innerHeight - rect.bottom < 260 && rect.top > 260
}

function open() {
  if (props.disabled) return
  isOpen.value = true
  updatePlacement()
}

/** Discard whatever was typed and fall back to the committed selection. */
function close() {
  isOpen.value = false
  activeIndex.value = -1
  query.value = selectedLabel.value
  debouncedQuery.value = ''
}

function select(place: GeoPlace) {
  model.value = { city: place.city, region: place.region, country: place.country }
  query.value = place.label
  debouncedQuery.value = ''
  isOpen.value = false
  activeIndex.value = -1
}

function clear() {
  model.value = null
  query.value = ''
  debouncedQuery.value = ''
  activeIndex.value = -1
  inputRef.value?.focus()
}

function moveActive(delta: number) {
  if (!results.value.length) return
  const next = activeIndex.value + delta
  activeIndex.value = (next + results.value.length) % results.value.length
  nextTick(() => {
    listRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!isOpen.value) return open()
    return moveActive(event.key === 'ArrowDown' ? 1 : -1)
  }
  if (event.key === 'Enter') {
    const place = results.value[activeIndex.value]
    if (isOpen.value && place) {
      // Only swallow Enter when it actually picks something, so it still
      // submits the surrounding form otherwise.
      event.preventDefault()
      select(place)
    }
    return
  }
  if (event.key === 'Escape' && isOpen.value) {
    event.preventDefault()
    close()
  }
}

function onClickOutside(event: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) close()
}

// Keep the input in step with the model when a parent hydrates it — the job
// settings page fills this in only once the job has loaded.
watch(selectedLabel, (label) => {
  if (!isOpen.value) query.value = label
}, { immediate: true })

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside)
  window.addEventListener('resize', updatePlacement)
})
onUnmounted(() => {
  clearTimeout(debounceTimer)
  document.removeEventListener('mousedown', onClickOutside)
  window.removeEventListener('resize', updatePlacement)
})

const listboxId = computed(() => `${props.id}-listbox`)
const optionId = (index: number) => `${props.id}-option-${index}`
</script>

<template>
  <div ref="rootRef" class="relative">
    <div class="relative">
      <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-surface-400" />
      <input
        :id="id"
        ref="inputRef"
        v-model="query"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-haspopup="listbox"
        :aria-expanded="isOpen"
        :aria-controls="listboxId"
        :aria-activedescendant="activeIndex >= 0 ? optionId(activeIndex) : undefined"
        :disabled="disabled"
        :placeholder="placeholder"
        class="w-full rounded-lg border py-2.5 pl-9 pr-9 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors disabled:opacity-60"
        :class="invalid ? 'border-danger-300 ring-1 ring-danger-100' : 'border-surface-300 dark:border-surface-700'"
        @focus="open"
        @input="open"
        @keydown="onKeydown"
      />
      <Loader2 v-if="isSearching" class="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-surface-400" />
      <button
        v-else-if="model"
        type="button"
        aria-label="Clear selected place"
        class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
        @click="clear"
      >
        <X class="size-4" />
      </button>
    </div>

    <ul
      v-if="isOpen && (results.length || showEmptyState)"
      :id="listboxId"
      ref="listRef"
      role="listbox"
      class="absolute z-30 max-h-64 w-full overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 py-1 shadow-lg"
      :class="dropUp ? 'bottom-full mb-1' : 'top-full mt-1'"
    >
      <li
        v-for="(place, index) in results"
        :id="optionId(index)"
        :key="place.id"
        role="option"
        :aria-selected="index === activeIndex"
        :data-active="index === activeIndex"
        class="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-surface-800 dark:text-surface-200"
        :class="index === activeIndex ? 'bg-surface-100 dark:bg-surface-800' : ''"
        @mouseenter="activeIndex = index"
        @mousedown.prevent="select(place)"
      >
        <MapPin class="size-3.5 shrink-0 text-surface-400" />
        <span class="truncate">{{ place.label }}</span>
      </li>
      <li v-if="showEmptyState" class="px-3 py-2 text-sm text-surface-500 dark:text-surface-400">
        No place matches “{{ debouncedQuery }}”.
      </li>
    </ul>
  </div>
</template>
