<script setup lang="ts">
/**
 * Always-visible email-verification entry point in the dashboard top bar.
 *
 * Verification is deferred to outbound actions (sending messages/invitations),
 * so this is an ambient account-status affordance, not a blocking alert — it
 * sits beside the upgrade pill and opens a popover with the resend flow. The
 * parent gates rendering to unverified users, so no top-level await here (it
 * renders inside the already-async top bar without a Suspense of its own).
 */
import { Check, Loader2, MailWarning, RefreshCw } from 'lucide-vue-next'

const props = defineProps<{ email: string }>()

const route = useRoute()
const { open, show, hide, close } = useHoverPopover()
watch(() => route.path, close)

const resendState = ref<'idle' | 'sending' | 'sent'>('idle')
const resendError = ref('')
let resendResetTimer: ReturnType<typeof setTimeout> | undefined

async function resendVerification() {
  if (!props.email || resendState.value === 'sending') return

  resendState.value = 'sending'
  resendError.value = ''

  try {
    const result = await authClient.sendVerificationEmail({
      email: props.email,
      callbackURL: route.fullPath,
    })
    if (result.error) throw new Error(result.error.message ?? 'Verification email could not be sent.')
    resendState.value = 'sent'
    resendResetTimer = setTimeout(() => {
      resendState.value = 'idle'
    }, 30_000)
  }
  catch (error) {
    resendState.value = 'idle'
    resendError.value = error instanceof Error
      ? error.message
      : 'Verification email could not be sent.'
  }
}

onBeforeUnmount(() => clearTimeout(resendResetTimer))
</script>

<template>
  <div class="relative" @mouseenter="show" @mouseleave="hide">
    <button
      type="button"
      class="inline-flex h-8 items-center gap-1.5 rounded-full border border-warning-300 bg-warning-50 px-3 text-[13px] font-semibold text-warning-800 shadow-sm transition-all duration-200 cursor-pointer hover:-translate-y-px hover:bg-warning-100 hover:shadow-md active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-warning-500/35 dark:border-warning-800 dark:bg-warning-950/60 dark:text-warning-200 dark:hover:bg-warning-900 dark:focus-visible:ring-offset-surface-950"
      :aria-expanded="open"
      aria-haspopup="menu"
    >
      <MailWarning class="size-3.5 shrink-0" />
      <span class="hidden sm:inline">Verify email</span>
    </button>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 -translate-y-1"
    >
      <!-- pt-1.5 keeps the visual 6px gap while making the hover area continuous -->
      <div v-if="open" class="absolute right-0 top-full z-50 w-80 pt-1.5">
        <div class="overflow-hidden rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/8 dark:shadow-surface-950/30">
          <!-- Header -->
          <div class="flex items-center gap-3 border-b border-surface-100 dark:border-surface-800 bg-warning-50/70 dark:bg-warning-950/20 px-4 py-3.5">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning-500 text-white shadow-sm shadow-warning-500/30">
              <MailWarning class="size-4" />
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-surface-900 dark:text-surface-100">Verify your email</p>
              <p class="text-xs text-surface-500 dark:text-surface-400">Required to send messages and invitations</p>
            </div>
          </div>

          <!-- Body -->
          <div class="px-4 py-4">
            <p class="text-sm text-surface-600 dark:text-surface-400">
              Check <span class="font-medium text-surface-900 dark:text-surface-200">{{ email }}</span> for the verification link.
            </p>
            <p v-if="resendError" class="mt-2 text-xs text-danger-700 dark:text-danger-400">{{ resendError }}</p>

            <button
              type="button"
              :disabled="resendState !== 'idle'"
              class="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-warning-300 bg-warning-50 px-3 text-xs font-semibold text-warning-800 transition-colors hover:bg-warning-100 disabled:cursor-default disabled:opacity-70 dark:border-warning-800 dark:bg-warning-950 dark:text-warning-200 dark:hover:bg-warning-900"
              @click="resendVerification"
            >
              <Loader2 v-if="resendState === 'sending'" class="size-3.5 animate-spin" />
              <Check v-else-if="resendState === 'sent'" class="size-3.5" />
              <RefreshCw v-else class="size-3.5" />
              {{ resendState === 'sending' ? 'Sending' : resendState === 'sent' ? 'Link sent' : 'Resend link' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
