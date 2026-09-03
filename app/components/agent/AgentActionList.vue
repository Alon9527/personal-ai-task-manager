<script setup lang="ts">
import { computed, nextTick } from 'vue'
import type { WorkspaceDocument } from '#shared/workspace'
import type { AgentAction, AgentPlanDraftV1 } from '../../services/agent-plan-schema'
import type { AgentPlanIssue } from '../../services/agent-plan-validation'

const props = defineProps<{
  actions: AgentPlanDraftV1['actions']
  selectedActionId: string | null
  issues: AgentPlanIssue[]
  document: WorkspaceDocument
}>()

const emit = defineEmits<{
  select: [actionId: string]
  toggle: [actionId: string, selected: boolean]
}>()

const groups = computed(() => [
  { key: 'project', label: '项目改动', actions: props.actions.filter(action => entityKind(action) === 'project') },
  { key: 'milestone', label: '里程碑改动', actions: props.actions.filter(action => entityKind(action) === 'milestone') },
  { key: 'task', label: '任务改动', actions: props.actions.filter(action => entityKind(action) === 'task') },
].filter(group => group.actions.length > 0))

const visibleOrder = computed(() => groups.value.flatMap(group => group.actions.map(action => action.actionId)))
const dependencyActions = computed(() => {
  const createsByRef = new Map<string, AgentAction>()
  const linked = new Set<string>()
  for (const action of props.actions) {
    if (isCreate(action) && action.draftRef) createsByRef.set(action.draftRef, action)
  }
  for (const action of props.actions) {
    for (const ref of actionRefs(action)) {
      const parent = createsByRef.get(ref)
      if (!parent || !isCreate(action)) continue
      linked.add(parent.actionId)
      linked.add(action.actionId)
    }
  }
  return linked
})

function entityKind(action: AgentAction) {
  if (action.type.endsWith('Project')) return 'project'
  if (action.type.endsWith('Milestone')) return 'milestone'
  return 'task'
}

function isCreate(action: AgentAction) {
  return action.type === 'createProject' || action.type === 'createMilestone' || action.type === 'createTask'
}

function actionRefs(action: AgentAction) {
  if (action.type === 'createMilestone') {
    return action.payload.projectId.kind === 'draft' ? [action.payload.projectId.ref] : []
  }
  if (action.type === 'createTask') {
    return [action.payload.projectId, action.payload.milestoneId]
      .filter(reference => reference?.kind === 'draft')
      .map(reference => reference!.ref)
  }
  return []
}

function issueId(actionId: string, index: number) {
  return `agent-action-${safeId(actionId)}-issue-${index + 1}`
}

function issuesFor(actionId: string) {
  return props.issues.filter(issue => issue.actionId === actionId)
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function actionVerb(action: AgentAction) {
  if (action.type.startsWith('create')) return '新建'
  if (action.type.startsWith('update')) return '修改'
  if (action.type === 'setProjectCompleted' || action.type === 'setMilestoneCompleted' || action.type === 'setTaskCompleted') {
    return action.payload.completed ? '标记完成' : '恢复未完成'
  }
  return '移入回收站'
}

function actionTitle(action: AgentAction) {
  if ('name' in action.payload && typeof action.payload.name === 'string') return action.payload.name
  if ('title' in action.payload && typeof action.payload.title === 'string') return action.payload.title
  if (action.targetId) {
    if (entityKind(action) === 'project') return props.document.projects.find(item => item.id === action.targetId)?.name ?? '现有项目'
    if (entityKind(action) === 'milestone') return props.document.milestones.find(item => item.id === action.targetId)?.title ?? '现有里程碑'
    return props.document.tasks.find(item => item.id === action.targetId)?.title ?? '现有任务'
  }
  return entityKindLabel(action)
}

function entityKindLabel(action: AgentAction) {
  const kind = entityKind(action)
  return kind === 'project' ? '项目' : kind === 'milestone' ? '里程碑' : '任务'
}

function relationText(action: AgentAction) {
  if (action.type === 'createMilestone') return referenceText(action.payload.projectId, '项目')
  if (action.type === 'createTask') {
    const project = referenceText(action.payload.projectId, '项目')
    const milestone = referenceText(action.payload.milestoneId, '里程碑')
    return [project, milestone].filter(Boolean).join(' · ')
  }
  return ''
}

function referenceText(reference: { kind: 'existing', id: string } | { kind: 'draft', ref: string } | null, label: string) {
  if (!reference) return ''
  if (reference.kind === 'draft') {
    const parent = props.actions.find(action => isCreate(action) && action.draftRef === reference.ref)
    return parent ? `${label} · ${actionTitle(parent)}` : `依赖新${label}`
  }
  if (label === '项目') return `项目 · ${props.document.projects.find(item => item.id === reference.id)?.name ?? '已有项目'}`
  return `里程碑 · ${props.document.milestones.find(item => item.id === reference.id)?.title ?? '已有里程碑'}`
}

function detailText(action: AgentAction) {
  const parts: string[] = []
  if ('targetDate' in action.payload && action.payload.targetDate) parts.push(`目标 ${action.payload.targetDate}`)
  if ('dueDate' in action.payload && action.payload.dueDate) parts.push(`截止 ${action.payload.dueDate}`)
  if ('priority' in action.payload && action.payload.priority) parts.push(priorityLabel(action.payload.priority))
  if ('status' in action.payload && action.payload.status) parts.push(statusLabel(action.payload.status))
  if ('estimatedMinutes' in action.payload && action.payload.estimatedMinutes) parts.push(`${action.payload.estimatedMinutes} 分钟`)
  return parts.join(' · ')
}

function priorityLabel(value: string) {
  return ({ low: '低优先级', medium: '中优先级', high: '高优先级' } as Record<string, string>)[value] ?? value
}

function statusLabel(value: string) {
  return ({ planned: '计划中', active: '进行中', paused: '已暂停', completed: '已完成', in_progress: '进行中', blocked: '受阻', inbox: '收集箱', todo: '待办', waiting: '等待', done: '完成', cancelled: '取消' } as Record<string, string>)[value] ?? value
}

function selectByKeyboard(event: KeyboardEvent, actionId: string) {
  const current = visibleOrder.value.indexOf(actionId)
  let next = current
  if (event.key === 'ArrowUp') next = Math.max(0, current - 1)
  else if (event.key === 'ArrowDown') next = Math.min(visibleOrder.value.length - 1, current + 1)
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = visibleOrder.value.length - 1
  else return
  event.preventDefault()
  const nextId = visibleOrder.value[next]
  if (!nextId) return
  emit('select', nextId)
  void nextTick(() => {
    const row = [...document.querySelectorAll<HTMLElement>('[data-agent-action]')]
      .find(element => element.dataset.agentAction === nextId)
    row?.querySelector<HTMLElement>('[data-agent-row-select]')?.focus()
  })
}
</script>

<template>
  <section data-agent-action-list class="agent-action-list" aria-label="计划改动列表">
    <section v-for="group in groups" :key="group.key" class="agent-action-group">
      <header>
        <h2>{{ group.label }}</h2>
        <span class="agent-plan-meta">{{ group.actions.length }} 项</span>
      </header>
      <article
        v-for="action in group.actions"
        :key="action.actionId"
        :data-agent-action="action.actionId"
        :data-agent-dependency-spine="dependencyActions.has(action.actionId) ? '' : undefined"
        class="agent-action-row"
        :class="{
          'is-selected': selectedActionId === action.actionId,
          'is-danger-selected': action.dangerous && action.selected,
          'has-issues': issuesFor(action.actionId).length > 0,
        }"
      >
        <label class="agent-action-check">
          <span class="sr-only">{{ action.selected ? '取消选择' : '选择' }}{{ actionTitle(action) }}</span>
          <input
            type="checkbox"
            :checked="action.selected"
            :aria-label="`${action.selected ? '取消选择' : '选择'}${actionTitle(action)}`"
            @change="$emit('toggle', action.actionId, ($event.target as HTMLInputElement).checked)"
          >
        </label>
        <button
          type="button"
          data-agent-row-select
          class="agent-action-row-main"
          :aria-current="selectedActionId === action.actionId ? 'true' : undefined"
          :aria-describedby="issuesFor(action.actionId).map((_, index) => issueId(action.actionId, index)).join(' ') || undefined"
          @click="$emit('select', action.actionId)"
          @keydown="selectByKeyboard($event, action.actionId)"
        >
          <span class="agent-action-line">
            <strong>{{ actionVerb(action) }}</strong>
            <b>{{ actionTitle(action) }}</b>
            <span v-if="action.dangerous && action.selected" data-agent-danger-marker class="agent-danger-marker">
              <span aria-hidden="true">⚠</span> 移入回收站
            </span>
            <span v-if="selectedActionId === action.actionId" class="agent-selected-word">正在审阅</span>
          </span>
          <span class="agent-action-reason">{{ action.reason }}</span>
          <span v-if="relationText(action) || detailText(action)" class="agent-action-facts agent-plan-meta">
            <span v-if="relationText(action)">{{ relationText(action) }}</span>
            <span v-if="detailText(action)">{{ detailText(action) }}</span>
          </span>
          <span v-for="(issue, issueIndex) in issuesFor(action.actionId)" :id="issueId(action.actionId, issueIndex)" :key="`${issue.code}-${issue.field}`" class="agent-action-issue">
            {{ issue.message }}
          </span>
        </button>
      </article>
    </section>
  </section>
</template>
