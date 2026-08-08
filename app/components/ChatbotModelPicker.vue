<script setup lang="ts">
/**
 * ChatbotModelPicker
 *
 * Sibling of ChatbotAgentPicker. Chooses what powers the next message, from one
 * flat menu with two halves:
 *
 *   - **Reqcore AI** — the vetted catalogue (`shared/chatbot-models.ts`), grouped
 *     by lab, three tiers each. These run on the platform key and spend the org's
 *     assistant credits, so each carries its credit multiplier.
 *   - **Your own keys** — the org's BYOK configs, billed by their provider, not
 *     in credits. They bring their own model id, so no multiplier applies.
 *
 * The two halves are one list because they answer the same question ("which
 * brain?"), and because picking a catalogue model *is* picking the platform
 * engine — splitting them into two controls would make that coupling invisible.
 *
 * Multipliers are relative to the default model and shown as "about N×": the
 * real charge is metered from the turn's own tokens (see `creditMultiplier`).
 * Intelligence rescales the top 20% of the supplied LM Arena text leader's
 * score onto 0–100. It is a relative benchmark indicator, not a claim that
 * general intelligence can be measured as an absolute percentage.
 */
import { Brain, Check, ChevronUp, Settings, Star, AlertTriangle, KeyRound } from 'lucide-vue-next'
import { PLATFORM_ENGINE_ID } from '~~/shared/chatbot'
import {
  CHATBOT_MODEL_TIER_LABELS,
  CHATBOT_MODEL_VENDOR_LABELS,
  chatbotModelChoices,
  type ChatbotModelChoice,
  type ChatbotModelVendor,
} from '~~/shared/chatbot-models'

const {
  aiConfigs,
  selectedAiConfigId,
  selectedModel,
  selectedModelChoice,
  defaultModel,
  setDefaultModel,
  platformAiConfig,
  platformEngineActive,
  currentConversationId,
  updateConversation,
} = useChatbot()
const emit = defineEmits<{ manage: [] }>()

const open = ref(false)
const root = useTemplateRef<HTMLDivElement>('root')

const selectedConfig = computed(() =>
  aiConfigs.value.find((c) => c.id === selectedAiConfigId.value) ?? null,
)
const defaultChatbotConfig = computed(() => aiConfigs.value.find((c) => c.isDefaultChatbot) ?? null)

/** Catalogue models are only offered when the platform engine is usable at all. */
const platformAvailable = computed(() =>
  Boolean(platformAiConfig.value) && platformAiConfig.value?.isEnabled !== false,
)

/**
 * A BYOK config's provider mapped onto a catalogue vendor, so the org's own
 * OpenAI key shows the same mark as the platform's OpenAI models. Returns null
 * for providers with no lab of their own (`openrouter`, custom endpoints) —
 * those keep the generic key icon rather than borrowing someone's brand.
 */
const BYOK_PROVIDER_VENDORS: Record<string, ChatbotModelVendor> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  xai: 'xai',
}

function byokVendor(provider: string): ChatbotModelVendor | null {
  return BYOK_PROVIDER_VENDORS[provider] ?? null
}

const modelsByVendor = computed(() => {
  const groups = new Map<ChatbotModelVendor, ChatbotModelChoice[]>()
  for (const model of chatbotModelChoices()) {
    const list = groups.get(model.vendor) ?? []
    list.push(model)
    groups.set(model.vendor, list)
  }
  return [...groups.entries()]
})

const label = computed(() => {
  if (selectedModelChoice.value) return selectedModelChoice.value.label
  if (platformEngineActive.value) return 'Reqcore AI'
  if (selectedConfig.value) return selectedConfig.value.name
  if (defaultChatbotConfig.value) return `Default · ${defaultChatbotConfig.value.name}`
  return 'Default model'
})

function formatMultiplier(multiplier: number): string {
  // Trim "1.0×" to "1×" but keep "2.4×" — a trailing .0 reads as false precision.
  const text = multiplier % 1 === 0 ? String(multiplier) : multiplier.toFixed(1)
  return `${text}×`
}

/**
 * Persist the choice so the conversation keeps this engine after a reload. Both
 * fields always travel together: a model without its engine, or an engine
 * without its model, is how the two drift apart.
 */
async function apply(aiConfigId: string | null, model: string | null) {
  const previousAiConfigId = selectedAiConfigId.value
  const previousModel = selectedModel.value
  selectedAiConfigId.value = aiConfigId
  selectedModel.value = model
  open.value = false
  if (currentConversationId.value) {
    const updated = await updateConversation(currentConversationId.value, { aiConfigId, model })
    if (!updated) {
      selectedAiConfigId.value = previousAiConfigId
      selectedModel.value = previousModel
    }
  }
}

/**
 * Star or unstar a model for future chats. This deliberately does not change
 * the current conversation: selection and default are separate controls, and
 * changing a default must not silently swap the model mid-thread.
 */
async function toggleDefault(modelId: string) {
  const clearing = defaultModel.value === modelId
  await setDefaultModel(clearing ? null : modelId)
}

function onWindowClick(e: MouseEvent) {
  if (!root.value) return
  if (!root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => window.addEventListener('click', onWindowClick))
onUnmounted(() => window.removeEventListener('click', onWindowClick))
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2.5 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-200 hover:border-brand-300 dark:hover:border-brand-700 cursor-pointer transition-colors"
      :title="selectedModelChoice?.description ?? selectedConfig?.model ?? defaultChatbotConfig?.model ?? 'No model configured'"
      @click="open = !open"
    >
      <ChatbotVendorIcon
        v-if="selectedModelChoice"
        :vendor="selectedModelChoice.vendor"
        class="size-3.5 shrink-0 text-surface-700 dark:text-surface-200"
      />
      <Brain v-else class="size-3.5 text-brand-500" />
      <span class="max-w-[160px] truncate">{{ label }}</span>
      <span
        v-if="selectedModelChoice"
        class="rounded bg-surface-100 dark:bg-surface-800 px-1 py-0.5 text-[10px] font-semibold text-surface-500 dark:text-surface-400"
      >{{ formatMultiplier(selectedModelChoice.multiplier) }}</span>
      <ChevronUp class="size-3 transition-transform" :class="open ? '' : 'rotate-180'" />
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-30 mb-2 w-80 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg py-1 max-h-[60vh] overflow-y-auto"
    >
      <!-- Default entry -->
      <button
        type="button"
        class="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer border-0 bg-transparent"
        @click="apply(null, null)"
      >
        <Check
          class="size-3.5 mt-0.5 shrink-0"
          :class="selectedAiConfigId === null ? 'text-brand-500' : 'invisible'"
        />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-surface-800 dark:text-surface-100">
            Org default
          </div>
          <div class="text-[11px] text-surface-500 truncate">
            <template v-if="defaultChatbotConfig">
              Currently {{ defaultChatbotConfig.name }} · <span class="font-mono">{{ defaultChatbotConfig.model }}</span>
            </template>
            <template v-else-if="platformAvailable">
              Reqcore AI, recommended model
            </template>
            <template v-else>
              No default configured yet
            </template>
          </div>
        </div>
      </button>

      <!-- Reqcore AI catalogue — platform-paid, metered in credits. -->
      <template v-if="platformAvailable">
        <div class="mt-1 border-t border-surface-200 dark:border-surface-800 px-3 pt-2 pb-1">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-surface-500">
            Reqcore AI
          </div>
          <p class="mt-0.5 text-[11px] leading-snug text-surface-500">
            Included in your plan. The multiplier is roughly how fast a model spends your assistant credits.
          </p>
          <p class="mt-0.5 text-[11px] leading-snug text-surface-500">
            Intelligence rescales the top 20% of LM Arena text scores to 0–100%.
          </p>
        </div>

        <template v-for="[vendor, models] in modelsByVendor" :key="vendor">
          <div class="flex items-center gap-1.5 px-3 pt-2 pb-1">
            <ChatbotVendorIcon :vendor="vendor" class="size-3 shrink-0 text-surface-500 dark:text-surface-400" />
            <span class="text-[10px] font-semibold uppercase tracking-wide text-surface-400">
              {{ CHATBOT_MODEL_VENDOR_LABELS[vendor] }}
            </span>
          </div>
          <!--
            Row and star are siblings, not nested: a button inside a button is
            invalid HTML and browsers recover from it unpredictably.
          -->
          <div
            v-for="m in models"
            :key="m.id"
            class="group flex w-full items-start hover:bg-surface-100 dark:hover:bg-surface-800"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-start gap-2 py-2 pl-3 text-left cursor-pointer border-0 bg-transparent"
              :title="m.id"
              @click="apply(PLATFORM_ENGINE_ID, m.id)"
            >
              <Check
                class="size-3.5 mt-0.5 shrink-0"
                :class="selectedModelChoice?.id === m.id ? 'text-brand-500' : 'invisible'"
              />
              <ChatbotVendorIcon
                :vendor="m.vendor"
                class="size-4 mt-0.5 shrink-0 text-surface-700 dark:text-surface-200"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-sm font-medium text-surface-800 dark:text-surface-100">{{ m.label }}</span>
                  <span
                    class="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold"
                    :class="m.intelligence !== null
                      ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
                      : 'bg-surface-100 dark:bg-surface-800 text-surface-400'"
                    :title="m.intelligence !== null
                      ? `Intelligence: ${m.intelligence.toFixed(1)}% on the normalized LM Arena text scale (${m.arenaTextScore} score)`
                      : 'Intelligence unrated: no matching LM Arena text row was supplied'"
                  >
                    <Brain class="size-2.5" />
                    {{ m.intelligence !== null ? `${m.intelligence.toFixed(1)}%` : 'Unrated' }}
                  </span>
                  <span class="shrink-0 rounded bg-surface-100 dark:bg-surface-800 px-1 py-0.5 text-[10px] font-semibold text-surface-500 dark:text-surface-400">
                    about {{ formatMultiplier(m.multiplier) }}
                  </span>
                </div>
                <div class="text-[11px] leading-snug text-surface-500">
                  {{ CHATBOT_MODEL_TIER_LABELS[m.tier] }} · {{ m.description }}
                </div>
              </div>
            </button>
            <!-- A separate sibling button keeps the star usable on touch. -->
            <button
              type="button"
              class="shrink-0 self-stretch px-2.5 py-2 cursor-pointer border-0 bg-transparent focus-visible:outline-2 focus-visible:outline-brand-500"
              :class="defaultModel === m.id ? 'opacity-100' : 'opacity-60 hover:opacity-100'"
              :title="defaultModel === m.id ? 'Default for new chats — click to clear' : 'Make default for new chats'"
              :aria-label="defaultModel === m.id ? `${m.label} is the default for new chats. Clear it.` : `Make ${m.label} the default for new chats`"
              :aria-pressed="defaultModel === m.id"
              @click="toggleDefault(m.id)"
            >
              <Star
                class="size-3.5 mt-0.5"
                :class="defaultModel === m.id
                  ? 'fill-warning-400 text-warning-500'
                  : 'text-surface-400 hover:text-warning-500'"
              />
            </button>
          </div>
        </template>
      </template>

      <!-- BYOK configs — billed by the org's own provider, not in credits. -->
      <template v-if="aiConfigs.length">
        <div class="mt-1 border-t border-surface-200 dark:border-surface-800 px-3 pt-2 pb-1">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-surface-500">
            Your own API keys
          </div>
        </div>
        <button
          v-for="c in aiConfigs"
          :key="c.id"
          type="button"
          class="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer border-0 bg-transparent"
          :disabled="!c.hasApiKey"
          :class="!c.hasApiKey ? 'opacity-60 cursor-not-allowed' : ''"
          :title="!c.hasApiKey ? 'Missing API key' : c.model"
          @click="c.hasApiKey ? apply(c.id, null) : null"
        >
          <Check
            class="size-3.5 mt-0.5 shrink-0"
            :class="selectedAiConfigId === c.id ? 'text-brand-500' : 'invisible'"
          />
          <ChatbotVendorIcon
            v-if="byokVendor(c.provider)"
            :vendor="byokVendor(c.provider)!"
            class="size-4 mt-0.5 shrink-0 text-surface-700 dark:text-surface-200"
          />
          <KeyRound v-else class="size-4 mt-0.5 shrink-0 text-surface-400" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1">
              <span class="truncate text-sm font-medium text-surface-800 dark:text-surface-100">{{ c.name }}</span>
              <Star v-if="c.isDefaultChatbot" class="size-3 shrink-0 text-warning-500" />
              <AlertTriangle v-if="!c.hasApiKey" class="size-3 shrink-0 text-danger-500" />
            </div>
            <div class="truncate text-[11px] text-surface-500 font-mono">{{ c.model }}</div>
          </div>
        </button>
      </template>

      <div class="my-1 border-t border-surface-200 dark:border-surface-800" />
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/30 cursor-pointer border-0 bg-transparent"
        @click="open = false; emit('manage')"
      >
        <Settings class="size-3.5" />
        Manage models…
      </button>
    </div>
  </div>
</template>
