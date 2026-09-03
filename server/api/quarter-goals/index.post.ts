import { createQuarterGoalInputSchema, getWorkspaceRepository } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => createQuarterGoalInputSchema.parse(body))
  return await getWorkspaceRepository(event).createQuarterGoal(input)
})
