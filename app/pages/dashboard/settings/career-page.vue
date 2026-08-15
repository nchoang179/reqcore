<script setup lang="ts">
// The branded public career page has been removed (Reqcore is a private,
// logged-in application). Redirect any stale links to general settings.
definePageMeta({ layout: 'settings' })
await navigateTo('/dashboard/settings', { replace: true })
</script>

<template>
  <div />
</template>

