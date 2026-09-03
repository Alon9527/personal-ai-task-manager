<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  description: string
  actionLabel: string
}>()

const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <section class="dashboard-empty-state">
    <span><UIcon :name="icon" /></span>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <button type="button" @click="emit('action')">{{ actionLabel }}</button>
  </section>
</template>
