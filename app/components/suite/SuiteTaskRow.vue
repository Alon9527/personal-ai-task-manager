<script setup lang="ts">
import type { Task } from '#shared/workspace'
import { computed, ref } from 'vue'
const props = defineProps<{ task: Task, compact?: boolean, focus?: boolean }>()
const workspace = useWorkspace(); const ui = useWorkspaceUi()
const actions = ref<HTMLDetailsElement|null>(null)
const metadata = computed(() => [workspace.projects.value.find(p=>p.id===props.task.projectId)?.name, [props.task.dueDate,props.task.dueDate?props.task.dueTime:null].filter(Boolean).join(' ')].filter(Boolean).join(' · '))
function closeActions(returnFocus=false){if(actions.value){actions.value.open=false;if(returnFocus)actions.value.querySelector('summary')?.focus()}}
const labels: Record<string,string> = { inbox:'收集箱',todo:'待办',in_progress:'进行中',waiting:'等待中',done:'已完成',cancelled:'已取消' }
</script>
<template><article class="suite-task-row" :data-task-id="task.id" :data-priority="task.priority ?? 'none'" :class="{ 'is-active': task.isFocus || task.status === 'in_progress', 'is-done': !!task.completedAt, 'is-compact':compact, 'is-focus-card':focus }" data-task-row>
  <button class="suite-check" :class="{ checked: !!task.completedAt }" :aria-label="`${task.completedAt ? '恢复' : '完成'} ${task.title}`" @click="workspace.setTaskCompleted(task.id,!task.completedAt)"><UIcon v-if="task.completedAt" name="i-lucide-check" /></button>
  <button class="suite-task-title" :title="[task.title,metadata].filter(Boolean).join('\n')" @click="ui.openEditTask(task.id)"><strong>{{ task.title }}</strong><template v-if="compact"><small v-if="metadata" :title="metadata">{{metadata}}</small></template><small v-else>{{ workspace.projects.value.find(p => p.id === task.projectId)?.name ?? '无项目' }} <span>·</span> {{ task.dueDate ?? '未安排日期' }} {{ task.dueTime }}</small></button>
  <span v-if="!compact" class="suite-status" :class="task.status">{{ labels[task.status] }}</span><span class="task-priority-label" :aria-label="`优先级：${task.priority==='high'?'高':task.priority==='medium'?'中':task.priority==='low'?'低':'无'}`">{{task.priority==='high'?'高':task.priority==='medium'?'中':task.priority==='low'?'低':'无'}}</span>
  <details v-if="compact || focus" ref="actions" class="task-disclosure" @keydown.esc.prevent.stop="closeActions(true)" @focusout="event=>{if(!actions?.contains(event.relatedTarget as Node))closeActions()}">
    <summary :aria-label="`更多操作 ${task.title}`" title="更多操作"><UIcon name="i-lucide-ellipsis-vertical" /></summary>
    <div class="task-disclosure-actions">
      <button type="button" :aria-label="`编辑 ${task.title}`" @click="closeActions();ui.openEditTask(task.id)">编辑任务</button>
      <button type="button" data-task-delete class="danger" :aria-label="`删除 ${task.title}`" @click="closeActions();ui.askDeleteTask(task.id)">删除任务</button>
    </div>
  </details>
  <template v-else><button class="suite-icon" :aria-label="`编辑 ${task.title}`" @click="ui.openEditTask(task.id)"><UIcon name="i-lucide-ellipsis-vertical" /></button>
  <button type="button" class="suite-task-delete" :aria-label="`删除 ${task.title}`" @click="ui.askDeleteTask(task.id)">删除</button></template>
</article></template>
<style scoped>
.suite-task-delete{flex-shrink:0;padding:6px 8px;border:1px solid #efc8cc;border-radius:6px;background:#fff8f8;color:#bd3847;font:inherit;font-size:12px;cursor:pointer}
.suite-task-delete:hover{background:#ffe8eb}
.suite-task-row[data-priority]{border-left:4px solid var(--priority-color);background:var(--priority-bg)}
[data-priority=none]{--priority-color:#98a2b3;--priority-bg:#fafbfc}
[data-priority=low]{--priority-color:#4486dd;--priority-bg:#f2f7ff}
[data-priority=medium]{--priority-color:#d98b1b;--priority-bg:#fff8ec}
[data-priority=high]{--priority-color:#df5260;--priority-bg:#fff2f3}
.suite-task-row[data-priority]::before{display:none}.task-priority-label{color:var(--priority-color);font-weight:700;font-size:12px;white-space:nowrap}
.suite-task-row.is-compact{min-height:42px;padding:3px 8px;gap:8px;border-radius:7px;min-width:0;box-shadow:none}
.is-compact .suite-check{width:22px;height:22px;flex:0 0 22px;font-size:14px}
.is-compact .suite-task-title{gap:1px}
.is-compact .suite-task-title strong{font-size:14px;line-height:18px;font-weight:650}
.is-compact .suite-task-title small{font-size:12px;line-height:15px;color:#68738b}
.suite-task-row.is-focus-card{min-height:58px;padding:8px 12px;gap:12px;background:#fff9ea;border-left-color:#8057ff;box-shadow:none}
.is-focus-card .suite-task-title{gap:3px}
.is-focus-card .suite-task-title strong{font-size:15px;line-height:20px}
.is-focus-card .suite-check{width:24px;height:24px;flex:0 0 24px}
.task-disclosure{position:relative;flex:0 0 28px;align-self:center}
.task-disclosure[open]{z-index:5}
.task-disclosure summary{list-style:none;display:grid;place-items:center;width:28px;height:28px;cursor:pointer;border-radius:5px;color:#747b91;font-size:18px}
.task-disclosure summary::-webkit-details-marker{display:none}
.task-disclosure summary:hover{background:#ebe7fa}
.task-disclosure-actions{position:absolute;right:0;top:100%;min-width:116px;padding:4px;background:#fff;border:1px solid #e3e1eb;border-radius:8px;box-shadow:0 4px 12px #25203314;display:grid}
.task-disclosure-actions button{border:0;background:none;padding:8px 12px;text-align:left;white-space:nowrap;font:inherit;font-size:13px;cursor:pointer;border-radius:4px;color:#30394c}
.task-disclosure-actions button:hover{background:#f5f2ff}
.task-disclosure-actions .danger{color:#bd3847}
.is-compact :is(button,summary):focus-visible,.is-focus-card :is(button,summary):focus-visible{outline:2px solid #7950f8;outline-offset:2px}
@media(pointer:coarse){.suite-task-row.is-compact{min-height:48px}.is-compact .suite-check{width:28px;height:28px;flex-basis:28px}.task-disclosure summary{min-height:32px}}
</style>
