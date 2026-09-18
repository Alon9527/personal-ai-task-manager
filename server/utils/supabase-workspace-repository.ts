import { workspaceDocumentSchema } from '#shared/workspace'
import type { Milestone, Project, QuarterGoal, QuarterGoalStatus, QuarterKey, Task, TaskGroup, WorkspaceDocument } from '#shared/workspace'
import type {
  CreateMilestoneInput,
  CreateProjectInput,
  CreateQuarterGoalInput,
  CreateTaskInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
  UpdateTaskInput,
  UpdateQuarterGoalInput,
  WorkspaceGateway,
} from '../../app/data/workspace-gateway'
import { WorkspaceError } from '../../app/data/workspace-gateway'

type TransportOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
}

type Transport = (url: string, options: TransportOptions) => Promise<unknown>

type ProjectRow = {
  id: string
  owner_id: string
  name: string
  color: string
  description: string
  priority: Project['priority']
  status: Project['status']
  target_date: string | null
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

type TaskRow = {
  id: string
  owner_id: string
  project_id: string | null
  milestone_id: string | null
  title: string
  description: string
  priority: Task['priority']
  due_date: string | null
  start_date?: string | null
  completion_date?: string | null
  due_time: string | null
  is_focus: boolean
  status?: Task['status']
  importance?: Task['importance']
  estimated_minutes?: number | null
  reminder_at?: string | null
  snoozed_until?: string | null
  last_reminded_at?: string | null
  attachments?: Task['attachments']
  sort_order: number
  completed_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

type MilestoneRow = {
  id: string
  owner_id: string
  project_id: string
  title: string
  description: string
  target_date: string | null
  status: Milestone['status']
  progress_mode: Milestone['progressMode']
  progress: number
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

type QuarterGoalRow = {
  id: string
  owner_id: string
  quarter: string
  title: string
  description: string
  progress: number
  status: QuarterGoalStatus
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export class SupabaseWorkspaceRepository implements WorkspaceGateway {
  readonly mode = 'supabase' as const
  private readonly url: string
  private readonly key: string
  private readonly ownerId: string
  private readonly transport: Transport

  constructor(options: { url: string, key: string, ownerId: string, transport?: Transport }) {
    this.url = options.url.replace(/\/$/, '')
    this.key = options.key
    this.ownerId = options.ownerId
    this.transport = options.transport ?? defaultTransport
  }

  async loadWorkspace(options: { includeDeleted?: boolean } = {}): Promise<WorkspaceDocument> {
    const activeFilter = options.includeDeleted ? '' : '&deleted_at=is.null'
    const projects = await this.request<ProjectRow[]>(
      `/rest/v1/projects?select=*&owner_id=eq.${this.ownerId}${activeFilter}&order=sort_order.asc`,
    )
    const tasks = await this.request<TaskRow[]>(
      `/rest/v1/tasks?select=*&owner_id=eq.${this.ownerId}${activeFilter}&order=sort_order.asc`,
    )
    const quarterGoals = await this.request<QuarterGoalRow[]>(
      `/rest/v1/quarter_goals?select=*&owner_id=eq.${this.ownerId}${activeFilter}&order=sort_order.asc`,
    )
    const milestones = await this.request<MilestoneRow[]>(
      `/rest/v1/milestones?select=*&owner_id=eq.${this.ownerId}${activeFilter}&order=sort_order.asc`,
    )
    return {
      version: 3,
      projects: projects.map(mapProject),
      milestones: milestones.map(mapMilestone),
      tasks: tasks.map(mapTask),
      quarterGoals: quarterGoals.map(mapQuarterGoal),
    }
  }

  async replaceWorkspaceDocument(document: WorkspaceDocument): Promise<WorkspaceDocument> {
    const payload = workspaceDocumentSchema.parse(structuredClone(document))
    const allRows = [
      ...payload.projects,
      ...payload.milestones,
      ...payload.tasks,
      ...payload.quarterGoals,
    ]
    if (allRows.some(row => row.ownerId !== this.ownerId)) {
      throw new WorkspaceError('validation', '工作区记录所有者不一致')
    }
    const response = await this.request('/rest/v1/rpc/replace_workspace_document', {
      method: 'POST',
      body: { target_owner_id: this.ownerId, payload },
    })
    return structuredClone(workspaceDocumentSchema.parse(response))
  }

  async emptyTrash(): Promise<void> {
    await this.request('/rest/v1/rpc/empty_workspace_trash', {
      method: 'POST',
      body: { p_owner_id: this.ownerId },
    })
  }

  async clearWorkspaceData(): Promise<void> {
    await this.request('/rest/v1/rpc/clear_workspace_data', {
      method: 'POST',
      body: { p_owner_id: this.ownerId },
    })
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const current = await this.loadWorkspace()
    const sortOrder = current.projects.reduce((maximum, project) => Math.max(maximum, project.sortOrder), -1) + 1
    const rows = await this.request<ProjectRow[]>('/rest/v1/projects', {
      method: 'POST',
      body: {
        owner_id: this.ownerId,
        name: input.name.trim(),
        color: input.color,
        description: input.description,
        priority: input.priority,
        status: input.status,
        target_date: input.targetDate,
        sort_order: sortOrder,
      },
    })
    return mapProject(requireFirst(rows, '项目创建失败'))
  }

  async updateProject(id: string, patch: UpdateProjectInput): Promise<Project> {
    const body: Record<string, unknown> = {}
    if (patch.name !== undefined) body.name = patch.name.trim()
    if (patch.color !== undefined) body.color = patch.color
    if (patch.description !== undefined) body.description = patch.description
    if (patch.priority !== undefined) body.priority = patch.priority
    if (patch.status !== undefined) body.status = patch.status
    if (patch.targetDate !== undefined) body.target_date = patch.targetDate
    const rows = await this.request<ProjectRow[]>(
      `/rest/v1/projects?id=eq.${id}&owner_id=eq.${this.ownerId}&deleted_at=is.null`,
      { method: 'PATCH', body },
    )
    return mapProject(requireFirst(rows, '项目不存在'))
  }

  async deleteProject(id: string): Promise<void> {
    await this.request('/rest/v1/rpc/soft_delete_project', {
      method: 'POST',
      body: { p_project_id: id, p_owner_id: this.ownerId },
    })
  }

  async restoreProject(id: string): Promise<Project> {
    const rows = await this.request<ProjectRow[]>('/rest/v1/rpc/restore_project', {
      method: 'POST',
      body: { p_project_id: id, p_owner_id: this.ownerId },
    })
    return mapProject(requireFirst(rows, '项目不在回收站中'))
  }

  async reorderProjects(orderedIds: string[]): Promise<void> {
    await this.request('/rest/v1/rpc/reorder_projects', {
      method: 'POST',
      body: { p_owner_id: this.ownerId, p_ordered_ids: orderedIds },
    })
  }

  async createMilestone(input: CreateMilestoneInput): Promise<Milestone> {
    const rows = await this.request<MilestoneRow[]>('/rest/v1/milestones', {
      method: 'POST',
      body: {
        owner_id: this.ownerId,
        project_id: input.projectId,
        title: input.title.trim(),
        description: input.description,
        target_date: input.targetDate,
        status: input.status,
        progress_mode: input.progressMode,
        progress: input.progress,
      },
    })
    return mapMilestone(requireFirst(rows, '里程碑创建失败'))
  }

  async updateMilestone(id: string, patch: UpdateMilestoneInput): Promise<Milestone> {
    const body: Record<string, unknown> = {}
    if (patch.projectId !== undefined) body.project_id = patch.projectId
    if (patch.title !== undefined) body.title = patch.title.trim()
    if (patch.description !== undefined) body.description = patch.description
    if (patch.targetDate !== undefined) body.target_date = patch.targetDate
    if (patch.status !== undefined) body.status = patch.status
    if (patch.progressMode !== undefined) body.progress_mode = patch.progressMode
    if (patch.progress !== undefined) body.progress = patch.progress
    const rows = await this.request<MilestoneRow[]>(
      `/rest/v1/milestones?id=eq.${id}&owner_id=eq.${this.ownerId}&deleted_at=is.null`,
      { method: 'PATCH', body },
    )
    return mapMilestone(requireFirst(rows, '里程碑不存在'))
  }

  async deleteMilestone(id: string): Promise<void> {
    await this.request('/rest/v1/rpc/soft_delete_milestone', {
      method: 'POST',
      body: { p_milestone_id: id, p_owner_id: this.ownerId },
    })
  }

  async restoreMilestone(id: string): Promise<Milestone> {
    const rows = await this.request<MilestoneRow[]>('/rest/v1/rpc/restore_milestone', {
      method: 'POST',
      body: { p_milestone_id: id, p_owner_id: this.ownerId },
    })
    return mapMilestone(requireFirst(rows, '里程碑不在回收站中'))
  }

  async reorderMilestones(projectId: string, orderedIds: string[]): Promise<void> {
    await this.request('/rest/v1/rpc/reorder_milestones', {
      method: 'POST',
      body: { p_owner_id: this.ownerId, p_project_id: projectId, p_ordered_ids: orderedIds },
    })
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const current = await this.loadWorkspace()
    const groupTasks = current.tasks.filter(task => task.completedAt === null && task.isFocus === input.isFocus)
    const sortOrder = groupTasks.reduce((maximum, task) => Math.max(maximum, task.sortOrder), -1) + 1
    const rows = await this.request<TaskRow[]>('/rest/v1/tasks', {
      method: 'POST',
      body: {
        owner_id: this.ownerId,
        project_id: input.projectId,
        milestone_id: input.milestoneId,
        title: input.title.trim(),
        description: input.description,
        priority: input.priority,
        due_date: input.dueDate,
        start_date: input.startDate ?? null,
        completion_date: input.completionDate ?? null,
        due_time: input.dueTime,
        is_focus: input.isFocus,
        status: input.status ?? 'todo',
        importance: input.importance ?? (input.priority === 'high' ? 'important' : 'normal'),
        estimated_minutes: input.estimatedMinutes ?? null,
        reminder_at: input.reminderAt ?? null,
        snoozed_until: input.snoozedUntil ?? null,
        last_reminded_at: input.lastRemindedAt ?? null,
        sort_order: sortOrder,
      },
    })
    return mapTask(requireFirst(rows, '任务创建失败'))
  }

  async updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
    const body: Record<string, unknown> = {}
    if (patch.title !== undefined) body.title = patch.title.trim()
    if (patch.description !== undefined) body.description = patch.description
    if (patch.projectId !== undefined) body.project_id = patch.projectId
    if (patch.milestoneId !== undefined) body.milestone_id = patch.milestoneId
    if (patch.priority !== undefined) body.priority = patch.priority
    if (patch.dueDate !== undefined) body.due_date = patch.dueDate
    if (patch.startDate !== undefined) body.start_date = patch.startDate
    if (patch.completionDate !== undefined) body.completion_date = patch.completionDate
    if (patch.dueTime !== undefined) body.due_time = patch.dueTime
    if (patch.isFocus !== undefined) body.is_focus = patch.isFocus
    if (patch.status !== undefined) body.status = patch.status
    if (patch.importance !== undefined) body.importance = patch.importance
    if (patch.estimatedMinutes !== undefined) body.estimated_minutes = patch.estimatedMinutes
    if (patch.reminderAt !== undefined) body.reminder_at = patch.reminderAt
    if (patch.snoozedUntil !== undefined) body.snoozed_until = patch.snoozedUntil
    if (patch.lastRemindedAt !== undefined) body.last_reminded_at = patch.lastRemindedAt
    const rows = await this.request<TaskRow[]>(
      `/rest/v1/tasks?id=eq.${id}&owner_id=eq.${this.ownerId}&deleted_at=is.null`,
      { method: 'PATCH', body },
    )
    return mapTask(requireFirst(rows, '任务不存在'))
  }

  async deleteTask(id: string): Promise<void> {
    const rows = await this.request<TaskRow[]>(
      `/rest/v1/tasks?id=eq.${id}&owner_id=eq.${this.ownerId}&deleted_at=is.null`,
      { method: 'PATCH', body: { deleted_at: new Date().toISOString() } },
    )
    requireFirst(rows, '任务不存在')
  }

  async restoreTask(id: string): Promise<Task> {
    const rows = await this.request<TaskRow[]>('/rest/v1/rpc/restore_task', {
      method: 'POST',
      body: { p_task_id: id, p_owner_id: this.ownerId },
    })
    return mapTask(requireFirst(rows, '任务不在回收站中'))
  }

  async setTaskCompleted(id: string, completed: boolean): Promise<Task> {
    const rows = await this.request<TaskRow[]>(
      `/rest/v1/tasks?id=eq.${id}&owner_id=eq.${this.ownerId}&deleted_at=is.null`,
      { method: 'PATCH', body: { completed_at: completed ? new Date().toISOString() : null, status: completed ? 'done' : 'todo' } },
    )
    return mapTask(requireFirst(rows, '任务不存在'))
  }

  async startTask(id: string): Promise<Task> {
    const rows = await this.request<TaskRow[]>('/rest/v1/rpc/start_task', {
      method: 'POST',
      body: { p_task_id: id, p_owner_id: this.ownerId },
    })
    return mapTask(requireFirst(rows, '任务不存在'))
  }

  async snoozeTask(id: string, until: string): Promise<Task> {
    const rows = await this.request<TaskRow[]>(
      `/rest/v1/tasks?id=eq.${id}&owner_id=eq.${this.ownerId}&deleted_at=is.null`,
      { method: 'PATCH', body: { snoozed_until: until, last_reminded_at: null } },
    )
    return mapTask(requireFirst(rows, '任务不存在'))
  }

  async reorderTasks(group: TaskGroup, orderedIds: string[]): Promise<void> {
    await this.request('/rest/v1/rpc/reorder_tasks', {
      method: 'POST',
      body: { p_owner_id: this.ownerId, p_group: group, p_ordered_ids: orderedIds },
    })
  }

  async createQuarterGoal(input: CreateQuarterGoalInput): Promise<QuarterGoal> {
    const current = await this.loadWorkspace()
    const sortOrder = current.quarterGoals
      .filter(goal => goal.quarter === input.quarter)
      .reduce((maximum, goal) => Math.max(maximum, goal.sortOrder), -1) + 1
    const rows = await this.request<QuarterGoalRow[]>('/rest/v1/quarter_goals', {
      method: 'POST',
      body: { owner_id: this.ownerId, quarter: input.quarter, title: input.title.trim(), description: input.description, progress: input.progress, status: input.status, sort_order: sortOrder },
    })
    return mapQuarterGoal(requireFirst(rows, '季度目标创建失败'))
  }

  async updateQuarterGoal(id: string, patch: UpdateQuarterGoalInput): Promise<QuarterGoal> {
    const body: Record<string, unknown> = {}
    if (patch.quarter !== undefined) body.quarter = patch.quarter
    if (patch.title !== undefined) body.title = patch.title.trim()
    if (patch.description !== undefined) body.description = patch.description
    if (patch.progress !== undefined) body.progress = patch.progress
    if (patch.status !== undefined) body.status = patch.status
    const rows = await this.request<QuarterGoalRow[]>(
      `/rest/v1/quarter_goals?id=eq.${id}&owner_id=eq.${this.ownerId}&deleted_at=is.null`,
      { method: 'PATCH', body },
    )
    return mapQuarterGoal(requireFirst(rows, '季度目标不存在'))
  }

  async deleteQuarterGoal(id: string): Promise<void> {
    const rows = await this.request<QuarterGoalRow[]>(
      `/rest/v1/quarter_goals?id=eq.${id}&owner_id=eq.${this.ownerId}&deleted_at=is.null`,
      { method: 'PATCH', body: { deleted_at: new Date().toISOString() } },
    )
    requireFirst(rows, '季度目标不存在')
  }

  async restoreQuarterGoal(id: string): Promise<QuarterGoal> {
    const rows = await this.request<QuarterGoalRow[]>(
      `/rest/v1/quarter_goals?id=eq.${id}&owner_id=eq.${this.ownerId}&deleted_at=not.is.null`,
      { method: 'PATCH', body: { deleted_at: null } },
    )
    return mapQuarterGoal(requireFirst(rows, '季度目标不在回收站中'))
  }

  async reorderQuarterGoals(quarter: QuarterKey, orderedIds: string[]): Promise<void> {
    await this.request('/rest/v1/rpc/reorder_quarter_goals', {
      method: 'POST',
      body: { p_owner_id: this.ownerId, p_quarter: quarter, p_ordered_ids: orderedIds },
    })
  }

  private async request<T = unknown>(path: string, options: TransportOptions = {}): Promise<T> {
    try {
      return await this.transport(`${this.url}${path}`, {
        ...options,
        method: options.method ?? 'GET',
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
      }) as T
    } catch (cause) {
      throw mapTransportError(cause)
    }
  }
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    color: row.color,
    description: row.description,
    priority: row.priority,
    status: row.status,
    targetDate: row.target_date,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    dueDate: row.due_date,
    startDate: row.start_date ?? null,
    completionDate: row.completion_date ?? null,
    dueTime: row.due_time?.slice(0, 5) ?? null,
    isFocus: row.is_focus,
    status: row.status ?? (row.completed_at ? 'done' : 'todo'),
    importance: row.importance ?? (row.priority === 'high' ? 'important' : 'normal'),
    estimatedMinutes: row.estimated_minutes ?? null,
    reminderAt: row.reminder_at ?? null,
    snoozedUntil: row.snoozed_until ?? null,
    lastRemindedAt: row.last_reminded_at ?? null,
    attachments: row.attachments ?? [],
    sortOrder: row.sort_order,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

function mapMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    targetDate: row.target_date,
    status: row.status,
    progressMode: row.progress_mode,
    progress: row.progress,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

function mapQuarterGoal(row: QuarterGoalRow): QuarterGoal {
  return {
    id: row.id,
    ownerId: row.owner_id,
    quarter: row.quarter,
    title: row.title,
    description: row.description,
    progress: row.progress,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

function requireFirst<T>(rows: T[], message: string) {
  const row = rows[0]
  if (!row) throw new WorkspaceError('not-found', message)
  return row
}

function mapTransportError(cause: unknown) {
  if (cause instanceof WorkspaceError) return cause
  const status = typeof cause === 'object' && cause !== null
    ? Number('statusCode' in cause ? cause.statusCode : 'status' in cause ? cause.status : 0)
    : 0
  const message = cause instanceof Error
    ? cause.message
    : typeof cause === 'object' && cause !== null && 'message' in cause
      ? String(cause.message)
      : 'Supabase 请求失败'
  if (status === 400 || status === 422) return new WorkspaceError('validation', message, { cause })
  if (status === 404) return new WorkspaceError('not-found', message, { cause })
  if (status === 409) return new WorkspaceError('conflict', message, { cause })
  if (status >= 500 || status === 0) return new WorkspaceError('unavailable', message, { cause })
  return new WorkspaceError('unexpected', message, { cause })
}

async function defaultTransport(url: string, options: TransportOptions) {
  const response = await fetch(url, {
    method: options.method,
    headers: options.headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw Object.assign(
      new Error(text || response.statusText || 'Supabase request failed'),
      { statusCode: response.status },
    )
  }
  if (!text) return null
  return JSON.parse(text) as unknown
}
