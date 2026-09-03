import { computed, ref, toRaw } from 'vue'
import { deriveWorkspace, workspaceDocumentSchema } from '#shared/workspace'
import type { Milestone, Project, QuarterGoal, QuarterKey, Task, TaskGroup, WorkspaceDocument } from '#shared/workspace'
import type {
  CreateProjectInput,
  CreateMilestoneInput,
  CreateQuarterGoalInput,
  CreateTaskInput,
  UpdateProjectInput,
  UpdateMilestoneInput,
  UpdateTaskInput,
  UpdateQuarterGoalInput,
  WorkspaceGateway,
} from '../data/workspace-gateway'
import { WorkspaceError } from '../data/workspace-gateway'
import { createAgentPlanStorage } from '../services/agent-plan-storage'
import type { AgentPlanStorage } from '../services/agent-plan-storage'
import { WorkspaceTransaction } from '../data/workspace-transaction'

const emptyWorkspace = (): WorkspaceDocument => ({
  version: 3,
  projects: [],
  milestones: [],
  tasks: [],
  quarterGoals: [],
})

const UNDO_DISMISS_MS = 8_000

export function createWorkspaceModel(
  initialGateway: WorkspaceGateway | null = null,
  initialAgentPlanStorage: AgentPlanStorage | null = defaultAgentPlanStorage(),
) {
  let gateway = initialGateway
  const agentPlanStorage = initialAgentPlanStorage
  const document = ref<WorkspaceDocument>(emptyWorkspace())
  const loading = ref(false)
  const saving = ref(false)
  const ready = ref(false)
  const error = ref<string | null>(null)
  const backendMode = ref<'local' | 'sqlite' | 'supabase'>(initialGateway?.mode ?? 'local')
  const fallbackReason = ref<string | null>(null)
  const lastDeleted = ref<{ kind: 'project' | 'milestone' | 'task' | 'quarter-goal', id: string, label: string } | null>(null)
  let undoDismissTimer: ReturnType<typeof setTimeout> | null = null
  let mutationTail: Promise<void> = Promise.resolve()
  const view = computed(() => deriveWorkspace(document.value))
  const milestones = computed(() => document.value.milestones
    .filter(milestone => milestone.deletedAt === null)
    .sort(bySortOrder))

  function requireGateway() {
    if (!gateway) throw new Error('数据源尚未就绪')
    return gateway
  }

  async function load() {
    if (!gateway) return
    loading.value = true
    error.value = null
    try {
      document.value = await gateway.loadWorkspace({ includeDeleted: true })
      ready.value = true
    } catch (cause) {
      error.value = errorMessage(cause)
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function refresh() {
    document.value = await requireGateway().loadWorkspace({ includeDeleted: true })
    ready.value = true
  }

  async function readLatestDocument() {
    await mutationTail
    const latest = await requireGateway().loadWorkspace({ includeDeleted: true })
    return structuredClone(workspaceDocumentSchema.parse(latest))
  }

  async function replaceWorkspaceDocument(
    nextDocument: WorkspaceDocument,
    expectedBase?: WorkspaceDocument,
  ) {
    return enqueueMutation(async () => {
      saving.value = true
      error.value = null
      try {
        if (expectedBase) {
          const expected = workspaceDocumentSchema.parse(structuredClone(expectedBase))
          const current = workspaceDocumentSchema.parse(
            await requireGateway().loadWorkspace({ includeDeleted: true }),
          )
          if (!sameWorkspaceDocument(current, expected)) {
            throw new WorkspaceError('conflict', '工作区已发生变化，请按当前数据重新检查计划。')
          }
        }
        const replaced = await new WorkspaceTransaction(requireGateway()).replace(nextDocument)
        document.value = structuredClone(replaced)
        ready.value = true
        return structuredClone(replaced)
      }
      catch (cause) {
        error.value = errorMessage(cause)
        throw cause
      }
      finally {
        saving.value = false
      }
    })
  }

  async function persistThenRefresh(
    persist: () => Promise<unknown>,
    rollbackPersistFailure?: () => void,
  ) {
    try {
      await persist()
    } catch (cause) {
      rollbackPersistFailure?.()
      error.value = errorMessage(cause)
      throw cause
    }

    try {
      await refresh()
    } catch (cause) {
      error.value = errorMessage(cause)
    }
  }

  async function commit(persist: () => Promise<unknown>) {
    return enqueueMutation(async () => {
      saving.value = true
      error.value = null
      try {
        await persistThenRefresh(persist)
      } finally {
        saving.value = false
      }
    })
  }

  async function optimistic(update: () => void, persist: () => Promise<unknown>) {
    return enqueueMutation(async () => {
      const snapshot = structuredClone(toRaw(document.value))
      saving.value = true
      error.value = null
      update()
      try {
        await persistThenRefresh(persist, () => {
          document.value = snapshot
        })
      } finally {
        saving.value = false
      }
    })
  }

  function enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result> {
    const run = mutationTail.then(operation, operation)
    mutationTail = run.then(() => undefined, () => undefined)
    return run
  }

  function setGateway(nextGateway: WorkspaceGateway, reason: string | null = null) {
    gateway = nextGateway
    backendMode.value = nextGateway.mode
    fallbackReason.value = reason
  }

  function dismissError() {
    error.value = null
  }

  function dismissLastDelete() {
    if (undoDismissTimer) clearTimeout(undoDismissTimer)
    undoDismissTimer = null
    lastDeleted.value = null
  }

  function offerUndo(action: NonNullable<typeof lastDeleted.value>) {
    dismissLastDelete()
    lastDeleted.value = action
    undoDismissTimer = setTimeout(() => {
      if (lastDeleted.value?.kind === action.kind && lastDeleted.value.id === action.id) {
        lastDeleted.value = null
      }
      undoDismissTimer = null
    }, UNDO_DISMISS_MS)
  }

  async function emptyTrash() {
    await commit(() => requireGateway().emptyTrash())
    dismissLastDelete()
  }

  async function clearWorkspaceData() {
    return enqueueMutation(async () => {
      saving.value = true
      error.value = null
      try {
        await requireGateway().clearWorkspaceData()
        document.value = emptyWorkspace()
        ready.value = true
        dismissLastDelete()
        try {
          agentPlanStorage?.clear()
        }
        catch (cause) {
          const message = `工作区数据已清空，但 Agent 计划草稿清理失败：${errorMessage(cause)}`
          error.value = message
          throw new Error(message, { cause })
        }
      }
      catch (cause) {
        error.value ??= errorMessage(cause)
        throw cause
      }
      finally {
        saving.value = false
      }
    })
  }

  async function createProject(input: CreateProjectInput) {
    await commit(() => requireGateway().createProject(input))
  }

  async function updateProject(id: string, patch: UpdateProjectInput) {
    await commit(() => requireGateway().updateProject(id, patch))
  }

  async function deleteProject(id: string) {
    const label = view.value.projects.find(item => item.id === id)?.name ?? '项目'
    await optimistic(() => {
      const timestamp = new Date().toISOString()
      const project = document.value.projects.find(item => item.id === id && item.deletedAt === null)
      if (project) project.deletedAt = timestamp
      for (const milestone of document.value.milestones) {
        if (milestone.projectId === id && milestone.deletedAt === null) milestone.deletedAt = timestamp
      }
      for (const task of document.value.tasks) {
        if (task.projectId === id && task.deletedAt === null) task.deletedAt = timestamp
      }
    }, () => requireGateway().deleteProject(id))
    offerUndo({ kind: 'project', id, label })
  }

  async function restoreProject(id: string) {
    await optimistic(() => {
      const project = document.value.projects.find(item => item.id === id && item.deletedAt !== null)
      if (!project) return
      const deletedAt = project.deletedAt
      project.deletedAt = null
      for (const milestone of document.value.milestones) {
        if (milestone.projectId === id && milestone.deletedAt === deletedAt) milestone.deletedAt = null
      }
      for (const task of document.value.tasks) {
        if (task.projectId === id && task.deletedAt === deletedAt) task.deletedAt = null
      }
    }, () => requireGateway().restoreProject(id))
    if (lastDeleted.value?.kind === 'project' && lastDeleted.value.id === id) dismissLastDelete()
  }

  async function reorderProjects(orderedIds: string[]) {
    await optimistic(
      () => applyOrder(document.value.projects, orderedIds),
      () => requireGateway().reorderProjects(orderedIds),
    )
  }

  async function createMilestone(input: CreateMilestoneInput) {
    await commit(() => requireGateway().createMilestone(input))
  }

  async function updateMilestone(id: string, patch: UpdateMilestoneInput) {
    await commit(() => requireGateway().updateMilestone(id, patch))
  }

  async function deleteMilestone(id: string) {
    const label = milestones.value.find(item => item.id === id)?.title ?? '里程碑'
    await optimistic(() => {
      const milestone = document.value.milestones.find(item => item.id === id && item.deletedAt === null)
      if (milestone) milestone.deletedAt = new Date().toISOString()
      for (const task of document.value.tasks) {
        if (task.milestoneId === id) task.milestoneId = null
      }
    }, () => requireGateway().deleteMilestone(id))
    offerUndo({ kind: 'milestone', id, label })
  }

  async function restoreMilestone(id: string) {
    await optimistic(() => {
      const milestone = document.value.milestones.find(item => item.id === id && item.deletedAt !== null)
      if (!milestone) return
      milestone.sortOrder = document.value.milestones
        .filter(item => item.id !== id && item.projectId === milestone.projectId && item.deletedAt === null)
        .reduce((maximum, item) => Math.max(maximum, item.sortOrder), -1) + 1
      milestone.deletedAt = null
    }, () => requireGateway().restoreMilestone(id))
    if (lastDeleted.value?.kind === 'milestone' && lastDeleted.value.id === id) dismissLastDelete()
  }

  async function reorderMilestones(projectId: string, orderedIds: string[]) {
    await optimistic(
      () => applyOrder(document.value.milestones, orderedIds),
      () => requireGateway().reorderMilestones(projectId, orderedIds),
    )
  }

  async function createTask(input: CreateTaskInput) {
    await commit(() => requireGateway().createTask(input))
  }

  async function updateTask(id: string, patch: UpdateTaskInput) {
    await commit(() => requireGateway().updateTask(id, patch))
  }

  async function deleteTask(id: string) {
    const label = view.value.tasks.find(item => item.id === id)?.title ?? '任务'
    await optimistic(() => {
      const task = document.value.tasks.find(item => item.id === id && item.deletedAt === null)
      if (task) task.deletedAt = new Date().toISOString()
    }, () => requireGateway().deleteTask(id))
    offerUndo({ kind: 'task', id, label })
  }

  async function restoreTask(id: string) {
    await optimistic(() => {
      const task = document.value.tasks.find(item => item.id === id && item.deletedAt !== null)
      if (!task) return
      if (task.milestoneId !== null) {
        const milestone = document.value.milestones.find(
          item => item.id === task.milestoneId && item.deletedAt === null,
        )
        const projectActive = milestone !== undefined && document.value.projects.some(
          project => project.id === milestone.projectId && project.deletedAt === null,
        )
        if (milestone && projectActive) task.projectId = milestone.projectId
        else task.milestoneId = null
      }
      if (task.projectId !== null && !document.value.projects.some(
        project => project.id === task.projectId && project.deletedAt === null,
      )) task.projectId = null
      task.deletedAt = null
    }, () => requireGateway().restoreTask(id))
    if (lastDeleted.value?.kind === 'task' && lastDeleted.value.id === id) dismissLastDelete()
  }

  async function setTaskCompleted(id: string, completed: boolean) {
    await optimistic(
      () => {
        const task = findTask(document.value, id)
        task.completedAt = completed ? new Date().toISOString() : null
      },
      () => requireGateway().setTaskCompleted(id, completed),
    )
  }

  async function startTask(id: string) {
    await commit(() => requireGateway().startTask(id))
  }

  async function snoozeTask(id: string, until: string) {
    await commit(() => requireGateway().snoozeTask(id, until))
  }

  async function moveTask(id: string, isFocus: boolean) {
    await optimistic(
      () => { findTask(document.value, id).isFocus = isFocus },
      () => requireGateway().updateTask(id, { isFocus }),
    )
  }

  async function reorderTasks(group: TaskGroup, orderedIds: string[]) {
    await optimistic(
      () => applyOrder(document.value.tasks, orderedIds),
      () => requireGateway().reorderTasks(group, orderedIds),
    )
  }

  async function createQuarterGoal(input: CreateQuarterGoalInput) {
    await commit(() => requireGateway().createQuarterGoal(input))
  }

  async function updateQuarterGoal(id: string, patch: UpdateQuarterGoalInput) {
    await commit(() => requireGateway().updateQuarterGoal(id, patch))
  }

  async function deleteQuarterGoal(id: string) {
    const label = view.value.quarterGoals.find(item => item.id === id)?.title ?? '季度目标'
    await optimistic(() => {
      const goal = document.value.quarterGoals.find(item => item.id === id && item.deletedAt === null)
      if (goal) goal.deletedAt = new Date().toISOString()
    }, () => requireGateway().deleteQuarterGoal(id))
    offerUndo({ kind: 'quarter-goal', id, label })
  }

  async function restoreQuarterGoal(id: string) {
    await optimistic(() => {
      const goal = document.value.quarterGoals.find(item => item.id === id && item.deletedAt !== null)
      if (goal) goal.deletedAt = null
    }, () => requireGateway().restoreQuarterGoal(id))
    if (lastDeleted.value?.kind === 'quarter-goal' && lastDeleted.value.id === id) dismissLastDelete()
  }

  async function reorderQuarterGoals(quarter: QuarterKey, orderedIds: string[]) {
    await optimistic(
      () => applyOrder(document.value.quarterGoals, orderedIds),
      () => requireGateway().reorderQuarterGoals(quarter, orderedIds),
    )
  }

  async function undoLastDelete() {
    const action = lastDeleted.value
    if (!action) return
    if (action.kind === 'task') await restoreTask(action.id)
    else if (action.kind === 'project') await restoreProject(action.id)
    else if (action.kind === 'milestone') await restoreMilestone(action.id)
    else await restoreQuarterGoal(action.id)
  }

  return {
    document,
    loading,
    saving,
    ready,
    error,
    backendMode,
    fallbackReason,
    lastDeleted,
    dismissLastDelete,
    backendLabel: computed(() => backendMode.value === 'sqlite' ? '本机 SQLite' : backendMode.value === 'local' ? '本机数据' : 'Supabase'),
    projects: computed(() => view.value.projects),
    milestones,
    tasks: computed(() => view.value.tasks),
    trashedTasks: computed(() => document.value.tasks.filter(task => task.deletedAt !== null).sort(byDeletedAt)),
    trashedProjects: computed(() => document.value.projects.filter(project => project.deletedAt !== null).sort(byDeletedAt)),
    trashedMilestones: computed(() => document.value.milestones.filter(milestone => milestone.deletedAt !== null).sort(byDeletedAt)),
    trashedQuarterGoals: computed(() => document.value.quarterGoals.filter(goal => goal.deletedAt !== null).sort(byDeletedAt)),
    trashCount: computed(() => document.value.tasks.filter(task => task.deletedAt !== null).length
      + document.value.projects.filter(project => project.deletedAt !== null).length
      + document.value.milestones.filter(milestone => milestone.deletedAt !== null).length
      + document.value.quarterGoals.filter(goal => goal.deletedAt !== null).length),
    quarterGoals: computed(() => view.value.quarterGoals),
    focusTasks: computed(() => view.value.focusTasks),
    laterTasks: computed(() => view.value.laterTasks),
    completedTasks: computed(() => view.value.completedTasks),
    projectCounts: computed(() => view.value.projectCounts),
    metrics: computed(() => view.value.metrics),
    load,
    readLatestDocument,
    replaceWorkspaceDocument,
    emptyTrash,
    clearWorkspaceData,
    setGateway,
    dismissError,
    createProject,
    updateProject,
    deleteProject,
    restoreProject,
    reorderProjects,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    restoreMilestone,
    reorderMilestones,
    createTask,
    updateTask,
    deleteTask,
    restoreTask,
    setTaskCompleted,
    startTask,
    snoozeTask,
    moveTask,
    reorderTasks,
    createQuarterGoal,
    updateQuarterGoal,
    deleteQuarterGoal,
    restoreQuarterGoal,
    reorderQuarterGoals,
    undoLastDelete,
  }
}

function byDeletedAt(left: { deletedAt: string | null }, right: { deletedAt: string | null }) {
  return (right.deletedAt ?? '').localeCompare(left.deletedAt ?? '')
}

function bySortOrder(left: { sortOrder: number, createdAt: string }, right: { sortOrder: number, createdAt: string }) {
  return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)
}

export type WorkspaceModel = ReturnType<typeof createWorkspaceModel>

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败'
}

function findTask(document: WorkspaceDocument, id: string) {
  const task = document.tasks.find(item => item.id === id && item.deletedAt === null)
  if (!task) throw new Error('任务不存在')
  return task
}

function applyOrder<T extends Project | Milestone | QuarterGoal | Task>(records: T[], orderedIds: string[]) {
  orderedIds.forEach((id, sortOrder) => {
    const record = records.find(item => item.id === id)
    if (record) record.sortOrder = sortOrder
  })
}

function sameWorkspaceDocument(left: WorkspaceDocument, right: WorkspaceDocument) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function defaultAgentPlanStorage(): AgentPlanStorage | null {
  return typeof localStorage === 'undefined' ? null : createAgentPlanStorage(localStorage)
}
