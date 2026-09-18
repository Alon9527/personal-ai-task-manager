import { z } from 'zod'
import type { H3Event } from 'h3'
import { milestoneSchema, projectSchema, quarterGoalStatusSchema, quarterKeySchema, taskImportanceSchema, taskStatusSchema } from '#shared/workspace'
import { SupabaseWorkspaceRepository } from './supabase-workspace-repository'

const projectInputSchema = projectSchema.pick({
  name: true,
  color: true,
  description: true,
  priority: true,
  status: true,
  targetDate: true,
})

const taskFields = {
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  projectId: z.string().uuid().nullable(),
  milestoneId: z.string().uuid().nullable(),
  priority: z.enum(['low', 'medium', 'high']).nullable(),
  dueDate: z.iso.date().nullable(),
  startDate: z.iso.date().nullable().optional(),
  completionDate: z.iso.date().nullable().optional(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  isFocus: z.boolean(),
  status: taskStatusSchema.optional(),
  importance: taskImportanceSchema.optional(),
  estimatedMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  reminderAt: z.string().datetime().nullable().optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  lastRemindedAt: z.string().datetime().nullable().optional(),
}

const quarterGoalFields = {
  quarter: quarterKeySchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  progress: z.number().int().min(0).max(100),
  status: quarterGoalStatusSchema,
}

const milestoneInputSchema = milestoneSchema.pick({
  projectId: true,
  title: true,
  description: true,
  targetDate: true,
  status: true,
  progressMode: true,
  progress: true,
})

const uniqueIds = z.array(z.string().uuid()).min(1).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: '排序 ID 不能重复' })
  }
})

export const createProjectInputSchema = projectInputSchema
export const updateProjectInputSchema = projectInputSchema.partial().refine(
  value => Object.keys(value).length > 0,
  '至少提供一个项目字段',
)
export const createTaskInputSchema = z.object(taskFields)
export const updateTaskInputSchema = z.object(taskFields).partial().refine(
  value => Object.keys(value).length > 0,
  '至少提供一个任务字段',
)
export const createQuarterGoalInputSchema = z.object(quarterGoalFields)
export const updateQuarterGoalInputSchema = z.object(quarterGoalFields).partial().refine(
  value => Object.keys(value).length > 0,
  '至少提供一个季度目标字段',
)
export const createMilestoneInputSchema = milestoneInputSchema
export const updateMilestoneInputSchema = milestoneInputSchema.partial().refine(
  value => Object.keys(value).length > 0,
  '至少提供一个里程碑字段',
)

export const reorderProjectsInputSchema = z.object({ orderedIds: uniqueIds })
export const reorderTasksInputSchema = z.object({
  group: z.enum(['focus', 'later', 'completed']),
  orderedIds: uniqueIds,
})
export const reorderQuarterGoalsInputSchema = z.object({
  quarter: quarterKeySchema,
  orderedIds: uniqueIds,
})
export const reorderMilestonesInputSchema = z.object({
  projectId: z.string().uuid(),
  orderedIds: uniqueIds,
})
export const completionInputSchema = z.object({ completed: z.boolean() })
export const snoozeInputSchema = z.object({ until: z.string().datetime() })

export function createWorkspaceRepository(config: { url: string, key: string, ownerId: string }) {
  if (!config.url || !config.key || !config.ownerId) {
    throw Object.assign(new Error('Supabase 服务端配置不完整'), { statusCode: 503 })
  }
  return new SupabaseWorkspaceRepository(config)
}

export function getWorkspaceRepository(event: H3Event) {
  const config = useRuntimeConfig(event)
  return createWorkspaceRepository({
    url: String(config.supabaseUrl ?? ''),
    key: String(config.supabaseServiceRoleKey ?? ''),
    ownerId: String(config.demoOwnerId ?? ''),
  })
}
