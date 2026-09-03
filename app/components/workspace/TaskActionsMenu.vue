<script setup lang="ts">
import { getTaskStatus } from '#shared/workspace'
import type { Task } from '#shared/workspace'

defineProps<{ task: Task, first: boolean, last: boolean }>()
const emit = defineEmits<{
  edit: []
  move: []
  start: []
  pause: []
  snooze: []
  'move-up': []
  'move-down': []
  delete: []
}>()
</script>

<template>
  <div class="action-menu" role="menu" aria-label="任务操作">
    <button type="button" role="menuitem" data-action="edit" @click="emit('edit')"><UIcon name="i-lucide-pencil" />编辑</button>
    <button v-if="task.completedAt === null" type="button" role="menuitem" data-action="move" @click="emit('move')">
      <UIcon :name="task.isFocus ? 'i-lucide-clock-3' : 'i-lucide-target'" />
      {{ task.isFocus ? '移到稍后处理' : '移到今日重点' }}
    </button>
    <button v-if="task.completedAt === null && getTaskStatus(task) !== 'in_progress'" type="button" role="menuitem" data-action="start" @click="emit('start')"><UIcon name="i-lucide-play" />开始执行</button>
    <button v-if="task.completedAt === null && getTaskStatus(task) === 'in_progress'" type="button" role="menuitem" data-action="pause" @click="emit('pause')"><UIcon name="i-lucide-pause" />暂停执行</button>
    <button v-if="task.completedAt === null && task.reminderAt" type="button" role="menuitem" data-action="snooze" @click="emit('snooze')"><UIcon name="i-lucide-alarm-clock" />10 分钟后提醒</button>
    <button type="button" role="menuitem" data-action="move-up" :disabled="first" @click="emit('move-up')"><UIcon name="i-lucide-arrow-up" />上移</button>
    <button type="button" role="menuitem" data-action="move-down" :disabled="last" @click="emit('move-down')"><UIcon name="i-lucide-arrow-down" />下移</button>
    <span class="action-divider" />
    <button type="button" role="menuitem" data-action="delete" class="danger-action" @click="emit('delete')"><UIcon name="i-lucide-trash-2" />删除</button>
  </div>
</template>
