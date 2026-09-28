import { invoke } from '@tauri-apps/api/core'
import { migrateWorkspaceDocument, workspaceDocumentSchema } from '#shared/workspace'
import type { Milestone, Project, QuarterGoal, QuarterKey, Task, TaskGroup, WorkspaceDocument } from '#shared/workspace'
import { WorkspaceError } from './workspace-gateway'
import { parsePortableWorkspaceBackup } from '../services/task-attachments'
import { parseQuarterGoalBatch } from '../services/quarter-goal-batch'
import { LocalWorkspaceGateway, LOCAL_WORKSPACE_STORAGE_KEY } from './local-workspace-gateway'
import type {
  CreateProjectInput,
  CreateMilestoneInput,
  CreateQuarterGoalInput,
  CreateTaskInput,
  UpdateProjectInput,
  UpdateMilestoneInput,
  UpdateQuarterGoalInput,
  UpdateTaskInput,
  WorkspaceGateway,
} from './workspace-gateway'

export type DesktopWorkspaceBridge = {
  loadDocument: () => Promise<string | null>
  loadRawDocument?: () => Promise<string | null>
  saveDocument: (documentJson: string) => Promise<string | void>
  backupDocument?: (documentJson: string) => Promise<void>
  loadLatestBackup?: () => Promise<string | null>
  hasAppliedPlan?: (planId: string) => Promise<boolean>
  applyPlan?: (documentJson: string, expectedJson: string, planId: string) => Promise<string | void>
}

const defaultBridge: DesktopWorkspaceBridge = {
  loadDocument: async () => await invoke<string | null>('workspace_load_document'),
  loadRawDocument: async () => await invoke<string | null>('workspace_load_raw_document'),
  saveDocument: async documentJson => await invoke<string>('workspace_save_document', { documentJson }),
  backupDocument: async documentJson => await invoke('workspace_backup_document', { documentJson }),
  loadLatestBackup: async () => await invoke<string | null>('workspace_load_latest_backup'),
  hasAppliedPlan: async planId => await invoke<boolean>('workspace_has_applied_plan', { planId }),
  applyPlan: async (documentJson, expectedJson, planId) => await invoke<string>('workspace_apply_plan', { documentJson, expectedJson, planId }),
}

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

export class DesktopWorkspaceGateway implements WorkspaceGateway {
  readonly mode = 'sqlite' as const
  private readonly memory = new MemoryStorage()
  private readonly local = new LocalWorkspaceGateway(this.memory)
  private hydrated = false
  private hydration: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly legacyStorage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
    private readonly bridge: DesktopWorkspaceBridge = defaultBridge,
  ) {}

  async loadWorkspace(options: { includeDeleted?: boolean } = {}) {
    await this.hydrate()
    return await this.local.loadWorkspace(options)
  }

  async replaceWorkspaceDocument(document: WorkspaceDocument): Promise<WorkspaceDocument> {
    return await this.persist(() => this.local.replaceWorkspaceDocument(document))
  }

  async recoverWorkspaceDocument(document: WorkspaceDocument): Promise<WorkspaceDocument> {
    const validated = parsePortableWorkspaceBackup(document)
    // Explicit restore is a fresh import: damaged immutable IDs must not block repair.
    for (const task of validated.tasks) for (const attachment of task.attachments) attachment.id = crypto.randomUUID()
    const recovery = this.mutationQueue.then(async () => {
      // Recovery is explicit; never hydrate (and never seed) an unreadable source.
      const original = await (this.bridge.loadRawDocument ?? this.bridge.loadDocument)() ?? this.legacyStorage.getItem(LOCAL_WORKSPACE_STORAGE_KEY)
      if (original !== null) {
        if (!this.bridge.backupDocument) throw new Error('无法备份原始数据，已停止恢复')
        await this.bridge.backupDocument(original)
      }
      const json = JSON.stringify(validated)
      const committed = await this.bridge.saveDocument(json)
      const restored = workspaceDocumentSchema.parse(JSON.parse(committed ?? json))
      this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(restored))
      this.hydrated = true
      this.hydration = null
      return structuredClone(restored)
    })
    this.mutationQueue = recovery.then(() => undefined, () => undefined)
    return recovery
  }

  async hasAppliedPlan(planId: string) {
    if (!this.bridge.hasAppliedPlan) throw new Error('当前桌面版本不支持安全执行计划，请更新后重试')
    return this.bridge.hasAppliedPlan(planId)
  }

  async applyAgentPlan(document: WorkspaceDocument, expected: WorkspaceDocument, planId: string) {
    if (!this.bridge.applyPlan) throw new Error('当前桌面版本不支持原子计划提交，请更新后重试')
    const expectedJson = JSON.stringify(workspaceDocumentSchema.parse(expected))
    return this.persist(() => this.local.replaceWorkspaceDocument(document), async json => {
      try { return await this.bridge.applyPlan!(json, expectedJson, planId) }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        if (message === 'PLAN_ALREADY_APPLIED') throw new WorkspaceError('already-applied', '该计划已经执行，不会重复创建任务')
        if (message === 'WORKSPACE_CONFLICT') throw new WorkspaceError('conflict', '工作区已发生变化，请重新检查计划')
        throw cause instanceof Error ? cause : new Error(message)
      }
    })
  }

  async loadLatestRecoveryBackup() {
    if (!this.bridge.loadLatestBackup) throw new Error('当前桌面存储不支持读取恢复备份')
    return await this.bridge.loadLatestBackup()
  }

  async emptyTrash() {
    await this.persist(() => this.local.emptyTrash())
  }

  async clearWorkspaceData() {
    await this.persist(() => this.local.clearWorkspaceData())
  }

  async createProject(input: CreateProjectInput) {
    return await this.persist(() => this.local.createProject(input))
  }

  async updateProject(id: string, patch: UpdateProjectInput) {
    return await this.persist(() => this.local.updateProject(id, patch))
  }

  async deleteProject(id: string) {
    await this.persist(() => this.local.deleteProject(id))
  }

  async restoreProject(id: string): Promise<Project> {
    return await this.persist(() => this.local.restoreProject(id))
  }

  async reorderProjects(orderedIds: string[]) {
    await this.persist(() => this.local.reorderProjects(orderedIds))
  }

  async createMilestone(input: CreateMilestoneInput) {
    return await this.persist(() => this.local.createMilestone(input))
  }

  async updateMilestone(id: string, patch: UpdateMilestoneInput) {
    return await this.persist(() => this.local.updateMilestone(id, patch))
  }

  async deleteMilestone(id: string) {
    await this.persist(() => this.local.deleteMilestone(id))
  }

  async restoreMilestone(id: string): Promise<Milestone> {
    return await this.persist(() => this.local.restoreMilestone(id))
  }

  async reorderMilestones(projectId: string, orderedIds: string[]) {
    await this.persist(() => this.local.reorderMilestones(projectId, orderedIds))
  }

  async createTask(input: CreateTaskInput) {
    return await this.persist(() => this.local.createTask(input))
  }

  async updateTask(id: string, patch: UpdateTaskInput) {
    return await this.persist(() => this.local.updateTask(id, patch))
  }

  async deleteTask(id: string) {
    await this.persist(() => this.local.deleteTask(id))
  }

  async restoreTask(id: string): Promise<Task> {
    return await this.persist(() => this.local.restoreTask(id))
  }

  async setTaskCompleted(id: string, completed: boolean) {
    return await this.persist(() => this.local.setTaskCompleted(id, completed))
  }

  async startTask(id: string) {
    return await this.persist(() => this.local.startTask(id))
  }

  async snoozeTask(id: string, until: string) {
    return await this.persist(() => this.local.snoozeTask(id, until))
  }

  async reorderTasks(group: TaskGroup, orderedIds: string[]) {
    await this.persist(() => this.local.reorderTasks(group, orderedIds))
  }

  async createQuarterGoal(input: CreateQuarterGoalInput) {
    return await this.persist(() => this.local.createQuarterGoal(input))
  }

  async createQuarterGoals(input: CreateQuarterGoalInput[]) {
    const inputs = parseQuarterGoalBatch(input)
    if (!this.bridge.applyPlan) throw new WorkspaceError('unavailable', '当前桌面版本不支持安全批量保存，请更新后重试。')
    const batchId = crypto.randomUUID()
    let expectedJson = ''
    return this.persist(() => this.local.createQuarterGoals(inputs), async json => {
      if (json === expectedJson) return json // All duplicates: no transaction or receipt needed.
      try { return await this.bridge.applyPlan!(json, expectedJson, batchId) }
      catch (cause) {
        if (String(cause instanceof Error ? cause.message : cause) === 'WORKSPACE_CONFLICT') {
          throw new WorkspaceError('conflict', '工作区在保存前发生变化，本批未提交，请重新确认。')
        }
        throw cause
      }
    }, { invalidateOnFailure: true, prepare: async () => {
      // Retry after an uncertain IPC acknowledgement must deduplicate against persisted data.
      const raw = await this.bridge.loadDocument()
      if (raw === null) throw new WorkspaceError('recovery-required', '本机工作区无法读取，已停止批量保存。')
      expectedJson = JSON.stringify(workspaceDocumentSchema.parse(JSON.parse(raw)))
      this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, expectedJson)
    } })
  }

  async updateQuarterGoal(id: string, patch: UpdateQuarterGoalInput) {
    return await this.persist(() => this.local.updateQuarterGoal(id, patch))
  }

  async deleteQuarterGoal(id: string) {
    await this.persist(() => this.local.deleteQuarterGoal(id))
  }

  async restoreQuarterGoal(id: string): Promise<QuarterGoal> {
    return await this.persist(() => this.local.restoreQuarterGoal(id))
  }

  async reorderQuarterGoals(quarter: QuarterKey, orderedIds: string[]) {
    await this.persist(() => this.local.reorderQuarterGoals(quarter, orderedIds))
  }

  private async hydrate() {
    if (this.hydrated) return
    if (!this.hydration) this.hydration = this.performHydration()
    try {
      await this.hydration
    }
    catch (cause) {
      this.hydration = null
      throw cause
    }
  }

  private async performHydration() {
    let sqliteDocument: string | null
    try { sqliteDocument = await this.bridge.loadDocument() }
    catch (cause) { throw new WorkspaceError('recovery-required', '工作区或附件无法读取，原始数据已保留。请重试或恢复完整备份。', { cause }) }
    if (sqliteDocument !== null) {
      try {
        const document = migrateWorkspaceDocument(JSON.parse(sqliteDocument) as unknown)
        this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(document))
      }
      catch (cause) {
        throw new WorkspaceError('recovery-required', '工作区无法读取，原始数据已保留。请恢复有效备份，不会自动填入演示任务。', { cause })
      }
    }
    else {
      const legacy = new LocalWorkspaceGateway(this.legacyStorage)
      const document = this.legacyStorage.getItem(LOCAL_WORKSPACE_STORAGE_KEY) === null
        ? { version: 3, projects: [], milestones: [], tasks: [], quarterGoals: [] }
        : await legacy.loadWorkspace({ includeDeleted: true })
      this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(document))
    }

    await this.local.loadWorkspace({ includeDeleted: true })
    const canonical = this.requireDocumentJson()
    if (sqliteDocument === null || sqliteDocument !== canonical) {
      const committed = await this.bridge.saveDocument(canonical)
      if (committed) this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(workspaceDocumentSchema.parse(JSON.parse(committed))))
    }
    this.hydrated = true
  }

  private persist<T>(operation: () => Promise<T>, save = this.bridge.saveDocument, options: {
    prepare?: () => Promise<void>
    invalidateOnFailure?: boolean
  } = {}): Promise<T> {
    const mutation = this.mutationQueue.then(async () => {
      await this.hydrate()
      let before = this.requireDocumentJson()
      try {
        await options.prepare?.()
        before = this.requireDocumentJson()
        const result = await operation()
        const committed = await save(this.requireDocumentJson())
        if (committed) {
          const canonical = workspaceDocumentSchema.parse(JSON.parse(committed))
          this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(canonical))
          if (result && typeof result === 'object') {
            if ('version' in result) Object.assign(result, canonical)
            else if ('document' in result) Object.assign(result, { document: canonical })
            else if ('id' in result) {
              const item = [...canonical.tasks, ...canonical.projects, ...canonical.milestones, ...canonical.quarterGoals].find(item => item.id === result.id)
              if (item) Object.assign(result, item)
            }
          }
        }
        return result
      }
      catch (cause) {
        this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, before)
        if (options.invalidateOnFailure) {
          // A conflict or lost acknowledgement makes the cached base unsafe for any later edit.
          // Clear the cached promise too, so the next queued operation really reloads SQLite.
          this.hydrated = false
          this.hydration = null
        }
        throw cause
      }
    })
    this.mutationQueue = mutation.then(() => undefined, () => undefined)
    return mutation
  }

  private requireDocumentJson() {
    const document = this.memory.getItem(LOCAL_WORKSPACE_STORAGE_KEY)
    if (!document) throw new Error('SQLite 工作区尚未初始化')
    return document
  }
}
