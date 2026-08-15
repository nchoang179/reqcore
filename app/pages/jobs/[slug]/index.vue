<script setup lang="ts">
// Public job detail removed — redirect stale links to sign-in.
const localePath = useLocalePath()
definePageMeta({ layout: 'auth' })
await navigateTo(localePath('/auth/sign-in'), { replace: true })
</script>

<template>
  <div />
</template>

