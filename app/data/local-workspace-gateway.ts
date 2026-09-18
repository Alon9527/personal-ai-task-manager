import { createDemoWorkspace } from './demo-workspace'
import { WorkspaceError } from './workspace-gateway'
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
} from './workspace-gateway'
import {
  DEMO_OWNER_ID,
  migrateWorkspaceDocument,
  workspaceDocumentSchema,
} from '#shared/workspace'
import type {
  Milestone,
  Project,
  QuarterGoal,
  QuarterKey,
  Task,
  TaskGroup,
  WorkspaceDocument,
} from '#shared/workspace'

export const LOCAL_WORKSPACE_STORAGE_KEY = 'personal-ai-workspace:v1'
const BACKUP_PREFIX = 'personal-ai-workspace:backup:'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function matchesGroup(task: Task, group: TaskGroup) {
  if (task.deletedAt !== null) return false
  if (group === 'completed') return task.completedAt !== null
  if (task.completedAt !== null) return false
  return group === 'focus' ? task.isFocus : !task.isFocus
}

function nextSortOrder(tasks: Task[], group: TaskGroup) {
  const values = tasks.filter(task => matchesGroup(task, group)).map(task => task.sortOrder)
  return values.length === 0 ? 0 : Math.max(...values) + 1
}

function taskGroup(task: Pick<Task, 'completedAt' | 'isFocus'>): TaskGroup {
  if (task.completedAt !== null) return 'completed'
  return task.isFocus ? 'focus' : 'later'
}

function ensureSameIds(expected: string[], received: string[]) {
  const unique = new Set(received)
  if (
    unique.size !== received.length
    || expected.length !== received.length
    || expected.some(id => !unique.has(id))
  ) {
    throw new WorkspaceError('validation', '排序列表与当前记录不一致')
  }
}

export class LocalWorkspaceGateway implements WorkspaceGateway {
  readonly mode = 'local' as const
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: StorageLike = localStorage,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async loadWorkspace(options: { includeDeleted?: boolean } = {}): Promise<WorkspaceDocument> {
    const document = this.readDocument()
    if (options.includeDeleted) return structuredClone(document)

    return {
      version: 3,
      projects: document.projects.filter(project => project.deletedAt === null),
      milestones: document.milestones.filter(milestone => milestone.deletedAt === null),
      tasks: document.tasks.filter(task => task.deletedAt === null),
      quarterGoals: document.quarterGoals.filter(goal => goal.deletedAt === null),
    }
  }

  async replaceWorkspaceDocument(document: WorkspaceDocument): Promise<WorkspaceDocument> {
    const validated = workspaceDocumentSchema.parse(structuredClone(document))
    return await this.enqueueMutation(() => {
      this.persist(validated)
      return structuredClone(validated)
    })
  }

  async emptyTrash(): Promise<void> {
    await this.mutate((draft) => {
      draft.tasks = draft.tasks.filter(task => task.deletedAt === null)
      draft.milestones = draft.milestones.filter(milestone => milestone.deletedAt === null)
      draft.projects = draft.projects.filter(project => project.deletedAt === null)
      draft.quarterGoals = draft.quarterGoals.filter(goal => goal.deletedAt === null)
    })
  }

  async clearWorkspaceData(): Promise<void> {
    await this.enqueueMutation(() => {
      this.persist({
        version: 3,
        projects: [],
        milestones: [],
        tasks: [],
        quarterGoals: [],
      })
    })
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return this.mutate((draft) => {
      const timestamp = this.now()
      const sortOrder = draft.projects
        .filter(project => project.deletedAt === null)
        .reduce((maximum, project) => Math.max(maximum, project.sortOrder), -1) + 1
      const project: Project = {
        id: this.createId(),
        ownerId: DEMO_OWNER_ID,
        name: input.name.trim(),
        color: input.color,
        description: input.description ?? '',
        priority: input.priority ?? null,
        status: input.status ?? 'active',
        targetDate: input.targetDate ?? null,
        sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      }
      draft.projects.push(project)
      return project
    })
  }

  async updateProject(id: string, patch: UpdateProjectInput): Promise<Project> {
    return this.mutate((draft) => {
      const project = draft.projects.find(item => item.id === id && item.deletedAt === null)
      if (!project) throw new WorkspaceError('not-found', '项目不存在')
      if (patch.name !== undefined) project.name = patch.name.trim()
      if (patch.color !== undefined) project.color = patch.color
      if (patch.description !== undefined) project.description = patch.description
      if (patch.priority !== undefined) project.priority = patch.priority
      if (patch.status !== undefined) project.status = patch.status
      if (patch.targetDate !== undefined) project.targetDate = patch.targetDate
      project.updatedAt = this.now()
      return project
    })
  }

  async deleteProject(id: string): Promise<void> {
    await this.mutate((draft) => {
      const project = draft.projects.find(item => item.id === id && item.deletedAt === null)
      if (!project) throw new WorkspaceError('not-found', '项目不存在')
      const timestamp = this.now()
      project.deletedAt = timestamp
      project.updatedAt = timestamp
      for (const milestone of draft.milestones) {
        if (milestone.projectId === id && milestone.deletedAt === null) {
          milestone.deletedAt = timestamp
          milestone.updatedAt = timestamp
        }
      }
      for (const task of draft.tasks) {
        if (task.projectId === id && task.deletedAt === null) {
          task.deletedAt = timestamp
          task.updatedAt = timestamp
        }
      }
    })
  }

  async restoreProject(id: string): Promise<Project> {
    return this.mutate((draft) => {
      const project = draft.projects.find(item => item.id === id && item.deletedAt !== null)
      if (!project) throw new WorkspaceError('not-found', '项目不在回收站中')
      const deletedAt = project.deletedAt
      const timestamp = this.now()
      project.deletedAt = null
      project.updatedAt = timestamp
      for (const milestone of draft.milestones) {
        if (milestone.projectId === id && milestone.deletedAt === deletedAt) {
          milestone.deletedAt = null
          milestone.updatedAt = timestamp
        }
      }
      for (const task of draft.tasks) {
        if (task.projectId === id && task.deletedAt === deletedAt) {
          task.deletedAt = null
          task.updatedAt = timestamp
        }
      }
      return project
    })
  }

  async reorderProjects(orderedIds: string[]): Promise<void> {
    await this.mutate((draft) => {
      const projects = draft.projects.filter(project => project.deletedAt === null)
      ensureSameIds(projects.map(project => project.id), orderedIds)
      const timestamp = this.now()
      orderedIds.forEach((id, sortOrder) => {
        const project = projects.find(item => item.id === id)!
        project.sortOrder = sortOrder
        project.updatedAt = timestamp
      })
    })
  }

  async createMilestone(input: CreateMilestoneInput): Promise<Milestone> {
    return this.mutate((draft) => {
      this.ensureActiveProject(draft, input.projectId)
      const timestamp = this.now()
      const sortOrder = draft.milestones
        .filter(milestone => milestone.projectId === input.projectId && milestone.deletedAt === null)
        .reduce((maximum, milestone) => Math.max(maximum, milestone.sortOrder), -1) + 1
      const milestone: Milestone = {
        id: this.createId(),
        ownerId: DEMO_OWNER_ID,
        projectId: input.projectId,
        title: input.title.trim(),
        description: input.description,
        targetDate: input.targetDate,
        status: input.status,
        progressMode: input.progressMode,
        progress: input.progress,
        sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      }
      draft.milestones.push(milestone)
      return milestone
    })
  }

  async updateMilestone(id: string, patch: UpdateMilestoneInput): Promise<Milestone> {
    return this.mutate((draft) => {
      const milestone = draft.milestones.find(item => item.id === id && item.deletedAt === null)
      if (!milestone) throw new WorkspaceError('not-found', '里程碑不存在')
      const timestamp = this.now()
      if (patch.projectId !== undefined && patch.projectId !== milestone.projectId) {
        this.ensureActiveProject(draft, patch.projectId)
        milestone.sortOrder = draft.milestones
          .filter(item => item.projectId === patch.projectId && item.deletedAt === null)
          .reduce((maximum, item) => Math.max(maximum, item.sortOrder), -1) + 1
        milestone.projectId = patch.projectId
        for (const task of draft.tasks) {
          if (task.milestoneId === milestone.id) {
            task.projectId = patch.projectId
            task.updatedAt = timestamp
          }
        }
      }
      if (patch.title !== undefined) milestone.title = patch.title.trim()
      if (patch.description !== undefined) milestone.description = patch.description
      if (patch.targetDate !== undefined) milestone.targetDate = patch.targetDate
      if (patch.status !== undefined) milestone.status = patch.status
      if (patch.progressMode !== undefined) milestone.progressMode = patch.progressMode
      if (patch.progress !== undefined) milestone.progress = patch.progress
      milestone.updatedAt = timestamp
      return milestone
    })
  }

  async deleteMilestone(id: string): Promise<void> {
    await this.mutate((draft) => {
      const milestone = draft.milestones.find(item => item.id === id && item.deletedAt === null)
      if (!milestone) throw new WorkspaceError('not-found', '里程碑不存在')
      const timestamp = this.now()
      milestone.deletedAt = timestamp
      milestone.updatedAt = timestamp
      for (const task of draft.tasks) {
        if (task.milestoneId === id) {
          task.milestoneId = null
          task.updatedAt = timestamp
        }
      }
    })
  }

  async restoreMilestone(id: string): Promise<Milestone> {
    return this.mutate((draft) => {
      const milestone = draft.milestones.find(item => item.id === id && item.deletedAt !== null)
      if (!milestone) throw new WorkspaceError('not-found', '里程碑不在回收站中')
      this.ensureActiveProject(draft, milestone.projectId)
      milestone.sortOrder = draft.milestones
        .filter(item => item.id !== milestone.id && item.projectId === milestone.projectId && item.deletedAt === null)
        .reduce((maximum, item) => Math.max(maximum, item.sortOrder), -1) + 1
      milestone.deletedAt = null
      milestone.updatedAt = this.now()
      return milestone
    })
  }

  async reorderMilestones(projectId: string, orderedIds: string[]): Promise<void> {
    await this.mutate((draft) => {
      this.ensureActiveProject(draft, projectId)
      const milestones = draft.milestones.filter(
        milestone => milestone.projectId === projectId && milestone.deletedAt === null,
      )
      ensureSameIds(milestones.map(milestone => milestone.id), orderedIds)
      const timestamp = this.now()
      orderedIds.forEach((id, sortOrder) => {
        const milestone = milestones.find(item => item.id === id)!
        milestone.sortOrder = sortOrder
        milestone.updatedAt = timestamp
      })
    })
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.mutate((draft) => {
      let projectId = input.projectId
      const milestoneId = input.milestoneId ?? null
      if (milestoneId) {
        projectId = this.ensureActiveMilestone(draft, milestoneId).projectId
      } else if (projectId !== null) {
        this.ensureActiveProject(draft, projectId)
      }
      const timestamp = this.now()
      const group: TaskGroup = input.isFocus ? 'focus' : 'later'
      const task: Task = {
        id: this.createId(),
        ownerId: DEMO_OWNER_ID,
        title: input.title.trim(),
        description: input.description,
        projectId,
        milestoneId,
        priority: input.priority,
        dueDate: input.dueDate,
        startDate: input.startDate ?? null,
        completionDate: input.completionDate ?? null,
        dueTime: input.dueTime,
        isFocus: input.isFocus,
        status: input.status ?? 'todo',
        importance: input.importance ?? (input.priority === 'high' ? 'important' : 'normal'),
        estimatedMinutes: input.estimatedMinutes ?? null,
        reminderAt: input.reminderAt ?? null,
        snoozedUntil: input.snoozedUntil ?? null,
        lastRemindedAt: input.lastRemindedAt ?? null,
        attachments: structuredClone(input.attachments ?? []),
        sortOrder: nextSortOrder(draft.tasks, group),
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      }
      draft.tasks.push(task)
      return task
    })
  }

  async updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
    return this.mutate((draft) => {
      const task = draft.tasks.find(item => item.id === id && item.deletedAt === null)
      if (!task) throw new WorkspaceError('not-found', '任务不存在')
      const previousGroup = taskGroup(task)
      const projectChanged = patch.projectId !== undefined && patch.projectId !== task.projectId
      if (patch.milestoneId) {
        const milestone = this.ensureActiveMilestone(draft, patch.milestoneId)
        task.milestoneId = milestone.id
        task.projectId = milestone.projectId
      } else {
        if (patch.projectId !== undefined && patch.projectId !== null) {
          this.ensureActiveProject(draft, patch.projectId)
        }
        if (patch.projectId !== undefined) task.projectId = patch.projectId
        if (patch.milestoneId === null) task.milestoneId = null
        else if (projectChanged && task.milestoneId) {
          const linked = draft.milestones.find(
            item => item.id === task.milestoneId && item.deletedAt === null,
          )
          if (!linked || linked.projectId !== task.projectId) task.milestoneId = null
        }
      }
      if (patch.title !== undefined) task.title = patch.title.trim()
      if (patch.description !== undefined) task.description = patch.description
      if (patch.priority !== undefined) task.priority = patch.priority
      if (patch.dueDate !== undefined) task.dueDate = patch.dueDate
      if (patch.startDate !== undefined) task.startDate = patch.startDate
      if (patch.completionDate !== undefined) task.completionDate = patch.completionDate
      if (patch.dueTime !== undefined) task.dueTime = patch.dueTime
      if (patch.isFocus !== undefined) task.isFocus = patch.isFocus
      if (patch.importance !== undefined) task.importance = patch.importance
      if (patch.estimatedMinutes !== undefined) task.estimatedMinutes = patch.estimatedMinutes
      if (patch.reminderAt !== undefined) task.reminderAt = patch.reminderAt
      if (patch.snoozedUntil !== undefined) task.snoozedUntil = patch.snoozedUntil
      if (patch.lastRemindedAt !== undefined) task.lastRemindedAt = patch.lastRemindedAt
      if (patch.attachments !== undefined) task.attachments = structuredClone(patch.attachments)
      if (patch.status !== undefined) {
        if (patch.status === 'in_progress') {
          for (const other of draft.tasks) {
            if (other.id !== task.id && other.deletedAt === null && other.status === 'in_progress') {
              other.status = 'todo'
              other.updatedAt = this.now()
            }
          }
        }
        task.status = patch.status
        if (patch.status === 'done' || patch.status === 'cancelled') task.completedAt ??= this.now()
        else task.completedAt = null
      }
      const nextGroup = taskGroup(task)
      if (previousGroup !== nextGroup) task.sortOrder = nextSortOrder(draft.tasks, nextGroup)
      task.updatedAt = this.now()
      return task
    })
  }

  async deleteTask(id: string): Promise<void> {
    await this.mutate((draft) => {
      const task = draft.tasks.find(item => item.id === id && item.deletedAt === null)
      if (!task) throw new WorkspaceError('not-found', '任务不存在')
      const timestamp = this.now()
      task.deletedAt = timestamp
      task.updatedAt = timestamp
    })
  }

  async restoreTask(id: string): Promise<Task> {
    return this.mutate((draft) => {
      const task = draft.tasks.find(item => item.id === id && item.deletedAt !== null)
      if (!task) throw new WorkspaceError('not-found', '任务不在回收站中')
      if (task.milestoneId !== null) {
        const milestone = draft.milestones.find(
          item => item.id === task.milestoneId && item.deletedAt === null,
        )
        const milestoneProjectActive = milestone !== undefined && draft.projects.some(
          project => project.id === milestone.projectId && project.deletedAt === null,
        )
        if (milestone && milestoneProjectActive) task.projectId = milestone.projectId
        else task.milestoneId = null
      }
      if (task.projectId !== null) {
        const projectActive = draft.projects.some(project => project.id === task.projectId && project.deletedAt === null)
        if (!projectActive) task.projectId = null
      }
      task.deletedAt = null
      task.updatedAt = this.now()
      return task
    })
  }

  async setTaskCompleted(id: string, completed: boolean): Promise<Task> {
    return this.mutate((draft) => {
      const task = draft.tasks.find(item => item.id === id && item.deletedAt === null)
      if (!task) throw new WorkspaceError('not-found', '任务不存在')
      const timestamp = this.now()
      const wasCompleted = task.completedAt !== null
      task.completedAt = completed ? timestamp : null
      task.status = completed ? 'done' : 'todo'
      if (wasCompleted !== completed) {
        task.sortOrder = nextSortOrder(draft.tasks, taskGroup(task))
      }
      task.updatedAt = timestamp
      return task
    })
  }

  async startTask(id: string): Promise<Task> {
    return this.mutate((draft) => {
      const task = draft.tasks.find(item => item.id === id && item.deletedAt === null)
      if (!task) throw new WorkspaceError('not-found', '任务不存在')
      const timestamp = this.now()
      for (const other of draft.tasks) {
        if (other.id !== id && other.deletedAt === null && other.status === 'in_progress') {
          other.status = 'todo'
          other.updatedAt = timestamp
        }
      }
      task.status = 'in_progress'
      task.completedAt = null
      task.isFocus = true
      task.updatedAt = timestamp
      return task
    })
  }

  async snoozeTask(id: string, until: string): Promise<Task> {
    return this.mutate((draft) => {
      const task = draft.tasks.find(item => item.id === id && item.deletedAt === null)
      if (!task) throw new WorkspaceError('not-found', '任务不存在')
      task.snoozedUntil = until
      task.lastRemindedAt = null
      task.updatedAt = this.now()
      return task
    })
  }

  async reorderTasks(group: TaskGroup, orderedIds: string[]): Promise<void> {
    await this.mutate((draft) => {
      const tasks = draft.tasks.filter(task => matchesGroup(task, group))
      ensureSameIds(tasks.map(task => task.id), orderedIds)
      const timestamp = this.now()
      orderedIds.forEach((id, sortOrder) => {
        const task = tasks.find(item => item.id === id)!
        task.sortOrder = sortOrder
        task.updatedAt = timestamp
      })
    })
  }

  async createQuarterGoal(input: CreateQuarterGoalInput): Promise<QuarterGoal> {
    return this.mutate((draft) => {
      const timestamp = this.now()
      const sortOrder = draft.quarterGoals
        .filter(goal => goal.deletedAt === null && goal.quarter === input.quarter)
        .reduce((maximum, goal) => Math.max(maximum, goal.sortOrder), -1) + 1
      const goal: QuarterGoal = {
        id: this.createId(),
        ownerId: DEMO_OWNER_ID,
        quarter: input.quarter,
        title: input.title.trim(),
        description: input.description,
        progress: input.progress,
        status: input.status,
        sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      }
      draft.quarterGoals.push(goal)
      return goal
    })
  }

  async updateQuarterGoal(id: string, patch: UpdateQuarterGoalInput): Promise<QuarterGoal> {
    return this.mutate((draft) => {
      const goal = draft.quarterGoals.find(item => item.id === id && item.deletedAt === null)
      if (!goal) throw new WorkspaceError('not-found', '季度目标不存在')
      if (patch.quarter !== undefined) goal.quarter = patch.quarter
      if (patch.title !== undefined) goal.title = patch.title.trim()
      if (patch.description !== undefined) goal.description = patch.description
      if (patch.progress !== undefined) goal.progress = patch.progress
      if (patch.status !== undefined) goal.status = patch.status
      goal.updatedAt = this.now()
      return goal
    })
  }

  async deleteQuarterGoal(id: string): Promise<void> {
    await this.mutate((draft) => {
      const goal = draft.quarterGoals.find(item => item.id === id && item.deletedAt === null)
      if (!goal) throw new WorkspaceError('not-found', '季度目标不存在')
      const timestamp = this.now()
      goal.deletedAt = timestamp
      goal.updatedAt = timestamp
    })
  }

  async restoreQuarterGoal(id: string): Promise<QuarterGoal> {
    return this.mutate((draft) => {
      const goal = draft.quarterGoals.find(item => item.id === id && item.deletedAt !== null)
      if (!goal) throw new WorkspaceError('not-found', '季度目标不在回收站中')
      goal.deletedAt = null
      goal.updatedAt = this.now()
      return goal
    })
  }

  async reorderQuarterGoals(quarter: QuarterKey, orderedIds: string[]): Promise<void> {
    await this.mutate((draft) => {
      const goals = draft.quarterGoals.filter(goal => goal.deletedAt === null && goal.quarter === quarter)
      ensureSameIds(goals.map(goal => goal.id), orderedIds)
      const timestamp = this.now()
      orderedIds.forEach((id, sortOrder) => {
        const goal = goals.find(item => item.id === id)!
        goal.sortOrder = sortOrder
        goal.updatedAt = timestamp
      })
    })
  }

  private readDocument(): WorkspaceDocument {
    const raw = this.storage.getItem(LOCAL_WORKSPACE_STORAGE_KEY)
    if (raw === null) {
      const seed = createDemoWorkspace()
      this.persist(seed)
      return seed
    }

    try {
      const parsed = JSON.parse(raw) as unknown
      const document = migrateWorkspaceDocument(parsed)
      const wasLegacy = typeof parsed === 'object'
        && parsed !== null
        && 'version' in parsed
        && (parsed.version === 1 || parsed.version === 2)
      if (wasLegacy) this.persist(document)
      return document
    } catch (cause) {
      try {
        this.storage.setItem(`${BACKUP_PREFIX}${this.now()}`, raw)
        const seed = createDemoWorkspace()
        this.persist(seed)
        return seed
      } catch (storageCause) {
        throw new WorkspaceError('unavailable', '本地数据无法恢复', { cause: storageCause ?? cause })
      }
    }
  }

  private async mutate<T>(operation: (draft: WorkspaceDocument) => T): Promise<T> {
    return await this.enqueueMutation(() => {
      const draft = structuredClone(this.readDocument())
      const result = operation(draft)
      this.persist(draft)
      return structuredClone(result)
    })
  }

  private enqueueMutation<T>(operation: () => T | Promise<T>): Promise<T> {
    const mutation = this.mutationQueue.then(operation)
    this.mutationQueue = mutation.then(() => undefined, () => undefined)
    return mutation
  }

  private persist(document: WorkspaceDocument) {
    try {
      const validated = workspaceDocumentSchema.parse(document)
      this.storage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(validated))
    } catch (cause) {
      if (cause instanceof WorkspaceError) throw cause
      throw new WorkspaceError('unavailable', '无法保存本地数据', { cause })
    }
  }

  private ensureActiveProject(document: WorkspaceDocument, id: string) {
    const exists = document.projects.some(project => project.id === id && project.deletedAt === null)
    if (!exists) throw new WorkspaceError('validation', '所选项目不存在')
  }

  private ensureActiveMilestone(document: WorkspaceDocument, id: string): Milestone {
    const milestone = document.milestones.find(item => item.id === id && item.deletedAt === null)
    if (!milestone) throw new WorkspaceError('validation', '所选里程碑不存在')
    this.ensureActiveProject(document, milestone.projectId)
    return milestone
  }
}
