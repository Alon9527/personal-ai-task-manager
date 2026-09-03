import { migrateWorkspaceDocument, workspaceDocumentSchema } from '#shared/workspace'
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
} from './workspace-gateway'

type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, unknown>
}

type ApiFetcher = (request: string, options?: ApiOptions) => Promise<unknown>

export class ApiWorkspaceGateway implements WorkspaceGateway {
  readonly mode = 'supabase' as const

  constructor(
    private readonly fetcher: ApiFetcher = async (request, options) => await $fetch(request, options as any),
  ) {}

  async loadWorkspace(options: { includeDeleted?: boolean } = {}) {
    const response = await this.fetch('/api/workspace', {
      query: { includeDeleted: options.includeDeleted ?? false },
    })
    return migrateWorkspaceDocument(response)
  }

  async replaceWorkspaceDocument(document: WorkspaceDocument): Promise<WorkspaceDocument> {
    const payload = workspaceDocumentSchema.parse(structuredClone(document))
    const response = await this.fetch('/api/workspace', { method: 'PUT', body: payload })
    return structuredClone(workspaceDocumentSchema.parse(response))
  }

  async emptyTrash() {
    await this.fetch('/api/trash', { method: 'DELETE' })
  }

  async clearWorkspaceData() {
    await this.fetch('/api/workspace-data', { method: 'DELETE' })
  }

  async createProject(input: CreateProjectInput) {
    return this.fetch<Project>('/api/projects', { method: 'POST', body: input })
  }

  async updateProject(id: string, patch: UpdateProjectInput) {
    return this.fetch<Project>(`/api/projects/${id}`, { method: 'PATCH', body: patch })
  }

  async deleteProject(id: string) {
    await this.fetch(`/api/projects/${id}`, { method: 'DELETE' })
  }

  async restoreProject(id: string) {
    return this.fetch<Project>(`/api/projects/${id}/restore`, { method: 'POST' })
  }

  async reorderProjects(orderedIds: string[]) {
    await this.fetch('/api/projects/reorder', { method: 'POST', body: { orderedIds } })
  }

  async createMilestone(input: CreateMilestoneInput) {
    return this.fetch<Milestone>('/api/milestones', { method: 'POST', body: input })
  }

  async updateMilestone(id: string, patch: UpdateMilestoneInput) {
    return this.fetch<Milestone>(`/api/milestones/${id}`, { method: 'PATCH', body: patch })
  }

  async deleteMilestone(id: string) {
    await this.fetch(`/api/milestones/${id}`, { method: 'DELETE' })
  }

  async restoreMilestone(id: string) {
    return this.fetch<Milestone>(`/api/milestones/${id}/restore`, { method: 'POST' })
  }

  async reorderMilestones(projectId: string, orderedIds: string[]) {
    await this.fetch('/api/milestones/reorder', { method: 'POST', body: { projectId, orderedIds } })
  }

  async createTask(input: CreateTaskInput) {
    return this.fetch<Task>('/api/tasks', { method: 'POST', body: input })
  }

  async updateTask(id: string, patch: UpdateTaskInput) {
    return this.fetch<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: patch })
  }

  async deleteTask(id: string) {
    await this.fetch(`/api/tasks/${id}`, { method: 'DELETE' })
  }

  async restoreTask(id: string) {
    return this.fetch<Task>(`/api/tasks/${id}/restore`, { method: 'POST' })
  }

  async setTaskCompleted(id: string, completed: boolean) {
    return this.fetch<Task>(`/api/tasks/${id}/complete`, { method: 'POST', body: { completed } })
  }

  async startTask(id: string) {
    return this.fetch<Task>(`/api/tasks/${id}/start`, { method: 'POST' })
  }

  async snoozeTask(id: string, until: string) {
    return this.fetch<Task>(`/api/tasks/${id}/snooze`, { method: 'POST', body: { until } })
  }

  async reorderTasks(group: TaskGroup, orderedIds: string[]) {
    await this.fetch('/api/tasks/reorder', { method: 'POST', body: { group, orderedIds } })
  }

  async createQuarterGoal(input: CreateQuarterGoalInput) {
    return this.fetch<QuarterGoal>('/api/quarter-goals', { method: 'POST', body: input })
  }

  async updateQuarterGoal(id: string, patch: UpdateQuarterGoalInput) {
    return this.fetch<QuarterGoal>(`/api/quarter-goals/${id}`, { method: 'PATCH', body: patch })
  }

  async deleteQuarterGoal(id: string) {
    await this.fetch(`/api/quarter-goals/${id}`, { method: 'DELETE' })
  }

  async restoreQuarterGoal(id: string) {
    return this.fetch<QuarterGoal>(`/api/quarter-goals/${id}/restore`, { method: 'POST' })
  }

  async reorderQuarterGoals(quarter: QuarterKey, orderedIds: string[]) {
    await this.fetch('/api/quarter-goals/reorder', { method: 'POST', body: { quarter, orderedIds } })
  }

  private async fetch<T = unknown>(request: string, options?: ApiOptions) {
    return await this.fetcher(request, options) as T
  }
}
