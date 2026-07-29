<script setup lang="ts">
import type { MDCParseOptions } from '@nuxtjs/mdc'
import MDC from '@nuxtjs/mdc/runtime/components/MDC.vue'
import { normalizeDescriptionMarkdown } from '~~/shared/job-description'

const props = defineProps<{
  value?: string | null
  /** Tighter type and rhythm, for chat bubbles and other narrow containers. */
  dense?: boolean
}>()

const parserOptions: MDCParseOptions = {
  rehype: {
    options: {
      allowDangerousHtml: false,
    },
    plugins: {
      'rehype-raw': false,
    },
  },
  highlight: false,
  toc: false,
}

// Descriptions are recruiter-pasted, so they reach the parser carrying
// indentation and bullet glyphs that markdown reads as something else.
const normalizedValue = computed(() => normalizeDescriptionMarkdown(props.value))
</script>

<template>
  <MDC
    :value="normalizedValue"
    :parser-options="parserOptions"
    :class="['job-prose', { 'job-prose-dense': dense }]"
  />
</template>
