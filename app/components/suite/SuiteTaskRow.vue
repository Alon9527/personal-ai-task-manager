<script setup lang="ts">
import type { Task } from '#shared/workspace'
defineProps<{ task: Task }>()
const workspace = useWorkspace(); const ui = useWorkspaceUi()
const labels: Record<string,string> = { inbox:'收集箱',todo:'待办',in_progress:'进行中',waiting:'等待中',done:'已完成',cancelled:'已取消' }
</script>
<template><article class="suite-task-row" :data-priority="task.priority ?? 'none'" :class="{ 'is-active': task.isFocus || task.status === 'in_progress', 'is-done': !!task.completedAt }" data-task-row>
  <button class="suite-check" :class="{ checked: !!task.completedAt }" :aria-label="`${task.completedAt ? '恢复' : '完成'} ${task.title}`" @click="workspace.setTaskCompleted(task.id,!task.completedAt)"><UIcon v-if="task.completedAt" name="i-lucide-check" /></button>
  <button class="suite-task-title" @click="ui.openEditTask(task.id)"><strong>{{ task.title }}</strong><small>{{ workspace.projects.value.find(p => p.id === task.projectId)?.name ?? '无项目' }} <span>·</span> {{ task.dueDate ?? '未安排日期' }} {{ task.dueTime }}</small></button>
  <span class="suite-status" :class="task.status">{{ labels[task.status] }}</span><span class="task-priority-label">{{task.priority==='high'?'高':task.priority==='medium'?'中':task.priority==='low'?'低':'无'}}</span>
  <button class="suite-icon" :aria-label="`编辑 ${task.title}`" @click="ui.openEditTask(task.id)"><UIcon name="i-lucide-ellipsis-vertical" /></button>
</article></template>
<style scoped>
.suite-task-row[data-priority]{border-left:4px solid var(--priority-color);background:var(--priority-bg)}
[data-priority=none]{--priority-color:#98a2b3;--priority-bg:#fafbfc}
[data-priority=low]{--priority-color:#4486dd;--priority-bg:#f2f7ff}
[data-priority=medium]{--priority-color:#d98b1b;--priority-bg:#fff8ec}
[data-priority=high]{--priority-color:#df5260;--priority-bg:#fff2f3}
.suite-task-row[data-priority]::before{display:none}.task-priority-label{color:var(--priority-color);font-weight:700;font-size:12px;white-space:nowrap}
</style>
