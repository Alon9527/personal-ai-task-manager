<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AgentPlanHeader from '../components/agent/AgentPlanHeader.vue'
import AgentActionList from '../components/agent/AgentActionList.vue'
import AgentActionEditor from '../components/agent/AgentActionEditor.vue'
import AgentPlanFooter from '../components/agent/AgentPlanFooter.vue'
import AgentDependencyDialog from '../components/agent/AgentDependencyDialog.vue'
import AgentDeleteConfirmDialog from '../components/agent/AgentDeleteConfirmDialog.vue'
import AgentExecutionResult from '../components/agent/AgentExecutionResult.vue'
import { useAgentPlan } from '../composables/useAgentPlan'
import { useWorkspace } from '../composables/useWorkspace'
import type { AgentAction } from '../services/agent-plan-schema'
import type { AgentActionResult } from '../services/agent-plan-executor'
import type { WorkspaceDocument } from '#shared/workspace'

const controller = useAgentPlan()
const workspace = useWorkspace()
const ui = useWorkspaceUi()
const router = useRouter()
const loading = ref(true)
const submitting = ref(false)
const editorInvalid = ref(false)
const lastSelectedActionId = ref<string | null>(null)
const deleteConfirmation = ref<{ token: string, document: WorkspaceDocument } | null>(null)
const conflictSnapshot = controller.latestConflictDocument
const successBannerVisible = ref(false)
const successBannerCount = ref(0)
let successTimer: ReturnType<typeof setTimeout> | null = null
let conflictFocusTimer: ReturnType<typeof setTimeout> | null = null
let successGeneration = 0
let focusedConflictRevision: string | null = null

const draft = controller.draft
const validation = controller.validation
const selectedAction = computed(() => draft.value?.actions.find(action => action.actionId === controller.selectedActionId.value) ?? null)
const selectedIssues = computed(() => displayIssues.value.filter(issue => issue.actionId === selectedAction.value?.actionId))
const blockingIssues = computed(() => validation.value?.issues.filter(issue => issue.code !== 'danger-confirmation') ?? [])
const pendingDependency = computed(() => controller.pendingDependencyDecision.value)
const dependencyParent = computed(() => {
  const actionId = pendingDependency.value?.actionId
  return actionId ? draft.value?.actions.find(action => action.actionId === actionId) ?? null : null
})
const dependencyDependents = computed(() => {
  const ids = pendingDependency.value?.dependentActionIds ?? []
  return ids.map(actionId => draft.value?.actions.find(action => action.actionId === actionId))
    .filter((action): action is AgentAction => Boolean(action))
    .map(action => ({ actionId: action.actionId, label: actionLabel(action) }))
})
const confirmDisabled = computed(() =>
  !draft.value
  || draft.value.status === 'applied'
  || (validation.value?.selectedCount ?? 0) === 0
  || blockingIssues.value.length > 0
  || controller.pendingDependencyDecision.value !== null
  || deleteConfirmation.value !== null
  || editorInvalid.value
  || submitting.value
  || controller.executing.value,
)
const confirmReason = computed(() => {
  if (draft.value?.status === 'applied') return '本计划已执行，不能重复写入。'
  if ((validation.value?.selectedCount ?? 0) === 0) return '至少选择一项改动后才能执行。'
  if (editorInvalid.value || blockingIssues.value.length > 0) return '请先修正计划中的问题。'
  if (controller.pendingDependencyDecision.value) return '请先处理未解决的上下级依赖。'
  if (deleteConfirmation.value) return '请先完成移入回收站的再次确认。'
  if (submitting.value || controller.executing.value) return '计划正在执行，请稍候。'
  if ((validation.value?.dangerousCount ?? 0) > 0) return '包含移入回收站操作，执行前还会再次确认。'
  return '确认后才会一次性写入本机工作区。'
})
const pageState = computed(() => {
  if (loading.value) return 'loading'
  if (controller.executionResult.value.length > 0 && !draft.value) return 'applied-results'
  if (!draft.value && controller.error.value) return 'error'
  if (!draft.value) return 'empty'
  return draft.value.status
})
const conflictIssues = computed(() => validation.value?.issues.filter(issue =>
  issue.code === 'conflict' || issue.code === 'missing-target') ?? [])
const selectedConflictIssue = computed(() => conflictIssues.value.find(issue => issue.actionId === selectedAction.value?.actionId) ?? null)
const selectedReloadAvailable = computed(() => {
  const action = selectedAction.value
  if (!action || !action.targetId || !selectedConflictIssue.value || !conflictSnapshot.value) return false
  return activeReloadTarget(action, conflictSnapshot.value)
})
const selectedConflictDetail = computed(() => describeConflict(
  selectedAction.value,
  selectedConflictIssue.value,
  conflictSnapshot.value,
  workspace.document.value,
))
const displayIssues = computed(() => (validation.value?.issues ?? []).map((issue) => {
  if (issue.code !== 'conflict' && issue.code !== 'missing-target') return issue
  const action = draft.value?.actions.find(item => item.actionId === issue.actionId) ?? null
  const detail = describeConflict(action, issue, conflictSnapshot.value, workspace.document.value)
  return { ...issue, message: `${detail.title}：${detail.message}` }
}))
const conflictRevision = computed(() => {
  if (draft.value?.status !== 'conflicted' || conflictIssues.value.length === 0) return null
  return JSON.stringify([draft.value.id, draft.value.updatedAt, conflictIssues.value.map(issue => [issue.actionId, issue.code, issue.field, issue.message])])
})

watch(() => controller.selectedActionId.value, (value) => {
  if (value) lastSelectedActionId.value = value
  editorInvalid.value = false
})

watch([
  () => controller.dangerConfirmationRequested.value,
  () => controller.dangerConfirmationToken.value,
], ([requested, token]) => {
  if (!requested || !token || (deleteConfirmation.value && deleteConfirmation.value.token !== token)) {
    deleteConfirmation.value = null
  }
}, { flush: 'sync' })

watch(() => controller.executionResult.value, (results) => {
  if (results.length === 0) return
  successGeneration += 1
  const generation = successGeneration
  if (successTimer) clearTimeout(successTimer)
  successBannerCount.value = results.length
  successBannerVisible.value = true
  successTimer = setTimeout(() => {
    if (generation === successGeneration) successBannerVisible.value = false
    successTimer = null
  }, 8_000)
}, { deep: false })

watch(conflictRevision, () => {
  void focusFirstConflictForRevision()
}, { flush: 'post' })

async function focusFirstConflictForRevision() {
  const revision = conflictRevision.value
  if (!revision || revision === focusedConflictRevision) return
  focusedConflictRevision = revision
  if (!controller.latestConflictDocument.value) await controller.refreshConflictSnapshot()
  const actionId = conflictIssues.value[0]?.actionId
  if (!actionId) return
  controller.selectAction(actionId)
  await nextTick()
  if (focusConflictRow(actionId)) return
  conflictFocusTimer = setTimeout(() => {
    focusConflictRow(actionId)
    conflictFocusTimer = null
  }, 0)
}

function focusConflictRow(actionId: string) {
  const row = globalThis.document?.querySelector<HTMLElement>(`[data-agent-action="${CSS.escape(actionId)}"]`)
  if (!row) return false
  row?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  row?.querySelector<HTMLElement>('[data-agent-row-select]')?.focus()
  return true
}

onMounted(() => {
  controller.loadDraft()
  loading.value = false
  void focusFirstConflictForRevision()
})

onBeforeUnmount(() => {
  successGeneration += 1
  if (successTimer) clearTimeout(successTimer)
  if (conflictFocusTimer) clearTimeout(conflictFocusTimer)
  successTimer = null
  conflictFocusTimer = null
  controller.clearExecutionResult()
})

function selectAction(actionId: string) {
  lastSelectedActionId.value = actionId
  controller.selectAction(actionId)
}

async function updateAction(actionId: string, patch: { reason: string, payload: Record<string, unknown> }) {
  const accepted = controller.updateAction(actionId, patch)
  return accepted
    ? { ok: true as const }
    : { ok: false as const, message: controller.error.value ?? '无法保存此项修改。' }
}

async function closeEditor() {
  const actionId = lastSelectedActionId.value
  controller.selectAction(null)
  await nextTick()
  if (!actionId) return
  const row = document.querySelector<HTMLElement>(`[data-agent-action="${CSS.escape(actionId)}"] [data-agent-row-select]`)
  row?.focus()
}

async function executePlan() {
  if (confirmDisabled.value || submitting.value) return
  submitting.value = true
  try {
    const result = await controller.requestExecution()
    const token = result.confirmationToken
    const snapshot = controller.dangerConfirmationDocument.value
    if (result.status === 'confirmation-required'
      && token
      && token === controller.dangerConfirmationToken.value
      && snapshot
      && (validation.value?.dangerousCount ?? 0) > 0) {
      deleteConfirmation.value = { token, document: structuredClone(snapshot) }
    }
    else {
      deleteConfirmation.value = null
    }
  }
  finally {
    submitting.value = false
  }
}

async function resolveDependency(resolution: 'deselect-dependents' | 'keep-and-reassign') {
  const decision = pendingDependency.value
  if (!decision) return false
  const dependentIds = [...decision.dependentActionIds]
  const accepted = controller.resolveDeselectedDependency(resolution)
  if (!accepted) return false
  if (resolution !== 'keep-and-reassign') return true
  await nextTick()
  const issue = validation.value?.issues.find(item =>
    item.code === 'dependency' && dependentIds.includes(item.actionId))
  const actionId = issue?.actionId ?? dependentIds[0]
  if (!actionId) return true
  controller.selectAction(actionId)
  await nextTick()
  const field = issue?.field?.replace(/^payload\./, '') ?? relationFieldFor(actionId)
  document.querySelector<HTMLElement>(`[data-agent-action-editor] [data-agent-field="${CSS.escape(field)}"]`)?.focus()
  return true
}

function cancelDependency() {
  return controller.resolveDeselectedDependency('cancel')
}

function cancelDeleteConfirmation(token: string) {
  controller.cancelDangerousConfirmation(token)
  deleteConfirmation.value = null
}

async function confirmDeleteExecution(token: string) {
  if (submitting.value || controller.executing.value) return
  submitting.value = true
  try {
    await controller.confirmDangerousExecution(token)
  }
  finally {
    deleteConfirmation.value = null
    submitting.value = false
  }
}

function discardPlan() {
  controller.discardDraft()
}

function replan() {
  const question = draft.value?.question
  if (!question) return
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  void router.push({
    path: '/',
    state: { agentReplanQuestion: question, agentReplanNonce: nonce },
  })
}

async function reloadSelectedConflict() {
  const actionId = selectedAction.value?.actionId
  if (!actionId) return
  await controller.reloadConflictedAction(actionId)
}

async function focusConflictRelation() {
  const field = selectedConflictDetail.value.relationField
  if (!field) return
  await nextTick()
  globalThis.document?.querySelector<HTMLElement>(`[data-agent-action-editor] [data-agent-field="${CSS.escape(field)}"]`)?.focus()
}

function closeSuccess() {
  successGeneration += 1
  if (successTimer) clearTimeout(successTimer)
  successTimer = null
  successBannerVisible.value = false
}

function closeError() {
  controller.clearError()
}

async function openExecutionResult(result: AgentActionResult) {
  if (result.outcome === 'deleted') {
    await router.push('/trash')
    return
  }
  if (result.entityType === 'project') {
    await router.push({ path: '/', query: { project: result.entityId } })
    ui.openEditProject(result.entityId)
    return
  }
  if (result.entityType === 'milestone') {
    const milestone = workspace.document.value.milestones.find(item => item.id === result.entityId)
    await router.push(milestone ? { path: '/', query: { project: milestone.projectId } } : '/')
    ui.openEditMilestone(result.entityId)
    return
  }
  const task = workspace.document.value.tasks.find(item => item.id === result.entityId)
  await router.push(task?.projectId ? { path: '/', query: { project: task.projectId } } : '/')
  ui.openEditTask(result.entityId)
}

function actionLabel(action: AgentAction) {
  if ('name' in action.payload && typeof action.payload.name === 'string') return action.payload.name
  if ('title' in action.payload && typeof action.payload.title === 'string') return action.payload.title
  if (action.targetId) {
    if (action.type.endsWith('Project')) return workspace.document.value.projects.find(item => item.id === action.targetId)?.name ?? '现有项目'
    if (action.type.endsWith('Milestone')) return workspace.document.value.milestones.find(item => item.id === action.targetId)?.title ?? '现有里程碑'
    return workspace.document.value.tasks.find(item => item.id === action.targetId)?.title ?? '现有任务'
  }
  return '计划改动'
}

function relationFieldFor(actionId: string) {
  const action = draft.value?.actions.find(item => item.actionId === actionId)
  if (action?.type === 'createMilestone') return 'projectId'
  if (action?.type === 'createTask') return action.payload.projectId?.kind === 'draft' ? 'projectId' : 'milestoneId'
  return 'projectId'
}

function activeReloadTarget(action: AgentAction, document: WorkspaceDocument) {
  if (!action.targetId) return false
  const expectedOwner = targetRecord(action, workspace.document.value)?.ownerId ?? null
  if (action.type.endsWith('Project')) {
    return document.projects.some(item => item.id === action.targetId && item.deletedAt === null
      && (expectedOwner === null || item.ownerId === expectedOwner))
  }
  if (action.type.endsWith('Milestone')) {
    const milestone = document.milestones.find(item => item.id === action.targetId && item.deletedAt === null)
    return Boolean(milestone && (expectedOwner === null || milestone.ownerId === expectedOwner) && document.projects.some(project =>
      project.id === milestone.projectId && project.deletedAt === null && project.ownerId === milestone.ownerId))
  }
  const task = document.tasks.find(item => item.id === action.targetId && item.deletedAt === null)
  if (!task || (expectedOwner !== null && task.ownerId !== expectedOwner)) return false
  const projectValid = task.projectId === null || document.projects.some(project =>
    project.id === task.projectId && project.deletedAt === null && project.ownerId === task.ownerId)
  const milestoneValid = task.milestoneId === null || document.milestones.some(milestone =>
    milestone.id === task.milestoneId && milestone.deletedAt === null
    && milestone.ownerId === task.ownerId && milestone.projectId === task.projectId)
  return projectValid && milestoneValid
}

function describeConflict(
  action: AgentAction | null,
  issue: { code: string, message: string } | null,
  latest: WorkspaceDocument | null,
  previous: WorkspaceDocument,
) {
  if (!action || !issue) return { title: '', message: '', relationField: null as string | null }
  if (!latest || !action.targetId) {
    return { title: '暂时无法确认当前记录', message: issue.message, relationField: null }
  }
  const expectedOwner = targetRecord(action, previous)?.ownerId ?? null
  const target = targetRecord(action, latest)
  if (!target) {
    const wrongType = [...latest.projects, ...latest.milestones, ...latest.tasks].some(item => item.id === action.targetId)
    return {
      title: wrongType ? '记录类型已变化' : '目标记录已不存在',
      message: wrongType ? '同一 ID 已不再对应原来的记录类型，请取消此项或让 AI 重新规划。' : '目标记录已不存在，请取消此项或让 AI 重新规划。',
      relationField: null,
    }
  }
  if (target.deletedAt !== null) {
    return { title: '目标记录已在回收站', message: '不能用回收站中的记录继续执行，请取消此项或让 AI 重新规划。', relationField: null }
  }
  if (expectedOwner && target.ownerId !== expectedOwner) {
    return { title: '记录所有者不匹配', message: '当前记录不属于这份工作区，不能重新载入。', relationField: null }
  }
  if ('projectId' in target && typeof target.projectId === 'string') {
    const parent = latest.projects.find(item => item.id === target.projectId && item.deletedAt === null && item.ownerId === target.ownerId)
    if (!parent) return { title: '项目归属已失效', message: '请在编辑器中重新选择有效项目，或让 AI 重新规划。', relationField: 'projectId' }
  }
  if ('milestoneId' in target && target.milestoneId !== null) {
    const parent = latest.milestones.find(item => item.id === target.milestoneId && item.deletedAt === null
      && item.ownerId === target.ownerId && item.projectId === target.projectId)
    if (!parent) return { title: '里程碑归属已失效', message: '请在编辑器中重新选择有效里程碑，或让 AI 重新规划。', relationField: 'milestoneId' }
  }
  if ('updatedAt' in target && target.updatedAt !== action.expectedUpdatedAt) {
    return { title: '记录时间已变化', message: '目标记录已被更新，请重新载入当前数据后再审阅。', relationField: null }
  }
  return { title: '记录关系发生冲突', message: issue.message, relationField: null }
}

function targetRecord(action: AgentAction, document: WorkspaceDocument) {
  if (!action.targetId) return null
  if (action.type.endsWith('Project')) return document.projects.find(item => item.id === action.targetId) ?? null
  if (action.type.endsWith('Milestone')) return document.milestones.find(item => item.id === action.targetId) ?? null
  return document.tasks.find(item => item.id === action.targetId) ?? null
}
</script>

<template>
  <main class="agent-plan-page" :data-agent-plan-state="pageState">
    <div v-if="successBannerVisible" data-agent-success-banner class="agent-transient-banner is-success" role="status" aria-live="polite">
      <UIcon name="i-lucide-check-circle-2" />
      <strong>已应用 {{ successBannerCount }} 项改动</strong>
      <button type="button" data-close-agent-success aria-label="关闭成功提示" @click="closeSuccess"><UIcon name="i-lucide-x" /></button>
    </div>

    <div v-if="controller.error.value" data-agent-error class="agent-transient-banner is-error" role="alert" aria-live="assertive">
      <UIcon name="i-lucide-circle-alert" />
      <span>{{ controller.error.value }}</span>
      <button type="button" data-close-agent-error aria-label="关闭错误提示" @click="closeError"><UIcon name="i-lucide-x" /></button>
    </div>

    <div v-if="loading" class="agent-plan-loading" role="status">
      <span class="agent-loading-line" /><span class="agent-loading-line short" />
      <span>正在读取计划草稿…</span>
    </div>

    <section v-else-if="!draft && controller.error.value && controller.executionResult.value.length === 0" data-agent-storage-error class="agent-plan-empty-state is-error" role="alert">
      <span class="agent-empty-symbol">!</span>
      <h1 class="agent-plan-heading">计划草稿未能读取</h1>
      <p>{{ controller.error.value }}</p>
      <NuxtLink to="/" class="agent-control agent-quiet-button">返回 AI 面板</NuxtLink>
    </section>

    <section v-else-if="!draft && controller.executionResult.value.length > 0" class="agent-result-page">
      <AgentExecutionResult
        :results="controller.executionResult.value"
        :document="workspace.document.value"
        @open="openExecutionResult"
      />
      <NuxtLink to="/" class="agent-control agent-primary-button">返回工作台</NuxtLink>
    </section>

    <section v-else-if="!draft" data-agent-empty class="agent-plan-empty-state">
      <span class="agent-empty-symbol">↗</span>
      <h1 class="agent-plan-heading">还没有待审阅的计划</h1>
      <p>先告诉 AI 你想完成什么。AI 只会提出计划，确认前不会改动任务。</p>
      <NuxtLink to="/" class="agent-control agent-primary-button">返回 AI 面板</NuxtLink>
    </section>

    <template v-else>
      <AgentPlanHeader
        :draft="draft"
        :selected-count="validation?.selectedCount ?? 0"
        @replan="replan"
      />

      <div v-if="draft.status === 'conflicted'" class="agent-plan-state-banner is-conflict" role="status">
        <strong>发现数据冲突</strong><span>工作区内容已变化，请逐项检查标记的问题。</span>
      </div>
      <div v-else-if="draft.status === 'applied' && controller.error.value" data-agent-cleanup-failed class="agent-plan-state-banner is-failed" role="status">
        <strong>数据已写入，草稿清理失败</strong><span>本次计划不会再次执行；可以关闭提示后继续查看实际结果。</span>
      </div>
      <div v-else-if="draft.status === 'failed'" class="agent-plan-state-banner is-failed" role="status">
        <strong>上次执行失败</strong><span>{{ controller.error.value ?? '计划已保留，可以检查后重试。' }}</span>
      </div>

      <div class="agent-review-workbench">
        <AgentActionList
          :actions="draft.actions"
          :selected-action-id="controller.selectedActionId.value"
          :issues="displayIssues"
          :document="workspace.document.value"
          @select="selectAction"
          @toggle="controller.toggleAction"
        />
        <AgentActionEditor
          v-if="selectedAction"
          :action="selectedAction"
          :actions="draft.actions"
          :document="workspace.document.value"
          :issues="selectedIssues"
          :save-action="updateAction"
          @close="closeEditor"
          @validity="editorInvalid = !$event"
        />
        <aside v-else class="agent-editor-placeholder" aria-label="未选择改动">
          <span>选择左侧一项改动以查看详情</span>
        </aside>
      </div>

      <section v-if="selectedConflictIssue" class="agent-conflict-recovery" aria-live="polite">
        <div>
          <strong>{{ selectedConflictDetail.title }}</strong>
          <p>{{ selectedConflictDetail.message }}</p>
        </div>
        <div class="agent-conflict-actions">
          <button v-if="selectedReloadAvailable" type="button" data-agent-reload-current class="agent-control agent-primary-button" @click="reloadSelectedConflict">重新载入当前数据</button>
          <button v-else-if="selectedConflictDetail.relationField" type="button" data-agent-reassign-conflict class="agent-control agent-primary-button" @click="focusConflictRelation">在编辑器中重新归属</button>
          <button v-else-if="selectedAction?.selected" type="button" data-agent-deselect-conflict class="agent-control agent-quiet-button" @click="controller.toggleAction(selectedAction.actionId, false)">取消选择此项</button>
          <button type="button" data-agent-conflict-replan class="agent-control agent-quiet-button" @click="replan">让 AI 重新规划</button>
        </div>
      </section>

      <AgentExecutionResult
        v-if="controller.executionResult.value.length > 0"
        :results="controller.executionResult.value"
        :document="workspace.document.value"
        @open="openExecutionResult"
      />

      <AgentPlanFooter
        :selected-count="validation?.selectedCount ?? 0"
        :total-count="draft.actions.length"
        :estimated-minutes="validation?.estimatedMinutes ?? 0"
        :issue-count="blockingIssues.length + (editorInvalid ? 1 : 0)"
        :dangerous-count="validation?.dangerousCount ?? 0"
        :executing="submitting || controller.executing.value"
        :disabled="confirmDisabled"
        :disabled-reason="confirmReason"
        @discard="discardPlan"
        @replan="replan"
        @confirm="executePlan"
      />

      <AgentDependencyDialog
        v-if="pendingDependency && dependencyParent"
        :parent-label="actionLabel(dependencyParent)"
        :dependents="dependencyDependents"
        :cancel-decision="cancelDependency"
        :resolve-decision="resolveDependency"
      />

      <AgentDeleteConfirmDialog
        v-if="deleteConfirmation"
        :actions="draft.actions"
        :document="deleteConfirmation.document"
        :confirmation-token="deleteConfirmation.token"
        :executing="submitting || controller.executing.value"
        @cancel="cancelDeleteConfirmation"
        @confirm="confirmDeleteExecution"
      />
    </template>
  </main>
</template>
