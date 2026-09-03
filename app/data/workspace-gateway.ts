import type { Milestone, Project, QuarterGoal, QuarterKey, Task, TaskGroup, WorkspaceDocument } from '#shared/workspace'

export type CreateProjectInput = Pick<
  Project,
  'name' | 'color' | 'description' | 'priority' | 'status' | 'targetDate'
>
export type UpdateProjectInput = Partial<CreateProjectInput>
export type CreateMilestoneInput = Pick<
  Milestone,
  'projectId' | 'title' | 'description' | 'targetDate' | 'status' | 'progressMode' | 'progress'
>
export type UpdateMilestoneInput = Partial<CreateMilestoneInput>
export type CreateTaskInput = Pick<
  Task,
  'title' | 'description' | 'projectId' | 'milestoneId' | 'priority' | 'dueDate' | 'dueTime' | 'isFocus'
> & Partial<Pick<Task, 'status' | 'importance' | 'estimatedMinutes' | 'reminderAt' | 'snoozedUntil' | 'lastRemindedAt'>>
  & Partial<Pick<Task, 'attachments'>>
export type UpdateTaskInput = Partial<CreateTaskInput>
export type CreateQuarterGoalInput = Pick<
  QuarterGoal,
  'quarter' | 'title' | 'description' | 'progress' | 'status'
>
export type UpdateQuarterGoalInput = Partial<CreateQuarterGoalInput>

export interface WorkspaceGateway {
  readonly mode: 'local' | 'sqlite' | 'supabase'
  loadWorkspace(options?: { includeDeleted?: boolean }): Promise<WorkspaceDocument>
  replaceWorkspaceDocument(document: WorkspaceDocument): Promise<WorkspaceDocument>
  clearWorkspaceData(): Promise<void>
  emptyTrash(): Promise<void>
  createProject(input: CreateProjectInput): Promise<Project>
  updateProject(id: string, patch: UpdateProjectInput): Promise<Project>
  deleteProject(id: string): Promise<void>
  restoreProject(id: string): Promise<Project>
  reorderProjects(orderedIds: string[]): Promise<void>
  createMilestone(input: CreateMilestoneInput): Promise<Milestone>
  updateMilestone(id: string, patch: UpdateMilestoneInput): Promise<Milestone>
  deleteMilestone(id: string): Promise<void>
  restoreMilestone(id: string): Promise<Milestone>
  reorderMilestones(projectId: string, orderedIds: string[]): Promise<void>
  createTask(input: CreateTaskInput): Promise<Task>
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>
  deleteTask(id: string): Promise<void>
  restoreTask(id: string): Promise<Task>
  setTaskCompleted(id: string, completed: boolean): Promise<Task>
  startTask(id: string): Promise<Task>
  snoozeTask(id: string, until: string): Promise<Task>
  reorderTasks(group: TaskGroup, orderedIds: string[]): Promise<void>
  createQuarterGoal(input: CreateQuarterGoalInput): Promise<QuarterGoal>
  updateQuarterGoal(id: string, patch: UpdateQuarterGoalInput): Promise<QuarterGoal>
  deleteQuarterGoal(id: string): Promise<void>
  restoreQuarterGoal(id: string): Promise<QuarterGoal>
  reorderQuarterGoals(quarter: QuarterKey, orderedIds: string[]): Promise<void>
}

export type WorkspaceErrorCode = 'validation' | 'not-found' | 'conflict' | 'unavailable' | 'unexpected'

export class WorkspaceError extends Error {
  constructor(
    public readonly code: WorkspaceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'WorkspaceError'
  }
}
