<script setup lang="ts">
// Reqcore is a private, logged-in application: the pricing page has been
// removed. Redirect any stale links to the sign-in page.
const localePath = useLocalePath()
definePageMeta({ layout: 'auth' })
await navigateTo(localePath('/auth/sign-in'), { replace: true })
</script>

<template>
  <div />
</template>
