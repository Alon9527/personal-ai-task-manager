import { z } from 'zod'

export const DEMO_OWNER_ID = '00000000-0000-4000-8000-000000000001'

const isoTimestamp = z.string().datetime()
const nullableTimestamp = isoTimestamp.nullable()

export const taskStatusSchema = z.enum(['inbox', 'todo', 'in_progress', 'waiting', 'done', 'cancelled'])
export const taskImportanceSchema = z.enum(['normal', 'important'])
export const projectStatusSchema = z.enum(['planned', 'active', 'paused', 'completed'])
export const milestoneStatusSchema = z.enum(['planned', 'in_progress', 'blocked', 'completed'])
export const milestoneProgressModeSchema = z.enum(['auto', 'manual'])

export const projectV2Schema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  deletedAt: nullableTimestamp,
})

export const projectSchema = projectV2Schema.extend({
  description: z.string().max(4000),
  priority: z.enum(['low', 'medium', 'high']).nullable(),
  status: projectStatusSchema,
  targetDate: z.iso.date().nullable(),
})

export const taskAttachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(255).refine(
    value => !/[\\/]/.test(value) && !/[\u0000-\u001f\u007f]/.test(value),
    '附件名称无效',
  ),
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/).max(127),
  size: z.number().int().nonnegative().max(5 * 1024 * 1024),
  dataUrl: z.string().max(7_100_000),
}).superRefine((attachment, context) => {
  if (!attachment.dataUrl.startsWith(`data:${attachment.mimeType};base64,`)) {
    context.addIssue({ code: 'custom', path: ['dataUrl'], message: '附件内容格式无效' })
  }
})

export const taskV2Schema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  priority: z.enum(['low', 'medium', 'high']).nullable(),
  dueDate: z.iso.date().nullable(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  isFocus: z.boolean(),
  status: taskStatusSchema.optional(),
  importance: taskImportanceSchema.optional(),
  estimatedMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  reminderAt: nullableTimestamp.optional(),
  snoozedUntil: nullableTimestamp.optional(),
  lastRemindedAt: nullableTimestamp.optional(),
  sortOrder: z.number().int().nonnegative(),
  completedAt: nullableTimestamp,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  deletedAt: nullableTimestamp,
  attachments: z.array(taskAttachmentSchema).max(8).optional(),
})

export const taskSchema = taskV2Schema.extend({
  milestoneId: z.string().uuid().nullable(),
})

function withCanonicalTaskDefaults(task: z.infer<typeof taskSchema>) {
  return {
    ...task,
    status: task.status ?? (task.completedAt === null ? 'todo' as const : 'done' as const),
    importance: task.importance ?? (task.priority === 'high' ? 'important' as const : 'normal' as const),
    estimatedMinutes: task.estimatedMinutes ?? null,
    reminderAt: task.reminderAt ?? null,
    snoozedUntil: task.snoozedUntil ?? null,
    lastRemindedAt: task.lastRemindedAt ?? null,
    attachments: task.attachments ?? [],
  }
}

const canonicalTaskSchema = taskSchema.transform(withCanonicalTaskDefaults)

export const quarterKeySchema = z.string().regex(/^\d{4}-Q[1-4]$/)
export const quarterGoalStatusSchema = z.enum(['active', 'completed', 'paused'])

export const quarterGoalSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  quarter: quarterKeySchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  progress: z.number().int().min(0).max(100),
  status: quarterGoalStatusSchema,
  sortOrder: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  deletedAt: nullableTimestamp,
})

export const milestoneSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  targetDate: z.iso.date().nullable(),
  status: milestoneStatusSchema,
  progressMode: milestoneProgressModeSchema,
  progress: z.number().int().min(0).max(100),
  sortOrder: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  deletedAt: nullableTimestamp,
})

export const workspaceDocumentV1Schema = z.object({
  version: z.literal(1),
  projects: z.array(projectV2Schema),
  tasks: z.array(taskV2Schema),
})

export const workspaceDocumentV2Schema = z.object({
  version: z.literal(2),
  projects: z.array(projectV2Schema),
  tasks: z.array(taskV2Schema),
  quarterGoals: z.array(quarterGoalSchema),
})

export const workspaceDocumentSchema = z.object({
  version: z.literal(3),
  projects: z.array(projectSchema),
  milestones: z.array(milestoneSchema),
  tasks: z.array(canonicalTaskSchema),
  quarterGoals: z.array(quarterGoalSchema),
})

export type Project = z.infer<typeof projectSchema>
export type Task = z.infer<typeof canonicalTaskSchema>
export type TaskAttachment = z.infer<typeof taskAttachmentSchema>
export type ProjectStatus = z.infer<typeof projectStatusSchema>
export type Milestone = z.infer<typeof milestoneSchema>
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>
export type MilestoneProgressMode = z.infer<typeof milestoneProgressModeSchema>
export type TaskStatus = z.infer<typeof taskStatusSchema>
export type TaskImportance = z.infer<typeof taskImportanceSchema>
export type QuarterGoal = z.infer<typeof quarterGoalSchema>
export type QuarterGoalStatus = z.infer<typeof quarterGoalStatusSchema>
export type QuarterKey = z.infer<typeof quarterKeySchema>
export type WorkspaceDocument = z.infer<typeof workspaceDocumentSchema>
export type TaskGroup = 'focus' | 'later' | 'completed'

export function getTaskStatus(task: Pick<Task, 'status' | 'completedAt'>): TaskStatus {
  if (task.status) return task.status
  return task.completedAt === null ? 'todo' : 'done'
}

export function getTaskImportance(task: Pick<Task, 'importance' | 'priority'>): TaskImportance {
  return task.importance ?? (task.priority === 'high' ? 'important' : 'normal')
}

export function isTaskActive(task: Pick<Task, 'status' | 'completedAt' | 'deletedAt'>) {
  const status = getTaskStatus(task)
  return task.deletedAt === null && task.completedAt === null && status !== 'done' && status !== 'cancelled'
}

function upgradeProject(project: z.infer<typeof projectV2Schema>): Project {
  return { ...project, description: '', priority: null, status: 'active', targetDate: null }
}

function upgradeTask(task: z.infer<typeof taskV2Schema>): Task {
  return withCanonicalTaskDefaults({ ...task, milestoneId: null })
}

export function migrateWorkspaceDocument(input: unknown): WorkspaceDocument {
  const current = workspaceDocumentSchema.safeParse(input)
  if (current.success) return current.data
  const v2 = workspaceDocumentV2Schema.safeParse(input)
  if (v2.success) return workspaceDocumentSchema.parse({
    version: 3,
    projects: v2.data.projects.map(upgradeProject),
    milestones: [],
    tasks: v2.data.tasks.map(upgradeTask),
    quarterGoals: v2.data.quarterGoals,
  })
  const v1 = workspaceDocumentV1Schema.parse(input)
  return workspaceDocumentSchema.parse({
    version: 3,
    projects: v1.projects.map(upgradeProject),
    milestones: [],
    tasks: v1.tasks.map(upgradeTask),
    quarterGoals: [],
  })
}

function bySortOrder<T extends { sortOrder: number, createdAt: string }>(left: T, right: T) {
  return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)
}

export function deriveWorkspace(document: WorkspaceDocument) {
  const projects = document.projects
    .filter(project => project.deletedAt === null)
    .sort(bySortOrder)
  const tasks = document.tasks.filter(task => task.deletedAt === null)
  const quarterGoals = document.quarterGoals
    .filter(goal => goal.deletedAt === null)
    .sort(bySortOrder)
  const focusTasks = tasks
    .filter(task => isTaskActive(task) && task.isFocus)
    .sort(bySortOrder)
  const laterTasks = tasks
    .filter(task => isTaskActive(task) && !task.isFocus)
    .sort(bySortOrder)
  const completedTasks = tasks
    .filter(task => !isTaskActive(task))
    .sort(bySortOrder)
  const projectCounts = Object.fromEntries(
    projects.map(project => [
      project.id,
      tasks.filter(task => task.projectId === project.id).length,
    ]),
  ) as Record<string, number>

  return {
    projects,
    tasks,
    quarterGoals,
    focusTasks,
    laterTasks,
    completedTasks,
    projectCounts,
    metrics: {
      focus: focusTasks.length,
      active: focusTasks.length + laterTasks.length,
      completed: completedTasks.length,
    },
  }
}

export * from './workspace-analytics'
export * from './project-progress'
