<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { WorkspaceDocument } from '#shared/workspace'
import { agentActionSchema } from '../../services/agent-plan-schema'
import type { AgentAction, AgentPlanDraftV1 } from '../../services/agent-plan-schema'
import type { AgentPlanIssue } from '../../services/agent-plan-validation'

type AgentActionSaveOutcome = { ok: true } | { ok: false, message: string }
type AgentActionPatch = { reason: string, payload: Record<string, unknown> }

const props = defineProps<{
  action: AgentAction
  actions: AgentPlanDraftV1['actions']
  document: WorkspaceDocument
  issues: AgentPlanIssue[]
  saveAction: (actionId: string, patch: AgentActionPatch) => AgentActionSaveOutcome | Promise<AgentActionSaveOutcome>
}>()

const emit = defineEmits<{
  close: []
  validity: [valid: boolean]
}>()

const form = reactive<Record<string, any>>({})
const localErrors = reactive<Record<string, string>>({})
const saving = ref(false)
let initialForm: Record<string, unknown> = {}

const entityKind = computed(() => props.action.type.endsWith('Project')
  ? 'project'
  : props.action.type.endsWith('Milestone') ? 'milestone' : 'task')
const isDelete = computed(() => props.action.type.startsWith('delete'))
const isCompletion = computed(() => props.action.type.startsWith('set'))
const projectOptions = computed(() => [
  { value: '', label: '不归属项目' },
  ...props.document.projects.filter(item => item.deletedAt === null).map(item => ({ value: `existing:${item.id}`, label: item.name })),
  ...(isCreateAction(props.action)
    ? props.actions.filter(action => action.selected && action.type === 'createProject' && action.draftRef)
      .map(action => ({ value: `draft:${action.draftRef}`, label: `新项目 · ${action.type === 'createProject' ? action.payload.name : ''}` }))
    : []),
])
const milestoneOptions = computed(() => [
  { value: '', label: '不归属里程碑' },
  ...props.document.milestones.filter(item => item.deletedAt === null
    && props.document.projects.some(project => project.id === item.projectId && project.deletedAt === null)
    && (!form.projectId || form.projectId === `existing:${item.projectId}`))
    .map(item => ({ value: `existing:${item.id}`, label: item.title })),
  ...(isCreateAction(props.action)
    ? props.actions.filter(action => action.selected && action.type === 'createMilestone' && action.draftRef)
      .filter(action => action.type === 'createMilestone' && (!form.projectId || form.projectId === encodeReference(action.payload.projectId)))
      .map(action => ({ value: `draft:${action.draftRef}`, label: `新里程碑 · ${action.type === 'createMilestone' ? action.payload.title : ''}` }))
    : []),
])
const visibleErrorFields = computed(() => editableFieldNames.value.filter(field => issueFor(field)))
const editableFieldNames = computed(() => {
  if (isCompletion.value) return ['reason', 'completed']
  if (entityKind.value === 'project') return ['reason', 'name', 'color', 'description', 'priority', 'status', 'targetDate']
  if (entityKind.value === 'milestone') return ['reason', 'projectId', 'title', 'description', 'targetDate', 'status', 'progressMode', 'progress']
  return ['reason', 'projectId', 'milestoneId', 'title', 'description', 'importance', 'priority', 'status', 'estimatedMinutes', 'dueDate', 'dueTime', 'reminderAt', 'isFocus']
})

watch(() => props.action, reset, { immediate: true, deep: true })
watch(form, () => {
  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  emit('validity', !dirty && Object.keys(localErrors).length === 0)
}, { deep: true, flush: 'sync' })

function reset() {
  for (const key of Object.keys(form)) delete form[key]
  for (const key of Object.keys(localErrors)) delete localErrors[key]
  Object.assign(form, editableDefaults(), structuredClone(props.action.payload), { reason: props.action.reason })
  if ('projectId' in form) form.projectId = encodeReference(form.projectId)
  if ('milestoneId' in form) form.milestoneId = encodeReference(form.milestoneId)
  for (const key of ['targetDate', 'dueDate', 'dueTime', 'reminderAt']) {
    if (key in form && form[key] === null) form[key] = ''
  }
  if ('priority' in form && form.priority === null) form.priority = ''
  if ('estimatedMinutes' in form && form.estimatedMinutes === null) form.estimatedMinutes = ''
  initialForm = JSON.parse(JSON.stringify(form)) as Record<string, unknown>
  emit('validity', true)
}

function editableDefaults() {
  const target = existingTarget()
  if (entityKind.value === 'project' && !isCompletion.value) return target ? {
    name: target.name, color: target.color, description: target.description, priority: target.priority,
    status: target.status, targetDate: target.targetDate,
  } : {}
  if (entityKind.value === 'milestone' && !isCompletion.value) return target ? {
    projectId: target.projectId, title: target.title, description: target.description, targetDate: target.targetDate,
    status: target.status, progressMode: target.progressMode, progress: target.progress,
  } : {}
  if (entityKind.value === 'task' && !isCompletion.value) return target ? {
    projectId: target.projectId, milestoneId: target.milestoneId, title: target.title, description: target.description,
    priority: target.priority, dueDate: target.dueDate, dueTime: target.dueTime, isFocus: target.isFocus,
    status: target.status, importance: target.importance, estimatedMinutes: target.estimatedMinutes,
    reminderAt: target.reminderAt, snoozedUntil: target.snoozedUntil, lastRemindedAt: target.lastRemindedAt,
  } : { status: 'todo', importance: 'normal', estimatedMinutes: null, reminderAt: null, snoozedUntil: null, lastRemindedAt: null }
  return {}
}

function existingTarget(): any {
  if (!props.action.targetId) return null
  if (entityKind.value === 'project') return props.document.projects.find(item => item.id === props.action.targetId && item.deletedAt === null) ?? null
  if (entityKind.value === 'milestone') return props.document.milestones.find(item => item.id === props.action.targetId && item.deletedAt === null) ?? null
  return props.document.tasks.find(item => item.id === props.action.targetId && item.deletedAt === null) ?? null
}

function encodeReference(value: unknown) {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? `existing:${value}` : ''
  if ('kind' in value && value.kind === 'draft' && 'ref' in value) return `draft:${value.ref}`
  if ('kind' in value && value.kind === 'existing' && 'id' in value) return `existing:${value.id}`
  return ''
}

function decodeReference(value: string) {
  if (!value) return null
  const [kind, ...rest] = value.split(':')
  const id = rest.join(':')
  return kind === 'draft' ? { kind: 'draft', ref: id } : { kind: 'existing', id }
}

function errorId(field: string) {
  return `agent-editor-${props.action.actionId.replace(/[^a-zA-Z0-9_-]/g, '-')}-${field}-error`
}

function issueFor(field: string) {
  return localErrors[field] ?? props.issues.find(issue => issue.field === `payload.${field}` || issue.field === field)?.message
}

function describedBy(field: string) {
  return issueFor(field) ? errorId(field) : undefined
}

function syncProjectForMilestone() {
  const value = form.milestoneId
  if (!value) return
  if (value.startsWith('existing:')) {
    const milestone = props.document.milestones.find(item => `existing:${item.id}` === value && item.deletedAt === null)
    if (milestone) form.projectId = `existing:${milestone.projectId}`
    return
  }
  if (value.startsWith('draft:')) {
    const ref = value.slice('draft:'.length)
    const milestone = props.actions.find(action => action.type === 'createMilestone' && action.draftRef === ref)
    if (milestone?.type === 'createMilestone') form.projectId = encodeReference(milestone.payload.projectId)
  }
}

function nullable(value: unknown) {
  return value === '' ? null : value
}

async function save() {
  if (saving.value) return
  for (const key of Object.keys(localErrors)) delete localErrors[key]
  if (typeof form.reason !== 'string' || !form.reason.trim()) localErrors.reason = '调整原因不能为空。'
  const titleKey = entityKind.value === 'project' ? 'name' : 'title'
  if (titleKey in form && (typeof form[titleKey] !== 'string' || !form[titleKey].trim())) {
    localErrors[titleKey] = `${titleKey === 'name' ? '项目名称' : '标题'}不能为空。`
  }
  if (form.estimatedMinutes !== undefined && form.estimatedMinutes !== ''
    && (!Number.isInteger(Number(form.estimatedMinutes)) || Number(form.estimatedMinutes) < 5 || Number(form.estimatedMinutes) > 1440)) {
    localErrors.estimatedMinutes = '预计用时必须在 5 到 1440 分钟之间。'
  }
  if ('progress' in form && (form.progress === '' || !Number.isInteger(Number(form.progress)))) {
    localErrors.progress = '进度必须是 0 到 100 之间的整数。'
  }
  if (Object.keys(localErrors).length > 0) {
    emit('validity', false)
    return
  }

  const payload = buildPayload()
  const parsed = agentActionSchema.safeParse({ ...props.action, reason: form.reason, payload })
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String)
      const field = path[0] === 'payload' && path[1] ? path[1] : path[0] === 'reason' ? 'reason' : 'form'
      localErrors[field] ??= readableSchemaError(field, issue.message)
    }
    emit('validity', false)
    return
  }

  saving.value = true
  emit('validity', false)
  try {
    const result = await props.saveAction(props.action.actionId, {
      reason: parsed.data.reason,
      payload: parsed.data.payload as Record<string, unknown>,
    })
    if (!result.ok) {
      localErrors.form = result.message
      emit('validity', false)
      return
    }
    initialForm = JSON.parse(JSON.stringify(form)) as Record<string, unknown>
    emit('validity', true)
  }
  catch (cause) {
    localErrors.form = cause instanceof Error && cause.message ? cause.message : '无法保存此项修改。'
    emit('validity', false)
  }
  finally {
    saving.value = false
  }
}

function buildPayload() {
  const payload = structuredClone(props.action.payload) as Record<string, unknown>
  const changedKeys = Object.keys(form).filter(key => key !== 'reason' && JSON.stringify(form[key]) !== JSON.stringify(initialForm[key]))
  for (const key of new Set([...Object.keys(payload), ...changedKeys])) {
    if (!(key in form)) continue
    if (key === 'projectId' || key === 'milestoneId') payload[key] = isCreateAction(props.action) ? decodeReference(form[key]) : nullable(form[key]?.replace(/^existing:/, ''))
    else if (key === 'estimatedMinutes') payload[key] = form[key] === '' ? null : Number(form[key])
    else if (key === 'progress') payload[key] = Number(form[key])
    else if (['targetDate', 'dueDate', 'dueTime', 'reminderAt', 'priority'].includes(key)) payload[key] = nullable(form[key])
    else payload[key] = form[key]
  }
  return payload
}

function readableSchemaError(field: string, fallback: string) {
  const labels: Record<string, string> = {
    color: '项目颜色', description: '描述', priority: '优先级', status: '状态', targetDate: '日期',
    projectId: '归属项目', milestoneId: '归属里程碑', progressMode: '进度方式', progress: '进度',
    importance: '重要性', dueDate: '截止日期', dueTime: '截止时间', reminderAt: '提醒时间', isFocus: '今日焦点', completed: '完成状态',
  }
  return labels[field] ? `${labels[field]}无效，请检查后重试。` : fallback || '字段内容无效。'
}

function isCreateAction(action: AgentAction) {
  return action.type === 'createProject' || action.type === 'createMilestone' || action.type === 'createTask'
}

function typeLabel() {
  const entity = entityKind.value === 'project' ? '项目' : entityKind.value === 'milestone' ? '里程碑' : '任务'
  if (isDelete.value) return `移入回收站 · ${entity}`
  if (isCompletion.value) return `完成状态 · ${entity}`
  return `${props.action.type.startsWith('create') ? '新建' : '修改'}${entity}`
}
</script>

<template>
  <aside data-agent-action-editor class="agent-action-editor" aria-labelledby="agent-editor-heading">
    <header class="agent-editor-header">
      <div>
        <span class="agent-plan-kicker">SELECTED CHANGE</span>
        <h2 id="agent-editor-heading" class="agent-plan-heading">{{ typeLabel() }}</h2>
      </div>
      <button type="button" class="agent-control agent-editor-close" aria-label="关闭编辑器" @click="$emit('close')">
        <UIcon name="i-lucide-x" />
      </button>
    </header>

    <div class="agent-editor-scroll">
      <div v-if="isDelete" class="agent-delete-explanation">
        <strong>只会移入回收站</strong>
        <p>{{ action.reason }}</p>
        <p class="agent-plan-meta">记录之后仍然可以恢复。选择此项后，最终执行还需要再次确认。</p>
      </div>

      <form v-else class="agent-editor-form" @submit.prevent="save">
        <p v-if="localErrors.form" id="agent-editor-save-error" data-agent-save-error class="agent-save-error agent-field-wide" role="alert">{{ localErrors.form }}</p>
        <label class="agent-field agent-field-wide">
          <span>调整原因</span>
          <textarea v-model="form.reason" data-agent-field="reason" class="agent-control" rows="3" :aria-invalid="Boolean(issueFor('reason'))" :aria-describedby="describedBy('reason')" />
        </label>

        <template v-if="entityKind === 'project' && !isCompletion">
          <label class="agent-field agent-field-wide"><span>项目名称</span><input v-model="form.name" data-agent-field="name" class="agent-control" :aria-invalid="Boolean(issueFor('name'))" :aria-describedby="describedBy('name')"></label>
          <label class="agent-field"><span>颜色</span><input v-model="form.color" data-agent-field="color" class="agent-control" type="color" :aria-invalid="Boolean(issueFor('color'))" :aria-describedby="describedBy('color')"></label>
          <label class="agent-field"><span>优先级</span><select v-model="form.priority" data-agent-field="priority" class="agent-control" :aria-invalid="Boolean(issueFor('priority'))" :aria-describedby="describedBy('priority')"><option value="">未设置</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label class="agent-field"><span>状态</span><select v-model="form.status" data-agent-field="status" class="agent-control" :aria-invalid="Boolean(issueFor('status'))" :aria-describedby="describedBy('status')"><option value="planned">计划中</option><option value="active">进行中</option><option value="paused">已暂停</option><option value="completed">已完成</option></select></label>
          <label class="agent-field"><span>目标日期</span><input v-model="form.targetDate" data-agent-field="targetDate" class="agent-control" type="date" :aria-invalid="Boolean(issueFor('targetDate'))" :aria-describedby="describedBy('targetDate')"></label>
          <label class="agent-field agent-field-wide"><span>描述</span><textarea v-model="form.description" data-agent-field="description" class="agent-control" rows="4" :aria-invalid="Boolean(issueFor('description'))" :aria-describedby="describedBy('description')" /></label>
        </template>

        <template v-if="entityKind === 'milestone' && !isCompletion">
          <label class="agent-field agent-field-wide"><span>里程碑标题</span><input v-model="form.title" data-agent-field="title" class="agent-control" :aria-invalid="Boolean(issueFor('title'))" :aria-describedby="describedBy('title')"></label>
          <label class="agent-field agent-field-wide"><span>归属项目</span><select v-model="form.projectId" data-agent-field="projectId" class="agent-control" :aria-invalid="Boolean(issueFor('projectId'))" :aria-describedby="describedBy('projectId')"><option v-for="option in projectOptions.slice(1)" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          <label class="agent-field"><span>状态</span><select v-model="form.status" data-agent-field="status" class="agent-control" :aria-invalid="Boolean(issueFor('status'))" :aria-describedby="describedBy('status')"><option value="planned">计划中</option><option value="in_progress">进行中</option><option value="blocked">受阻</option><option value="completed">已完成</option></select></label>
          <label class="agent-field"><span>进度方式</span><select v-model="form.progressMode" data-agent-field="progressMode" class="agent-control" :aria-invalid="Boolean(issueFor('progressMode'))" :aria-describedby="describedBy('progressMode')"><option value="auto">按任务自动计算</option><option value="manual">手动填写</option></select></label>
          <label class="agent-field"><span>进度</span><input v-model="form.progress" data-agent-field="progress" class="agent-control" type="number" min="0" max="100" :aria-invalid="Boolean(issueFor('progress'))" :aria-describedby="describedBy('progress')"></label>
          <label class="agent-field"><span>目标日期</span><input v-model="form.targetDate" data-agent-field="targetDate" class="agent-control" type="date" :aria-invalid="Boolean(issueFor('targetDate'))" :aria-describedby="describedBy('targetDate')"></label>
          <label class="agent-field agent-field-wide"><span>描述</span><textarea v-model="form.description" data-agent-field="description" class="agent-control" rows="4" :aria-invalid="Boolean(issueFor('description'))" :aria-describedby="describedBy('description')" /></label>
        </template>

        <template v-if="entityKind === 'task' && !isCompletion">
          <label class="agent-field agent-field-wide"><span>任务标题</span><input v-model="form.title" data-agent-field="title" class="agent-control" :aria-invalid="Boolean(issueFor('title'))" :aria-describedby="describedBy('title')"></label>
          <label class="agent-field agent-field-wide"><span>归属项目</span><select v-model="form.projectId" data-agent-field="projectId" class="agent-control" :aria-invalid="Boolean(issueFor('projectId'))" :aria-describedby="describedBy('projectId')"><option v-for="option in projectOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          <label class="agent-field agent-field-wide"><span>归属里程碑</span><select v-model="form.milestoneId" data-agent-field="milestoneId" class="agent-control" :aria-invalid="Boolean(issueFor('milestoneId'))" :aria-describedby="describedBy('milestoneId')" @change="syncProjectForMilestone"><option v-for="option in milestoneOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          <label class="agent-field"><span>重要性</span><select v-model="form.importance" data-agent-field="importance" class="agent-control" :aria-invalid="Boolean(issueFor('importance'))" :aria-describedby="describedBy('importance')"><option value="normal">普通</option><option value="important">重要</option></select></label>
          <label class="agent-field"><span>优先级</span><select v-model="form.priority" data-agent-field="priority" class="agent-control" :aria-invalid="Boolean(issueFor('priority'))" :aria-describedby="describedBy('priority')"><option value="">未设置</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label class="agent-field"><span>状态</span><select v-model="form.status" data-agent-field="status" class="agent-control" :aria-invalid="Boolean(issueFor('status'))" :aria-describedby="describedBy('status')"><option value="inbox">收集箱</option><option value="todo">待办</option><option value="in_progress">进行中</option><option value="waiting">等待</option><option value="done">完成</option><option value="cancelled">取消</option></select></label>
          <label class="agent-field"><span>预计用时（分钟）</span><input v-model="form.estimatedMinutes" data-agent-field="estimatedMinutes" class="agent-control" type="number" min="5" max="1440" :aria-invalid="Boolean(issueFor('estimatedMinutes'))" :aria-describedby="describedBy('estimatedMinutes')"></label>
          <label class="agent-field"><span>截止日期</span><input v-model="form.dueDate" data-agent-field="dueDate" class="agent-control" type="date" :aria-invalid="Boolean(issueFor('dueDate'))" :aria-describedby="describedBy('dueDate')"></label>
          <label class="agent-field"><span>截止时间</span><input v-model="form.dueTime" data-agent-field="dueTime" class="agent-control" type="time" :aria-invalid="Boolean(issueFor('dueTime'))" :aria-describedby="describedBy('dueTime')"></label>
          <label class="agent-field agent-field-wide"><span>提醒时间</span><input v-model="form.reminderAt" data-agent-field="reminderAt" class="agent-control" type="text" placeholder="2026-08-16T05:30:00.000Z" :aria-invalid="Boolean(issueFor('reminderAt'))" :aria-describedby="describedBy('reminderAt')"></label>
          <label class="agent-field agent-toggle-field"><input v-model="form.isFocus" data-agent-field="isFocus" type="checkbox" :aria-invalid="Boolean(issueFor('isFocus'))" :aria-describedby="describedBy('isFocus')"><span>设为今日焦点</span></label>
          <label class="agent-field agent-field-wide"><span>描述</span><textarea v-model="form.description" data-agent-field="description" class="agent-control" rows="4" :aria-invalid="Boolean(issueFor('description'))" :aria-describedby="describedBy('description')" /></label>
        </template>

        <template v-if="isCompletion">
          <label class="agent-field agent-toggle-field"><input v-model="form.completed" data-agent-field="completed" type="checkbox" :aria-invalid="Boolean(issueFor('completed'))" :aria-describedby="describedBy('completed')"><span>标记为已完成</span></label>
        </template>

        <div v-if="visibleErrorFields.length" class="agent-editor-issues agent-field-wide" aria-live="polite">
          <p v-for="field in visibleErrorFields" :id="errorId(field)" :key="field" class="agent-field-error">{{ issueFor(field) }}</p>
        </div>

        <div class="agent-editor-actions agent-field-wide">
          <button type="button" class="agent-control agent-quiet-button" @click="reset">撤销字段修改</button>
          <button type="button" data-agent-save-action class="agent-control agent-primary-button" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存此项' }}</button>
        </div>
      </form>
    </div>
  </aside>
</template>
