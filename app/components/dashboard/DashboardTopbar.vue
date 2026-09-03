<script setup lang="ts">
defineProps<{
  section: string
  title: string
  actionLabel?: string
  actionIcon?: string
}>()

const emit = defineEmits<{ action: [] }>()
const workspace = useWorkspace()
</script>

<template>
  <header class="dashboard-topbar">
    <div class="dashboard-breadcrumb">
      <span>{{ section }}</span><UIcon name="i-lucide-chevron-right" /><b>{{ title }}</b>
      <span data-backend-mode class="mode-badge"><span />{{ workspace.backendLabel.value }}</span>
    </div>
    <button v-if="actionLabel" type="button" class="dashboard-primary-action" @click="emit('action')">
      <UIcon :name="actionIcon ?? 'i-lucide-plus'" />{{ actionLabel }}
    </button>
  </header>
</template>
