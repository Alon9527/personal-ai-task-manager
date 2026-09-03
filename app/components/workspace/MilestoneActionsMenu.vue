<script setup lang="ts">
import type { Milestone } from '#shared/workspace'

defineProps<{ milestone: Milestone, first: boolean, last: boolean }>()

const emit = defineEmits<{
  edit: []
  plan: []
  start: []
  block: []
  complete: []
  'move-up': []
  'move-down': []
  delete: []
}>()
</script>

<template>
  <div class="action-menu milestone-action-menu" role="menu" aria-label="里程碑操作">
    <button type="button" role="menuitem" data-action="edit" @click="emit('edit')"><UIcon name="i-lucide-pencil" />编辑里程碑</button>
    <button v-if="milestone.status !== 'in_progress'" type="button" role="menuitem" data-action="start" @click="emit('start')"><UIcon name="i-lucide-play" />标记进行中</button>
    <button v-if="milestone.status !== 'blocked'" type="button" role="menuitem" data-action="block" @click="emit('block')"><UIcon name="i-lucide-circle-pause" />标记受阻</button>
    <button v-if="milestone.status !== 'completed'" type="button" role="menuitem" data-action="complete" @click="emit('complete')"><UIcon name="i-lucide-circle-check-big" />标记完成</button>
    <button v-if="milestone.status !== 'planned'" type="button" role="menuitem" data-action="plan" @click="emit('plan')"><UIcon name="i-lucide-calendar-clock" />恢复计划中</button>
    <span class="action-divider" />
    <button type="button" role="menuitem" data-action="move-up" :disabled="first" @click="emit('move-up')"><UIcon name="i-lucide-arrow-up" />上移</button>
    <button type="button" role="menuitem" data-action="move-down" :disabled="last" @click="emit('move-down')"><UIcon name="i-lucide-arrow-down" />下移</button>
    <span class="action-divider" />
    <button type="button" role="menuitem" data-action="delete" class="danger-action" @click="emit('delete')"><UIcon name="i-lucide-trash-2" />删除里程碑</button>
  </div>
</template>
