<script setup lang="ts">
defineProps<{
  name: 'sun' | 'inbox' | 'quarter' | 'review' | 'bridge' | 'search'
}>()
</script>

<template>
  <svg
    class="rail-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
    </template>

    <template v-else-if="name === 'inbox'">
      <path d="M4 4h16l2 10v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5L4 4Z" />
      <path d="M2 14h5l2 3h6l2-3h5" />
    </template>

    <template v-else-if="name === 'quarter'">
      <path d="M4 19V9M10 19V5M16 19v-7M22 19V3" />
      <path d="M2 19h21" />
    </template>

    <template v-else-if="name === 'review'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 9v12" />
    </template>

    <template v-else-if="name === 'bridge'">
      <path d="M4 4h6l2 2h8v14H4z" />
      <path d="M12 10v6M9 13h6" />
    </template>

    <template v-else>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </template>
  </svg>
</template>

<style scoped>
.rail-icon {
  display: block;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  color: currentColor;
  opacity: 1;
}
</style>
