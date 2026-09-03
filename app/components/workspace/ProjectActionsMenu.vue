<script setup lang="ts">
import type { Project } from '#shared/workspace'

defineProps<{ project: Project, first: boolean, last: boolean }>()
const emit = defineEmits<{
  edit: []
  'move-up': []
  'move-down': []
  delete: []
}>()
</script>

<template>
  <div class="action-menu project-action-menu" role="menu" aria-label="项目操作">
    <button type="button" role="menuitem" data-action="edit" @click="emit('edit')"><UIcon name="i-lucide-pencil" />编辑项目</button>
    <button type="button" role="menuitem" data-action="move-up" :disabled="first" @click="emit('move-up')"><UIcon name="i-lucide-arrow-up" />上移</button>
    <button type="button" role="menuitem" data-action="move-down" :disabled="last" @click="emit('move-down')"><UIcon name="i-lucide-arrow-down" />下移</button>
    <span class="action-divider" />
    <button type="button" role="menuitem" data-action="delete" class="danger-action" @click="emit('delete')"><UIcon name="i-lucide-trash-2" />删除项目</button>
  </div>
</template>
