import { z } from 'zod'
import { quarterGoalSchema } from '#shared/workspace'
import { WorkspaceError } from '../data/workspace-gateway'

const inputSchema = quarterGoalSchema.pick({ quarter: true, title: true, description: true, progress: true, status: true }).strict()
const batchSchema = z.array(inputSchema).min(1).max(16)

export function parseQuarterGoalBatch(input: unknown) {
  const result = batchSchema.safeParse(input)
  if (!result.success) throw new WorkspaceError('validation', '请检查所选目标：每批 1～16 项，需填写有效季度和标题，描述含来源最多 4000 字。')
  return result.data
}

export function quarterGoalKey(goal: { quarter: string, title: string }) {
  return `${goal.quarter}:${goal.title.trim().toLocaleLowerCase()}`
}
