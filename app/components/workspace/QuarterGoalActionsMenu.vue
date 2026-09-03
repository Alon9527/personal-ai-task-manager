<script setup lang="ts">
import type { QuarterGoal } from '#shared/workspace'

defineProps<{ goal: QuarterGoal, first: boolean, last: boolean }>()

const emit = defineEmits<{
  edit: []
  complete: []
  activate: []
  pause: []
  'move-up': []
  'move-down': []
  delete: []
}>()
</script>

<template>
  <div class="action-menu goal-action-menu" role="menu" aria-label="季度目标操作">
    <button type="button" role="menuitem" data-action="edit" @click="emit('edit')"><UIcon name="i-lucide-pencil" />编辑目标</button>
    <button v-if="goal.status !== 'completed'" type="button" role="menuitem" data-action="complete" @click="emit('complete')"><UIcon name="i-lucide-circle-check-big" />标记完成</button>
    <button v-if="goal.status !== 'active'" type="button" role="menuitem" data-action="activate" @click="emit('activate')"><UIcon name="i-lucide-play" />恢复进行</button>
    <button v-if="goal.status !== 'paused'" type="button" role="menuitem" data-action="pause" @click="emit('pause')"><UIcon name="i-lucide-pause" />暂停目标</button>
    <span class="action-divider" />
    <button type="button" role="menuitem" data-action="move-up" :disabled="first" @click="emit('move-up')"><UIcon name="i-lucide-arrow-up" />上移</button>
    <button type="button" role="menuitem" data-action="move-down" :disabled="last" @click="emit('move-down')"><UIcon name="i-lucide-arrow-down" />下移</button>
    <span class="action-divider" />
    <button type="button" role="menuitem" data-action="delete" class="danger-action" @click="emit('delete')"><UIcon name="i-lucide-trash-2" />删除目标</button>
  </div>
</template>
