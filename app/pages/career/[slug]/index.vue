<script setup lang="ts">
// Public branded career page removed — redirect stale links to sign-in.
const localePath = useLocalePath()
definePageMeta({ layout: 'auth' })
await navigateTo(localePath('/auth/sign-in'), { replace: true })
</script>

<template>
  <div />
</template>

