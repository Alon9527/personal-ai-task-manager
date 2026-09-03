import { z } from 'zod'
import {
  milestoneProgressModeSchema,
  milestoneStatusSchema,
  projectStatusSchema,
  taskImportanceSchema,
  taskStatusSchema,
} from '#shared/workspace'

const isoTimestampSchema = z.string().datetime()
const isoDateSchema = z.iso.date()
const nullableIsoDateSchema = isoDateSchema.nullable()
const nullableIsoTimestampSchema = isoTimestampSchema.nullable()
const prioritySchema = z.enum(['low', 'medium', 'high'])
const nullablePrioritySchema = prioritySchema.nullable()
const titleSchema = z.string().trim().min(1).max(160)
const projectNameSchema = z.string().trim().min(1).max(80)
const descriptionSchema = z.string().max(4000)
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const dueTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const draftRefSchema = z.string().trim().min(1).max(160)

export const agentActionTypeSchema = z.enum([
  'createProject', 'updateProject', 'setProjectCompleted', 'deleteProject',
  'createMilestone', 'updateMilestone', 'setMilestoneCompleted', 'deleteMilestone',
  'createTask', 'updateTask', 'setTaskCompleted', 'deleteTask',
])

export const agentExistingReferenceSchema = z.object({
  kind: z.literal('existing'),
  id: z.string().uuid(),
}).strict()

export const agentDraftReferenceSchema = z.object({
  kind: z.literal('draft'),
  ref: draftRefSchema,
}).strict()

export const agentEntityReferenceSchema = z.discriminatedUnion('kind', [
  agentExistingReferenceSchema,
  agentDraftReferenceSchema,
])

const projectFields = {
  name: projectNameSchema,
  color: colorSchema,
  description: descriptionSchema,
  priority: nullablePrioritySchema,
  status: projectStatusSchema,
  targetDate: nullableIsoDateSchema,
} as const

const milestoneFields = {
  title: titleSchema,
  description: descriptionSchema,
  targetDate: nullableIsoDateSchema,
  status: milestoneStatusSchema,
  progressMode: milestoneProgressModeSchema,
  progress: z.number().int().min(0).max(100),
} as const

const taskFields = {
  title: titleSchema,
  description: descriptionSchema,
  priority: nullablePrioritySchema,
  dueDate: nullableIsoDateSchema,
  dueTime: dueTimeSchema.nullable(),
  isFocus: z.boolean(),
  status: taskStatusSchema.optional(),
  importance: taskImportanceSchema.optional(),
  estimatedMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  reminderAt: nullableIsoTimestampSchema.optional(),
  snoozedUntil: nullableIsoTimestampSchema.optional(),
  lastRemindedAt: nullableIsoTimestampSchema.optional(),
} as const

function requirePatch<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  return schema.strict().refine(value => Object.values(value).some(field => field !== undefined), {
    message: '更新动作至少需要一个可编辑字段',
  })
}

export const createProjectPayloadSchema = z.object(projectFields).strict()
export const updateProjectPayloadSchema = requirePatch(z.object({
  name: projectFields.name.optional(),
  color: projectFields.color.optional(),
  description: projectFields.description.optional(),
  priority: projectFields.priority.optional(),
  status: projectFields.status.optional(),
  targetDate: projectFields.targetDate.optional(),
}))

export const createMilestonePayloadSchema = z.object({
  projectId: agentEntityReferenceSchema,
  ...milestoneFields,
}).strict()
export const updateMilestonePayloadSchema = requirePatch(z.object({
  projectId: z.string().uuid().optional(),
  title: milestoneFields.title.optional(),
  description: milestoneFields.description.optional(),
  targetDate: milestoneFields.targetDate.optional(),
  status: milestoneFields.status.optional(),
  progressMode: milestoneFields.progressMode.optional(),
  progress: milestoneFields.progress.optional(),
}))

export const createTaskPayloadSchema = z.object({
  projectId: agentEntityReferenceSchema.nullable(),
  milestoneId: agentEntityReferenceSchema.nullable(),
  ...taskFields,
}).strict()
export const updateTaskPayloadSchema = requirePatch(z.object({
  projectId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  title: taskFields.title.optional(),
  description: taskFields.description.optional(),
  priority: taskFields.priority.optional(),
  dueDate: taskFields.dueDate.optional(),
  dueTime: taskFields.dueTime.optional(),
  isFocus: taskFields.isFocus.optional(),
  status: taskFields.status.optional(),
  importance: taskFields.importance.optional(),
  estimatedMinutes: taskFields.estimatedMinutes.optional(),
  reminderAt: taskFields.reminderAt.optional(),
  snoozedUntil: taskFields.snoozedUntil.optional(),
  lastRemindedAt: taskFields.lastRemindedAt.optional(),
}))

const completionPayloadSchema = z.object({ completed: z.boolean() }).strict()
const deletePayloadSchema = z.object({}).strict()

const commonActionFields = {
  actionId: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(600),
  draftRef: draftRefSchema.optional(),
} as const

function createActionSchema<
  Type extends 'createProject' | 'createMilestone' | 'createTask',
  Payload extends z.ZodType,
>(
  type: Type,
  payload: Payload,
) {
  return z.object({
    ...commonActionFields,
    type: z.literal(type),
    selected: z.boolean().default(true),
    dangerous: z.literal(false).default(false),
    targetId: z.string().uuid().optional(),
    expectedUpdatedAt: isoTimestampSchema.optional(),
    payload,
  }).strict()
}

function existingActionSchema<
  Type extends 'updateProject' | 'setProjectCompleted' | 'updateMilestone' | 'setMilestoneCompleted' | 'updateTask' | 'setTaskCompleted',
  Payload extends z.ZodType,
>(type: Type, payload: Payload) {
  return z.object({
    ...commonActionFields,
    type: z.literal(type),
    selected: z.boolean().default(true),
    dangerous: z.literal(false).default(false),
    targetId: z.string().uuid(),
    expectedUpdatedAt: isoTimestampSchema,
    payload,
  }).strict()
}

function deleteActionSchema<Type extends 'deleteProject' | 'deleteMilestone' | 'deleteTask'>(type: Type) {
  return z.object({
    ...commonActionFields,
    type: z.literal(type),
    selected: z.boolean().default(false),
    dangerous: z.literal(true).default(true),
    targetId: z.string().uuid(),
    expectedUpdatedAt: isoTimestampSchema,
    payload: deletePayloadSchema,
  }).strict()
}

export const createProjectActionSchema = createActionSchema('createProject', createProjectPayloadSchema)
export const updateProjectActionSchema = existingActionSchema('updateProject', updateProjectPayloadSchema)
export const setProjectCompletedActionSchema = existingActionSchema('setProjectCompleted', completionPayloadSchema)
export const deleteProjectActionSchema = deleteActionSchema('deleteProject')
export const createMilestoneActionSchema = createActionSchema('createMilestone', createMilestonePayloadSchema)
export const updateMilestoneActionSchema = existingActionSchema('updateMilestone', updateMilestonePayloadSchema)
export const setMilestoneCompletedActionSchema = existingActionSchema('setMilestoneCompleted', completionPayloadSchema)
export const deleteMilestoneActionSchema = deleteActionSchema('deleteMilestone')
export const createTaskActionSchema = createActionSchema('createTask', createTaskPayloadSchema)
export const updateTaskActionSchema = existingActionSchema('updateTask', updateTaskPayloadSchema)
export const setTaskCompletedActionSchema = existingActionSchema('setTaskCompleted', completionPayloadSchema)
export const deleteTaskActionSchema = deleteActionSchema('deleteTask')

export const agentActionSchema = z.discriminatedUnion('type', [
  createProjectActionSchema,
  updateProjectActionSchema,
  setProjectCompletedActionSchema,
  deleteProjectActionSchema,
  createMilestoneActionSchema,
  updateMilestoneActionSchema,
  setMilestoneCompletedActionSchema,
  deleteMilestoneActionSchema,
  createTaskActionSchema,
  updateTaskActionSchema,
  setTaskCompletedActionSchema,
  deleteTaskActionSchema,
])

export const agentPlanIssueCodeSchema = z.enum([
  'field',
  'missing-target',
  'conflict',
  'dependency',
  'danger-confirmation',
])

export const agentPlanIssueSchema = z.object({
  actionId: z.string().trim().min(1).max(160),
  code: agentPlanIssueCodeSchema,
  field: z.string().trim().min(1).max(160).optional(),
  message: z.string().trim().min(1).max(600),
}).strict()

export const agentPlanValidationSummarySchema = z.object({
  executable: z.boolean(),
  selectedCount: z.number().int().nonnegative(),
  dangerousCount: z.number().int().nonnegative(),
  estimatedMinutes: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  issues: z.array(agentPlanIssueSchema),
}).strict().refine(summary => summary.issueCount === summary.issues.length, {
  message: 'issueCount 必须与 issues 数量一致',
  path: ['issueCount'],
})

export const agentPlanDraftStatusSchema = z.enum(['draft', 'conflicted', 'applied', 'failed'])

export const agentPlanDraftSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  question: z.string().trim().min(1).max(4000),
  model: z.string().trim().min(1).max(160),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  status: agentPlanDraftStatusSchema,
  actions: z.array(agentActionSchema).max(30),
  validation: agentPlanValidationSummarySchema,
}).strict()

export type AgentEntityReference = z.infer<typeof agentEntityReferenceSchema>
export type AgentActionType = z.infer<typeof agentActionTypeSchema>
export type AgentAction = z.infer<typeof agentActionSchema>
export type AgentPlanIssue = z.infer<typeof agentPlanIssueSchema>
export type AgentPlanValidationSummary = z.infer<typeof agentPlanValidationSummarySchema>
export type AgentPlanDraftStatus = z.infer<typeof agentPlanDraftStatusSchema>
export type AgentPlanDraftV1 = z.infer<typeof agentPlanDraftSchema>
