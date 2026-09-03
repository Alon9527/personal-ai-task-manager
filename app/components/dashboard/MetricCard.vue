<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  hint: string
  tone: 'violet' | 'teal' | 'orange' | 'neutral'
  icon: string
}>()
</script>

<template>
  <article class="dashboard-metric-card" :class="`tone-${tone}`">
    <span class="dashboard-metric-icon"><UIcon :name="icon" /></span>
    <div><small>{{ label }}</small><strong>{{ value }}</strong></div>
    <p>{{ hint }}</p>
  </article>
</template>
