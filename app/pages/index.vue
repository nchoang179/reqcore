<script setup lang="ts">
// Root redirect: Reqcore is a logged-in app. The index route redirects guests
// to the sign-in page (and keeps authenticated users on the dashboard) so the
// marketing landing page never sits between the user and the product.

const localePath = useLocalePath()
const { data: session } = await authClient.useSession(useFetch)

definePageMeta({ layout: 'auth' })

await navigateTo(
  session.value?.user ? localePath('/dashboard') : localePath('/auth/sign-in'),
  { replace: true },
)
</script>

<template>
  <div />
</template>
