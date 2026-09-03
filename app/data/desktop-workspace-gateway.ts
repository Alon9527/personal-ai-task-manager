import { invoke } from '@tauri-apps/api/core'
import { migrateWorkspaceDocument } from '#shared/workspace'
import type { Milestone, Project, QuarterGoal, QuarterKey, Task, TaskGroup, WorkspaceDocument } from '#shared/workspace'
import { createDemoWorkspace } from './demo-workspace'
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
  saveDocument: (documentJson: string) => Promise<void>
  backupDocument?: (documentJson: string) => Promise<void>
  loadLatestBackup?: () => Promise<string | null>
}

const defaultBridge: DesktopWorkspaceBridge = {
  loadDocument: async () => await invoke<string | null>('workspace_load_document'),
  saveDocument: async documentJson => await invoke('workspace_save_document', { documentJson }),
  backupDocument: async documentJson => await invoke('workspace_backup_document', { documentJson }),
  loadLatestBackup: async () => await invoke<string | null>('workspace_load_latest_backup'),
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
    const sqliteDocument = await this.bridge.loadDocument()
    if (sqliteDocument) {
      try {
        const document = migrateWorkspaceDocument(JSON.parse(sqliteDocument) as unknown)
        this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(document))
      }
      catch (cause) {
        if (!this.bridge.backupDocument) {
          throw new Error('无法持久备份损坏的 SQLite 工作区', { cause })
        }
        await this.bridge.backupDocument(sqliteDocument)
        this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(createDemoWorkspace()))
      }
    }
    else {
      const legacy = new LocalWorkspaceGateway(this.legacyStorage)
      const document = await legacy.loadWorkspace({ includeDeleted: true })
      this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(document))
    }

    await this.local.loadWorkspace({ includeDeleted: true })
    const canonical = this.requireDocumentJson()
    if (!sqliteDocument || sqliteDocument !== canonical) await this.bridge.saveDocument(canonical)
    this.hydrated = true
  }

  private persist<T>(operation: () => Promise<T>): Promise<T> {
    const mutation = this.mutationQueue.then(async () => {
      await this.hydrate()
      const before = this.requireDocumentJson()
      try {
        const result = await operation()
        await this.bridge.saveDocument(this.requireDocumentJson())
        return result
      }
      catch (cause) {
        this.memory.setItem(LOCAL_WORKSPACE_STORAGE_KEY, before)
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
