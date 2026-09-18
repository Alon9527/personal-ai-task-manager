<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import VoiceInputButton from '../workspace/VoiceInputButton.vue'
import ModelProviderDialog from './ModelProviderDialog.vue'
import {
  askAi,
  buildMiniMaxWorkspaceContext,
  generateAiBrief,
  getMiniMaxStatus,
  removeMiniMaxApiKey,
  saveMiniMaxApiKey,
  setMiniMaxRegion,
} from '../../services/minimax'
import {
  DEFAULT_AI_MODEL_TARGET,
  builtInTargetInfo,
  customTargetInfo,
  loadAiModelTarget,
  saveAiModelTarget,
} from '../../services/ai-model-target'
import type { AiModelTarget } from '../../services/ai-model-target'
import { listModelProviders } from '../../services/model-provider'
import type { ModelProviderList, ModelProviderProfile } from '../../services/model-provider'
import { useAgentPlan } from '../../composables/useAgentPlan'
import { agentPlanDraftSchema } from '../../services/agent-plan-schema'
import type { AgentAction, AgentPlanDraftV1 } from '../../services/agent-plan-schema'
import { validateAgentPlan } from '../../services/agent-plan-validation'
import { MINIMAX_MODELS } from '../../services/minimax-model'
import { workspaceDocumentSchema } from '#shared/workspace'
import type { WorkspaceDocument } from '#shared/workspace'
import type {
  MiniMaxAnswer,
  MiniMaxBrief,
  MiniMaxProgressItem,
  MiniMaxRegion,
  MiniMaxStatus,
} from '../../services/minimax'

const workspace = useWorkspace()
const ui = useWorkspaceUi()
const agentPlan = useAgentPlan()
const router = useRouter()
const status = ref<MiniMaxStatus | null>(null)
const statusLoading = ref(true)
const apiKey = ref('')
const region = ref<MiniMaxRegion>('cn')
const savingKey = ref(false)
const savingRegion = ref(false)
const generating = ref(false)
const asking = ref(false)
const removingKey = ref(false)
const showSettings = ref(false)
const confirmRemove = ref(false)
const showSources = ref(false)
const suggestionIgnored = ref(false)
const preparingSuggestion = ref(false)
const question = ref('')
const questionInput = ref<HTMLInputElement | null>(null)
const replanFocusPending = ref(false)
const brief = ref<MiniMaxBrief | null>(null)
const answer = ref<MiniMaxAnswer | null>(null)
const selectedTarget = ref<AiModelTarget>(DEFAULT_AI_MODEL_TARGET)
const providers = ref<ModelProviderProfile[]>([])
const providersLoading = ref(true)
const showProviderManager = useState<boolean>('model-manager-open', () => false)
const notice = ref<string | null>(null)
const statusError = ref<string | null>(null)
const providerError = ref<string | null>(null)
const proposalDraft = ref<AgentPlanDraftV1 | null>(null)
const proposalPersisted = ref(false)
const awaitingReplacement = ref(false)
const savingProposal = ref(false)
const lastSubmittedQuestion = ref('')
const error = ref<string | null>(null)
const lastExternalBriefRequest = ref(0)
let reviewNavigationStarted = false
let replanFocusTimer: ReturnType<typeof setTimeout> | null = null
let targetSession = 0
let briefRequest = 0
let askRequest = 0
let providerListRequest = 0

const contextCounts = computed(() => ({
  tasks: Math.min(workspace.tasks.value.length, 80),
  projects: Math.min(workspace.projects.value.length, 50),
  goals: Math.min(workspace.quarterGoals.value.length, 20),
}))
const configured = computed(() => status.value?.available && status.value.configured)
const isBuiltInTarget = computed(() => selectedTarget.value.kind === 'minimax')
const selectedTargetInfo = computed(() => selectedTarget.value.kind === 'minimax'
  ? builtInTargetInfo(selectedTarget.value.modelId)
  : customTargetInfo(selectedTarget.value.profileId, providers.value))
const selectedTargetValue = computed(() => selectedTarget.value.kind === 'minimax'
  ? `minimax:${selectedTarget.value.modelId}`
  : `custom:${selectedTarget.value.profileId}`)
const selectedCustomProfileId = computed(() => selectedTarget.value.kind === 'custom'
  ? selectedTarget.value.profileId
  : null)
const ready = computed(() => selectedTarget.value.kind === 'custom'
  ? selectedTargetInfo.value.ready
  : Boolean(configured.value && status.value?.region))
const canShowTargetContent = computed(() => isBuiltInTarget.value ? configured.value : ready.value)
const visibleError = computed(() => error.value
  ?? (isBuiltInTarget.value ? statusError.value : providerError.value))
const validProjectIds = computed(() => new Set(workspace.projects.value.map(project => project.id)))
const recoveryDraft = computed(() => {
  const current = agentPlan.draft.value
  if (!current || !isPendingPlan(current)) return null
  if (proposalPersisted.value && proposalDraft.value?.id === current.id) return null
  return current
})
const proposalSelectedCount = computed(() => proposalDraft.value?.actions.filter(action => action.selected).length ?? 0)
const proposalLabels = computed(() => proposalDraft.value?.actions.slice(0, 3).map(action => describeAgentAction(action)) ?? [])
const proposalRemainingCount = computed(() => Math.max(0, (proposalDraft.value?.actions.length ?? 0) - proposalLabels.value.length))

onMounted(() => {
  agentPlan.loadDraft()
  selectedTarget.value = loadAiModelTarget()
  lastExternalBriefRequest.value = ui.miniMaxBriefRequest.value
  consumeReplanHandoff()
  void refreshStatus()
  void refreshProviders()
})

function consumeReplanHandoff() {
  if (typeof window === 'undefined') return
  const state = window.history.state as Record<string, unknown> | null
  const handedQuestion = state?.agentReplanQuestion
  const nonce = state?.agentReplanNonce
  if (typeof handedQuestion !== 'string' || !handedQuestion.trim() || typeof nonce !== 'string') return

  question.value = handedQuestion.trim()
  replanFocusPending.value = true
  const nextState = { ...(state ?? {}) }
  delete nextState.agentReplanQuestion
  delete nextState.agentReplanNonce
  window.history.replaceState(nextState, '', window.location.href)
  void nextTick(() => {
    focusReplanQuestion()
  })
}

function focusReplanQuestion() {
  if (!questionInput.value) return false
  if (!questionInput.value.isConnected) {
    if (replanFocusTimer) clearTimeout(replanFocusTimer)
    replanFocusTimer = setTimeout(() => {
      replanFocusTimer = null
      focusReplanQuestion()
    }, 0)
    return false
  }
  questionInput.value.focus()
  replanFocusPending.value = false
  return true
}

onBeforeUnmount(() => {
  if (replanFocusTimer) clearTimeout(replanFocusTimer)
  replanFocusTimer = null
})

watch(() => ui.miniMaxBriefRequest.value, async (request) => {
  if (request <= lastExternalBriefRequest.value) return
  lastExternalBriefRequest.value = request
  if (isBuiltInTarget.value && statusLoading.value) await refreshStatus()
  if (!isBuiltInTarget.value && providersLoading.value) await refreshProviders()
  if (ready.value) await generateBrief()
  else if (isBuiltInTarget.value && configured.value) showSettings.value = true
})

watch(ready, async (value) => {
  if (!value || !replanFocusPending.value) return
  await nextTick()
  focusReplanQuestion()
})

async function refreshStatus() {
  statusLoading.value = true
  statusError.value = null
  try {
    const nextStatus = await getMiniMaxStatus()
    status.value = nextStatus
    region.value = nextStatus.region ?? 'cn'
  }
  catch (cause) {
    statusError.value = errorMessage(cause)
  }
  finally {
    statusLoading.value = false
  }
}

async function configure() {
  savingKey.value = true
  error.value = null
  try {
    status.value = await saveMiniMaxApiKey(apiKey.value, region.value)
    apiKey.value = ''
    showSettings.value = false
  }
  catch (cause) {
    error.value = errorMessage(cause)
  }
  finally {
    savingKey.value = false
  }
}

async function saveRegion() {
  savingRegion.value = true
  error.value = null
  try {
    status.value = await setMiniMaxRegion(region.value)
    brief.value = null
    answer.value = null
    showSettings.value = false
  }
  catch (cause) {
    error.value = errorMessage(cause)
  }
  finally {
    savingRegion.value = false
  }
}
async function generateBrief() {
  if (!ready.value || generating.value) return
  const session = targetSession
  const request = ++briefRequest
  const target = structuredClone(toRaw(selectedTarget.value))
  generating.value = true
  error.value = null
  showSources.value = false
  suggestionIgnored.value = false
  try {
    const response = await generateAiBrief(await currentContext(), target)
    if (session === targetSession && request === briefRequest) brief.value = response
  }
  catch (cause) {
    if (session === targetSession && request === briefRequest) error.value = errorMessage(cause)
  }
  finally {
    if (session === targetSession && request === briefRequest) generating.value = false
  }
}

async function proposeSuggestedTask() {
  const suggestion = brief.value?.suggestion
  const currentBrief = brief.value
  if (!suggestion || !currentBrief || preparingSuggestion.value) return
  preparingSuggestion.value = true
  error.value = null
  try {
    resetProposalPresentation()
    const snapshot = await currentContextSnapshot()
    const projectId = suggestion.projectId && validProjectIds.value.has(suggestion.projectId)
      ? suggestion.projectId
      : null
    const submitted = `采用今日简报建议：${suggestion.title.trim()}`
    lastSubmittedQuestion.value = submitted
    const response: MiniMaxAnswer = {
      answer: currentBrief.focus,
      actions: [{
        actionId: `brief-suggestion:${createPlanId()}`,
        type: 'createTask',
        reason: suggestion.rationale,
        selected: true,
        dangerous: false,
        draftRef: 'task:daily-brief-suggestion',
        payload: {
          projectId: projectId === null ? null : { kind: 'existing', id: projectId },
          milestoneId: null,
          title: suggestion.title,
          description: suggestion.description,
          priority: suggestion.priority,
          dueDate: suggestion.dueDate,
          dueTime: suggestion.dueTime,
          isFocus: suggestion.isFocus,
        },
      }],
      sources: currentBrief.sources,
      model: currentBrief.model,
      generatedAt: currentBrief.generatedAt,
      usage: currentBrief.usage,
    }
    answer.value = response
    await prepareAgentPlan(response, submitted, snapshot.document)
  }
  catch (cause) {
    error.value = `无法生成建议计划，请重试。${errorDetail(cause)}`
  }
  finally {
    preparingSuggestion.value = false
  }
}

async function refreshProviders() {
  const request = ++providerListRequest
  providersLoading.value = true
  providerError.value = null
  try {
    const next = await listModelProviders()
    if (request === providerListRequest) applyProviderList(next)
  }
  catch (cause) {
    if (request === providerListRequest) providerError.value = errorMessage(cause)
  }
  finally {
    if (request === providerListRequest) providersLoading.value = false
  }
}

function applyProviderList(next: ModelProviderList) {
  const selectedId = selectedTarget.value.kind === 'custom' ? selectedTarget.value.profileId : null
  const previousSelected = selectedId
    ? providers.value.find(profile => profile.id === selectedId)
    : undefined
  const previousFingerprint = previousSelected ? providerFingerprint(previousSelected) : null
  providers.value = next.profiles
  if (selectedId && !providers.value.some(profile => profile.id === selectedId)) {
    fallBackToMiniMaxM3()
    return
  }
  const nextSelected = selectedId
    ? providers.value.find(profile => profile.id === selectedId)
    : undefined
  if (previousFingerprint !== null
    && nextSelected
    && previousFingerprint !== providerFingerprint(nextSelected)) {
    invalidateAiPresentation()
  }
}

function providerFingerprint(profile: ModelProviderProfile) {
  return JSON.stringify([
    profile.baseUrl,
    profile.modelId,
    profile.credentialGeneration,
    profile.hasCredential,
    profile.updatedAt,
  ])
}

async function submitQuestion() {
  const submitted = question.value.trim()
  if (!submitted || asking.value || !ready.value) return
  const session = targetSession
  const request = ++askRequest
  const target = structuredClone(toRaw(selectedTarget.value))
  asking.value = true
  error.value = null
  try {
    resetProposalPresentation()
    const snapshot = await currentContextSnapshot()
    const response = await askAi(snapshot.context, submitted, target)
    if (session !== targetSession || request !== askRequest) return
    answer.value = response
    lastSubmittedQuestion.value = submitted
    question.value = ''
    if (response.actions.length > 0) {
      await prepareAgentPlan(response, submitted, snapshot.document)
    }
  }
  catch (cause) {
    if (session === targetSession && request === askRequest) error.value = errorMessage(cause)
  }
  finally {
    if (session === targetSession && request === askRequest) asking.value = false
  }
}

function appendQuestionVoice(text: string) {
  question.value = [question.value.trim(), text.trim()].filter(Boolean).join(' ')
}

function changeTarget(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const next = value.startsWith('custom:')
    ? { kind: 'custom' as const, profileId: value.slice('custom:'.length) }
    : { kind: 'minimax' as const, modelId: value.slice('minimax:'.length) }
  selectedTarget.value = saveAiModelTarget(next)
  invalidateAiPresentation()
  notice.value = null
  showSettings.value = false
  confirmRemove.value = false
}

function invalidateAiPresentation() {
  targetSession++
  briefRequest++
  askRequest++
  generating.value = false
  asking.value = false
  brief.value = null
  answer.value = null
  resetProposalPresentation()
}

function profilesChanged(next: ModelProviderList) {
  providerListRequest++
  providersLoading.value = false
  providerError.value = null
  applyProviderList(next)
}

function selectedProfileDeleted() {
  if (selectedTarget.value.kind === 'custom') fallBackToMiniMaxM3()
}

function fallBackToMiniMaxM3() {
  selectedTarget.value = saveAiModelTarget(DEFAULT_AI_MODEL_TARGET)
  invalidateAiPresentation()
  showSettings.value = false
  confirmRemove.value = false
  notice.value = '所选模型 API 已不可用，已切换到 MiniMax M3。'
}

async function deleteCredential() {
  if (!confirmRemove.value) {
    confirmRemove.value = true
    return
  }
  removingKey.value = true
  error.value = null
  try {
    status.value = await removeMiniMaxApiKey()
    brief.value = null
    answer.value = null
    resetProposalPresentation()
    showSettings.value = false
    confirmRemove.value = false
  }
  catch (cause) {
    error.value = errorMessage(cause)
  }
  finally {
    removingKey.value = false
  }
}

async function currentContext() {
  return (await currentContextSnapshot()).context
}

async function currentContextSnapshot() {
  if (!workspace.ready.value) await workspace.load()
  const document = workspaceDocumentSchema.parse(structuredClone(toRaw(workspace.document.value)))
  return {
    document,
    context: buildMiniMaxWorkspaceContext(document, new Date().toISOString()),
  }
}

async function prepareAgentPlan(response: MiniMaxAnswer, submitted: string, document: WorkspaceDocument) {
  try {
    const draft = buildAgentPlanDraft(response, submitted, document)
    proposalDraft.value = draft
    const existing = agentPlan.draft.value
    if (existing && isPendingPlan(existing) && existing.id !== draft.id) {
      awaitingReplacement.value = true
      return
    }
    await persistProposal(draft)
  }
  catch {
    proposalDraft.value = null
    proposalPersisted.value = false
    awaitingReplacement.value = false
    question.value = submitted
    error.value = 'AI 返回的计划格式无效，请重新生成。'
  }
}

function buildAgentPlanDraft(response: MiniMaxAnswer, submitted: string, document: WorkspaceDocument) {
  const initial = agentPlanDraftSchema.parse({
    version: 1,
    id: createPlanId(),
    question: submitted,
    model: response.model,
    createdAt: response.generatedAt,
    updatedAt: response.generatedAt,
    status: 'draft',
    actions: response.actions,
    validation: {
      executable: false,
      selectedCount: 0,
      dangerousCount: 0,
      estimatedMinutes: 0,
      issueCount: 0,
      issues: [],
    },
  })
  const validation = validateAgentPlan(initial, document)
  return agentPlanDraftSchema.parse({
    ...initial,
    validation: {
      ...validation,
      issueCount: validation.issues.length,
    },
  })
}

async function persistProposal(draft: AgentPlanDraftV1) {
  if (savingProposal.value) return
  savingProposal.value = true
  error.value = null
  try {
    const saved = agentPlan.setDraft(structuredClone(toRaw(draft)))
    if (!saved) throw new Error(agentPlan.error.value ?? '本机草稿存储不可用')
    proposalPersisted.value = true
    awaitingReplacement.value = false
    question.value = ''
  }
  catch (cause) {
    proposalPersisted.value = false
    question.value = lastSubmittedQuestion.value
    error.value = `无法保存 AI 计划草稿，请重试。${errorDetail(cause)}`
  }
  finally {
    savingProposal.value = false
  }
}

function retrySaveProposal() {
  if (!proposalDraft.value || awaitingReplacement.value) return
  return persistProposal(proposalDraft.value)
}

function replaceWithProposal() {
  if (!proposalDraft.value || !awaitingReplacement.value) return
  return persistProposal(proposalDraft.value)
}

async function openAgentPlan() {
  if (reviewNavigationStarted) return
  reviewNavigationStarted = true
  try {
    await router.push('/agent-plan')
  }
  catch (cause) {
    reviewNavigationStarted = false
    error.value = `无法打开计划审阅页，请重试。${errorDetail(cause)}`
  }
}

function resetProposalPresentation() {
  proposalDraft.value = null
  proposalPersisted.value = false
  awaitingReplacement.value = false
}

function isPendingPlan(draft: AgentPlanDraftV1) {
  return draft.status === 'draft' || draft.status === 'conflicted' || draft.status === 'failed'
}

function createPlanId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('当前环境无法生成安全的计划 ID')
  return globalThis.crypto.randomUUID()
}

function describeAgentAction(action: AgentAction) {
  const target = action.targetId ? targetName(action) : ''
  switch (action.type) {
    case 'createProject': return `新建项目：${action.payload.name}`
    case 'updateProject': return `更新项目：${target || '现有项目'}`
    case 'setProjectCompleted': return `${action.payload.completed ? '完成' : '恢复'}项目：${target || '现有项目'}`
    case 'deleteProject': return `建议移入回收站：${target || '项目'}`
    case 'createMilestone': return `新建里程碑：${action.payload.title}`
    case 'updateMilestone': return `更新里程碑：${target || '现有里程碑'}`
    case 'setMilestoneCompleted': return `${action.payload.completed ? '完成' : '恢复'}里程碑：${target || '现有里程碑'}`
    case 'deleteMilestone': return `建议移入回收站：${target || '里程碑'}`
    case 'createTask': return `新建任务：${action.payload.title}`
    case 'updateTask': return `更新任务：${target || '现有任务'}`
    case 'setTaskCompleted': return `${action.payload.completed ? '完成' : '恢复'}任务：${target || '现有任务'}`
    case 'deleteTask': return `建议移入回收站：${target || '任务'}`
  }
}

function targetName(action: AgentAction) {
  if (!action.targetId) return ''
  if (action.type.endsWith('Project')) {
    return workspace.projects.value.find(project => project.id === action.targetId)?.name ?? ''
  }
  if (action.type.endsWith('Milestone')) {
    return workspace.milestones.value.find(milestone => milestone.id === action.targetId)?.title ?? ''
  }
  return workspace.tasks.value.find(task => task.id === action.targetId)?.title ?? ''
}

function progressIcon(item: MiniMaxProgressItem) {
  if (item.kind === 'done') return 'i-lucide-check'
  if (item.kind === 'warning') return 'i-lucide-triangle-alert'
  return 'i-lucide-chart-no-axes-column-increasing'
}

function generatedLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function errorMessage(cause: unknown) {
  if (cause instanceof Error) return cause.message
  return typeof cause === 'string' ? cause : 'MiniMax 操作失败，请重试'
}

function errorDetail(cause: unknown) {
  const detail = errorMessage(cause).trim()
  return detail ? ` ${detail}` : ''
}
</script>

<template>
  <div class="context-inner" data-minimax-panel>
    <header class="context-header">
      <div class="ai-title">
        <span class="ai-orb"><UIcon name="i-lucide-sparkles" /></span>
        <div>
          <span>AI · {{ selectedTargetInfo.label }}</span>
          <strong>AI 计划助手</strong>
        </div>
      </div>
      <button
        v-if="isBuiltInTarget"
        type="button"
        :class="{ active: showSettings }"
        aria-label="MiniMax 设置"
        @click="showSettings = !showSettings; confirmRemove = false"
      >
        <UIcon name="i-lucide-settings-2" />
      </button>
    </header>

    <div class="context-scroll">
      <div v-if="visibleError" class="ai-error" role="alert">
        <UIcon name="i-lucide-circle-alert" />
        <span>{{ visibleError }}</span>
        <button type="button" aria-label="关闭错误" @click="error = null; statusError = null; providerError = null"><UIcon name="i-lucide-x" /></button>
      </div>

      <div v-if="notice" class="ai-notice" role="status">
        <UIcon name="i-lucide-info" />
        <span>{{ notice }}</span>
        <button type="button" aria-label="关闭提示" @click="notice = null"><UIcon name="i-lucide-x" /></button>
      </div>

      <section class="model-selector-card" data-model-selector>
        <div class="model-selector-heading">
          <span class="model-selector-icon"><UIcon name="i-lucide-brain-circuit" /></span>
          <div><b>调用模型</b><small>{{ selectedTargetInfo.description }}</small></div>
        </div>
        <select :value="selectedTargetValue" data-minimax-model aria-label="选择 AI 模型" @change="changeTarget">
          <optgroup label="MiniMax">
            <option v-for="option in MINIMAX_MODELS" :key="option.id" :value="`minimax:${option.id}`">{{ option.label }}</option>
          </optgroup>
          <optgroup label="自定义 API">
            <option v-for="profile in providers" :key="profile.id" :value="`custom:${profile.id}`">{{ profile.name }} · {{ profile.modelId }}</option>
          </optgroup>
        </select>
        <button type="button" data-manage-model-providers class="manage-model-providers" @click="showProviderManager = true">管理模型 API</button>
      </section>

      <section v-if="recoveryDraft" class="agent-plan-recovery" data-agent-plan-recovery>
        <span class="agent-plan-recovery__icon"><UIcon name="i-lucide-history" /></span>
        <div>
          <strong>继续审阅上次计划</strong>
          <small>
            已选 {{ recoveryDraft.actions.filter(action => action.selected).length }} / {{ recoveryDraft.actions.length }} 项
            · 更新于 {{ generatedLabel(recoveryDraft.updatedAt) }}
          </small>
        </div>
        <button type="button" class="agent-plan-control" @click="openAgentPlan">继续审阅</button>
      </section>

      <section v-if="isBuiltInTarget && statusLoading" class="ai-state-card">
        <span class="ai-loader" />
        <div><b>检查本机配置</b><small>不会连接 MiniMax</small></div>
      </section>

      <section v-else-if="isBuiltInTarget && !status?.available" class="ai-state-card desktop-note">
        <UIcon name="i-lucide-monitor-up" />
        <div>
          <b>请使用 Windows 桌面版</b>
          <small>API Key 只保存在本机 Windows 凭据管理器中。</small>
        </div>
      </section>

      <section v-else-if="isBuiltInTarget && !status?.configured" class="brief-card featured setup-card" data-minimax-setup>
        <div class="brief-label"><span /> 连接真实模型</div>
        <h3>配置 MiniMax API Key</h3>
        <p>密钥交给 Tauri 后端保存到 <b>Windows 凭据管理器</b>，不会写入 localStorage、数据库或日志。</p>
        <form data-save-minimax-key class="key-form" @submit.prevent="configure">
          <label class="region-field">
            <span>服务区域</span>
            <select v-model="region" data-minimax-region>
              <option value="cn">中国大陆 · platform.minimaxi.com</option>
              <option value="global">国际 · platform.minimax.io</option>
            </select>
            <small>必须与 API Key 的申请平台一致。</small>
          </label>
          <label>
            <span>API Key</span>
            <input
              v-model="apiKey"
              data-minimax-api-key
              type="password"
              autocomplete="off"
              spellcheck="false"
              placeholder="输入后仅保存到本机"
            >
          </label>
          <button type="submit" class="primary-ai-button" :disabled="savingKey || !apiKey.trim()">
            <UIcon :name="savingKey ? 'i-lucide-loader-circle' : 'i-lucide-shield-check'" />
            {{ savingKey ? '安全保存中…' : '保存并启用' }}
          </button>
        </form>
        <small class="privacy-note"><UIcon name="i-lucide-lock-keyhole" />保存密钥不会发起模型请求。</small>
      </section>

      <section v-else-if="!isBuiltInTarget && providersLoading" class="ai-state-card">
        <span class="ai-loader" />
        <div><b>读取模型 API</b><small>只读取本机保存的非敏感配置</small></div>
      </section>

      <section v-else-if="!isBuiltInTarget && !selectedTargetInfo.ready" class="brief-card featured setup-card" data-custom-provider-unready>
        <div class="brief-label"><span /> 模型 API 尚未就绪</div>
        <h3>{{ selectedTargetInfo.label }}</h3>
        <p>所选远程服务需要 API Key。本机 localhost 服务可以不配置 Key。</p>
        <button type="button" class="primary-ai-button" @click="showProviderManager = true">管理模型 API</button>
      </section>

      <template v-else-if="canShowTargetContent">
        <section v-if="isBuiltInTarget && !status?.region" class="brief-card featured region-required" data-minimax-region-required>
          <div class="brief-label"><span /> 需要确认服务区域</div>
          <h3>你的 Key 来自哪个 MiniMax 平台？</h3>
          <p>国内与国际 API Key 不能跨区域使用。选择只保存配置，不会发起模型请求。</p>
          <label class="region-field">
            <span>服务区域</span>
            <select v-model="region" data-minimax-region>
              <option value="cn">中国大陆 · platform.minimaxi.com</option>
              <option value="global">国际 · platform.minimax.io</option>
            </select>
          </label>
          <button type="button" class="primary-ai-button generate-button" :disabled="savingRegion" @click="saveRegion">
            {{ savingRegion ? '保存中…' : '保存区域并继续' }}
          </button>
        </section>

        <section v-if="isBuiltInTarget && showSettings" class="brief-block settings-card">
          <div class="settings-title">
            <div>
              <span>连接设置</span>
              <b>{{ selectedTargetInfo.modelId }}</b>
            </div>
            <span class="connected-badge"><i /> 已配置</span>
          </div>
          <p>凭据位置：Windows 凭据管理器。应用不会读取并展示密钥原文。</p>

          <label class="region-field settings-region">
            <span>当前服务区域</span>
            <select v-model="region" data-minimax-region>
              <option value="cn">中国大陆 · api.minimaxi.com</option>
              <option value="global">国际 · api.minimax.io</option>
            </select>
          </label>
          <button type="button" class="secondary-region-button" :disabled="savingRegion || region === status?.region" @click="saveRegion">
            {{ savingRegion ? '保存中…' : '应用区域' }}
          </button>
          <button type="button" class="danger-outline" :disabled="removingKey" @click="deleteCredential">
            {{ removingKey ? '移除中…' : confirmRemove ? '再次点击确认移除' : '移除 API Key' }}
          </button>
        </section>

        <section v-if="!brief && (!isBuiltInTarget || status?.region)" class="brief-card featured ready-card">
          <div class="brief-label"><span /> 真实调用已就绪</div>
          <div class="ready-model">
            <span class="model-mark"><UIcon name="i-lucide-brain-circuit" /></span>
            <div><b>{{ selectedTargetInfo.modelId }}</b><small>{{ isBuiltInTarget ? '官方 chat/completions' : 'OpenAI 兼容 chat/completions' }}</small></div>
          </div>
          <p>生成后将用当前任务与季度目标分析今日重点。不会自动请求，只有你点击时才调用所选模型。</p>
          <div class="send-scope">
            <span><b>{{ contextCounts.tasks }}</b> 条任务</span>
            <span><b>{{ contextCounts.projects }}</b> 个项目</span>
            <span><b>{{ contextCounts.goals }}</b> 个目标</span>
          </div>
          <button
            type="button"
            data-generate-minimax-brief
            class="primary-ai-button generate-button"
            :disabled="generating"
            @click="generateBrief"
          >
            <UIcon :name="generating ? 'i-lucide-loader-circle' : 'i-lucide-sparkles'" />
            {{ generating ? 'AI 正在分析…' : '生成真实今日简报' }}
          </button>
          <small class="privacy-note"><UIcon name="i-lucide-cloud-upload" />点击后上述工作数据会发送到 {{ selectedTargetInfo.label }}。</small>
        </section>

        <template v-if="brief">
          <section class="brief-card featured">
            <div class="brief-label"><span /> 今日焦点</div>
            <p>{{ brief.focus }}</p>
            <div class="source-row">
              <span>引用 {{ brief.sources.length }} 条真实任务</span>
              <button type="button" :disabled="!brief.sources.length" @click="showSources = !showSources">
                {{ showSources ? '收起来源' : '查看来源' }}
              </button>
            </div>
            <ul v-if="showSources" class="source-list">
              <li v-for="source in brief.sources" :key="source.taskId">
                <UIcon name="i-lucide-list-checks" />
                <span><b>{{ source.title }}</b><small>{{ source.projectName ?? '无项目' }}</small></span>
              </li>
            </ul>
          </section>

          <section class="brief-block">
            <h3>进展摘要 <span>{{ brief.progress.length }}</span></h3>
            <ul v-if="brief.progress.length">
              <li v-for="(item, index) in brief.progress" :key="`${item.kind}-${index}`">
                <span :class="['progress-dot', item.kind]"><UIcon :name="progressIcon(item)" /></span>
                <p>{{ item.text }}</p>
              </li>
            </ul>
            <p v-else class="empty-ai-copy">当前数据不足以生成进展判断。</p>
          </section>

          <section v-if="brief.suggestion && !suggestionIgnored" class="brief-block suggestion">
            <div class="brief-label"><span /> AI 建议</div>
            <p>{{ brief.suggestion.rationale }}</p>
            <div class="suggested-task-preview">
              <UIcon name="i-lucide-list-plus" />
              <span><b>{{ brief.suggestion.title }}</b><small>先生成计划草稿，审阅确认后才会写入</small></span>
            </div>
            <div class="suggestion-actions">
              <button type="button" data-create-suggestion-plan class="primary" :disabled="preparingSuggestion" @click="proposeSuggestedTask">
                {{ preparingSuggestion ? '生成中…' : '生成任务计划' }}
              </button>
              <button type="button" data-ignore-suggestion :disabled="preparingSuggestion" @click="suggestionIgnored = true">忽略</button>
            </div>
          </section>

          <section class="result-meta">
            <span>{{ brief.model }}</span>
            <span>{{ generatedLabel(brief.generatedAt) }}</span>
            <span v-if="brief.usage">{{ brief.usage.totalTokens }} tokens</span>
            <button type="button" :disabled="generating" @click="generateBrief">重新生成</button>
          </section>
        </template>

        <section v-if="answer" class="brief-block answer-card">
          <div class="brief-label"><span /> AI Agent</div>
          <p>{{ answer.answer }}</p>
          <div v-if="proposalDraft" class="agent-plan-proposal" data-agent-plan-proposal>
            <div class="agent-plan-proposal__title">
              <span><UIcon name="i-lucide-workflow" />AI 提议的计划</span>
              <b>{{ proposalDraft.actions.length }} 项操作</b>
            </div>
            <div class="agent-plan-proposal__summary">
              <span>已选 {{ proposalSelectedCount }} 项</span>
              <span>预计 {{ proposalDraft.validation.estimatedMinutes }} 分钟</span>
              <span :class="{ warning: proposalDraft.validation.issues.length > 0 }">
                {{ proposalDraft.validation.issues.length > 0 ? `${proposalDraft.validation.issues.length} 个问题待处理` : '可进入审阅' }}
              </span>
            </div>
            <ol>
              <li v-for="(label, index) in proposalLabels" :key="proposalDraft.actions[index]?.actionId ?? index">
                <UIcon :name="proposalDraft.actions[index]?.dangerous ? 'i-lucide-trash-2' : 'i-lucide-circle-dot'" />
                <span>{{ label }}</span>
              </li>
              <li v-if="proposalRemainingCount" class="agent-plan-proposal__remaining">另 {{ proposalRemainingCount }} 项</li>
            </ol>
            <p class="agent-plan-proposal__safety"><UIcon name="i-lucide-shield-check" />尚未修改任何任务，审阅确认后才会写入</p>
            <div v-if="awaitingReplacement" class="agent-plan-replacement" data-agent-plan-replacement>
              <p>上次计划仍在等待处理。请选择要继续审阅的版本。</p>
              <div class="agent-plan-proposal__actions">
                <button type="button" data-continue-existing-agent-plan class="agent-plan-control" @click="openAgentPlan">继续审阅上次计划</button>
                <button type="button" data-replace-agent-plan class="agent-plan-control primary" :disabled="savingProposal" @click="replaceWithProposal()">
                  {{ savingProposal ? '替换中…' : '用新计划替换' }}
                </button>
              </div>
            </div>
            <div v-else-if="proposalPersisted" class="agent-plan-proposal__actions">
              <button type="button" data-review-agent-plan class="agent-plan-control primary" @click="openAgentPlan">审阅计划</button>
            </div>
            <div v-else class="agent-plan-proposal__actions">
              <button type="button" data-retry-save-agent-plan class="agent-plan-control primary" :disabled="savingProposal" @click="retrySaveProposal()">
                {{ savingProposal ? '保存中…' : '重试保存计划' }}
              </button>
            </div>
          </div>
          <div class="answer-meta">
            <span>{{ answer.model }}</span><span>引用 {{ answer.sources.length }} 条任务</span><span v-if="answer.usage">{{ answer.usage.totalTokens }} tokens</span>
          </div>
        </section>
      </template>
    </div>

    <form v-if="ready" class="ask-ai" @submit.prevent="submitQuestion">
      <UIcon :name="asking ? 'i-lucide-loader-circle' : 'i-lucide-sparkles'" />
      <input ref="questionInput" v-model="question" data-minimax-question aria-label="询问 AI" :disabled="asking" placeholder="让 Agent 新建、修改、完成或整理任务…">
      <VoiceInputButton @transcript="appendQuestionVoice" />
      <button type="submit" :disabled="asking || !question.trim()" aria-label="发送问题"><UIcon name="i-lucide-arrow-up" /></button>
    </form>
    <ModelProviderDialog
      :open="showProviderManager"
      :selected-profile-id="selectedCustomProfileId"
      @close="showProviderManager = false"
      @change="profilesChanged"
      @fallback="selectedProfileDeleted"
    />
  </div>
</template>

<style scoped>
.context-header>button{display:grid;width:30px;height:30px;place-items:center;border:0;border-radius:7px;background:transparent;color:#8a8e96;cursor:pointer}.context-header>button:hover,.context-header>button.active{background:#f0effc;color:#6258d7}
.ai-title>div{display:grid}.ai-title>div>span{color:#848892;font-size:11px;font-weight:800;letter-spacing:.12em}.ai-error,.ai-notice{display:grid;grid-template-columns:16px 1fr 22px;gap:8px;align-items:start;margin-bottom:12px;padding:10px;border:1px solid #efc9c9;border-radius:9px;background:#fff6f6;color:#a54444;font-size:12px;line-height:1.45}.ai-error button,.ai-notice button{border:0;background:transparent;color:inherit;cursor:pointer}.ai-notice{border-color:#d9d5ff;background:#f7f6ff;color:#5d55b7}
.ai-state-card{display:flex;gap:11px;align-items:center;padding:16px;border:1px solid #e2e3e7;border-radius:11px;background:#fff;color:#686d76}.ai-state-card>div{display:grid;gap:3px}.ai-state-card b{color:#3c4048;font-size:14px}.ai-state-card small{font-size:11px;line-height:1.5}.ai-loader{width:18px;height:18px;border:2px solid #ddd9ff;border-top-color:#665bd7;border-radius:50%;animation:spin .8s linear infinite}.desktop-note>svg{font-size:20px;color:#6a60d9}
.setup-card h3{margin:15px 0 0;color:#2f333b;font-size:15px}.setup-card p,.ready-card p,.settings-card>p{font-size:13px;line-height:1.65}.key-form{display:grid;gap:10px}.key-form label{display:grid;gap:5px}.key-form label>span{color:#6e727b;font-size:11px;font-weight:700}.key-form input{width:100%;height:38px;padding:0 10px;border:1px solid #d9d9e2;border-radius:8px;outline:0;background:#fff;color:#30333a;font:inherit;font-size:13px}.key-form input:focus{border-color:#8b82e6;box-shadow:0 0 0 3px #ebe9ff}
.primary-ai-button{display:flex;gap:7px;align-items:center;justify-content:center;min-height:36px;padding:0 13px;border:1px solid #6258d7;border-radius:8px;background:#6b61df;color:#fff;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 7px 18px rgb(91 80 205 / 18%)}.primary-ai-button:disabled{opacity:.55;cursor:not-allowed}.privacy-note{display:flex;gap:5px;align-items:center;margin-top:10px;color:#9599a2;font-size:11px;line-height:1.45}
.manage-model-providers{min-height:36px;padding:0 11px;border:1px solid #d9d6f2;border-radius:8px;background:#f7f6ff;color:#5f56c7;font-size:13px;font-weight:700;cursor:pointer}
.settings-card{margin-top:0;background:#fafafd}.settings-title{display:flex;align-items:center;justify-content:space-between}.settings-title>div{display:grid;gap:3px}.settings-title span{color:#8b8f97;font-size:11px}.settings-title b{font-size:14px}.connected-badge{display:flex!important;gap:5px;align-items:center;padding:4px 7px;border-radius:999px;background:#eaf8f1;color:#368062!important}.connected-badge i{width:5px;height:5px;border-radius:50%;background:#42a477}.danger-outline{min-height:30px;padding:0 10px;border:1px solid #e4bcbc;border-radius:7px;background:#fff7f7;color:#b84c4c;font-size:11px;cursor:pointer}
.ready-model{display:flex;gap:10px;align-items:center;margin-top:14px}.model-mark{display:grid;width:34px;height:34px;place-items:center;border:1px solid #ddd9ff;border-radius:10px;background:#fff;color:#6258d7}.ready-model>div{display:grid;gap:2px}.ready-model b{font-size:14px}.ready-model small{color:#9699a1;font-size:11px}.send-scope{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:13px 0}.send-scope span{display:grid;place-items:center;min-height:42px;border:1px solid #e6e4f7;border-radius:8px;background:rgb(255 255 255 / 70%);color:#8a8e97;font-size:11px}.send-scope b{color:#4f49a8;font-size:15px}.generate-button{width:100%}
.source-list{display:grid;gap:7px;margin:12px 0 0;padding:10px;border-top:1px solid #e8e5fa;list-style:none}.source-list li{display:grid;grid-template-columns:16px 1fr;gap:7px;align-items:start;color:#665bd2}.source-list li>span,.suggested-task-preview>span{display:grid;gap:2px}.source-list b,.suggested-task-preview b{color:#4e525a;font-size:12px}.source-list small,.suggested-task-preview small{color:#999da5;font-size:11px}.progress-dot{display:grid;width:18px;height:18px;place-items:center;border-radius:50%;font-size:11px}.progress-dot.done{background:#e7f7ef;color:#24835d}.progress-dot.progress{background:#eceaff;color:#6258d7}.progress-dot.warning{background:#fff1df;color:#c27620}.empty-ai-copy{margin:0;color:#9599a2;font-size:12px}.suggested-task-preview{display:grid;grid-template-columns:20px 1fr;gap:8px;align-items:start;margin:11px 0;padding:9px;border:1px solid #e5e3f3;border-radius:8px;background:#fff;color:#665bd2}.created-note{display:flex;gap:6px;align-items:center!important;margin-bottom:0!important;color:#32805f!important;font-size:12px!important}
.result-meta{display:flex;gap:7px;align-items:center;margin-top:10px;color:#9a9da5;font-size:11px}.result-meta span+span:before{content:'·';margin-right:7px}.result-meta button{margin-left:auto;border:0;background:transparent;color:#655bd2;font-size:11px;cursor:pointer}.answer-card p{margin:12px 0;color:#444851;font-size:13px;line-height:1.65}.answer-meta{display:flex;gap:10px;color:#989ca4;font-size:11px}
.ask-ai{grid-template-columns:18px minmax(0,1fr) 32px 26px}.ask-ai>button{display:grid;width:24px;height:24px;place-items:center;border:0;border-radius:6px;background:#6b61df;color:#fff;cursor:pointer}.ask-ai>button:disabled{opacity:.4}.ask-ai svg:global(.lucide-loader-circle),.primary-ai-button svg:global(.lucide-loader-circle){animation:spin .8s linear infinite}
.region-field{display:grid;gap:5px}.region-field>span{color:#6e727b;font-size:11px;font-weight:700}.region-field>small{color:#9699a2;font-size:11px}.region-field select{width:100%;height:38px;padding:0 9px;border:1px solid #d9d9e2;border-radius:8px;outline:0;background:#fff;color:#3d4149;font:inherit;font-size:12px}.region-field select:focus{border-color:#8b82e6;box-shadow:0 0 0 3px #ebe9ff}.region-required h3{margin:14px 0 7px;font-size:14px}.region-required p{color:#696e77;font-size:12px;line-height:1.6}.region-required .region-field{margin:12px 0}.settings-region{margin:10px 0}.secondary-region-button{min-height:30px;margin-right:7px;padding:0 10px;border:1px solid #d9d6f2;border-radius:7px;background:#f4f2ff;color:#5f56c7;font-size:11px;cursor:pointer}.secondary-region-button:disabled{opacity:.45;cursor:not-allowed}@keyframes spin{to{transform:rotate(360deg)}}
.model-field{margin-bottom:0}.agent-plan-recovery{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:10px;align-items:center;margin-bottom:12px;padding:12px;border:1px solid #ddd9ff;border-radius:10px;background:#faf9ff}.agent-plan-recovery__icon{display:grid;width:32px;height:32px;place-items:center;border-radius:9px;background:#ece9ff;color:#6258d7}.agent-plan-recovery>div{display:grid;gap:3px;min-width:0}.agent-plan-recovery strong{color:#3f4350;font-size:14px}.agent-plan-recovery small{color:#7f8490;font-size:13px;line-height:1.45}.agent-plan-proposal{display:grid;gap:11px;margin:13px 0;padding:13px;border:1px solid #d9d5ff;border-radius:10px;background:linear-gradient(145deg,#fbfaff,#f7f6ff)}.agent-plan-proposal__title{display:flex;align-items:center;justify-content:space-between;gap:8px}.agent-plan-proposal__title>span{display:flex;gap:7px;align-items:center;color:#554bc3;font-size:15px;font-weight:800}.agent-plan-proposal__title>b{padding:4px 7px;border-radius:7px;background:#ebe8ff;color:#5d53cb;font-size:13px}.agent-plan-proposal__summary{display:flex;flex-wrap:wrap;gap:6px}.agent-plan-proposal__summary span{padding:4px 7px;border:1px solid #e4e1f7;border-radius:999px;background:#fff;color:#6f7480;font-size:13px}.agent-plan-proposal__summary span.warning{border-color:#f1d3a8;background:#fff8ee;color:#a4661c}.agent-plan-proposal ol{display:grid;gap:7px;margin:0;padding:0;list-style:none}.agent-plan-proposal li{display:grid;grid-template-columns:18px minmax(0,1fr);gap:7px;align-items:start;color:#4a4e57;font-size:13px;line-height:1.45}.agent-plan-proposal li>svg{color:#6960d7}.agent-plan-proposal li.agent-plan-proposal__remaining{display:block;padding-left:25px;color:#858a95}.agent-plan-proposal__safety{display:flex;gap:6px;align-items:flex-start!important;margin:0!important;color:#666c78!important;font-size:13px!important}.agent-plan-replacement{display:grid;gap:8px;padding-top:9px;border-top:1px solid #e2dff5}.agent-plan-replacement>p{margin:0!important;color:#6d647e!important;font-size:13px!important}.agent-plan-proposal__actions{display:flex;flex-wrap:wrap;gap:8px}.agent-plan-control{min-height:40px;padding:0 13px;border:1px solid #d9d9e3;border-radius:8px;background:#fff;color:#606570;font-size:13px;font-weight:700;cursor:pointer}.agent-plan-control.primary{border-color:#6258d7;background:#6b61df;color:#fff}.agent-plan-control:disabled{opacity:.55;cursor:not-allowed}
/* Keep the information-dense Huly layout while removing unreadable micro-text. */
.ai-title>div>span{font-size:12px}.ai-state-card b,.settings-title b,.ready-model b{font-size:15px}.ai-state-card small,.key-form label>span,.region-field>span,.danger-outline,.secondary-region-button{font-size:13px}.setup-card p,.ready-card p,.settings-card>p,.key-form input,.region-field select,.answer-card p{font-size:14px}.privacy-note,.settings-title span,.ready-model small,.send-scope span,.source-list small,.suggested-task-preview small,.result-meta,.result-meta button,.answer-meta,.region-field>small{font-size:12px}.source-list b,.suggested-task-preview b,.empty-ai-copy,.created-note{font-size:13px!important}
</style>
