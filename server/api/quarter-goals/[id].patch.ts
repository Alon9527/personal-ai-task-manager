import { z } from 'zod'
import { getWorkspaceRepository, updateQuarterGoalInputSchema } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const patch = await readValidatedBody(event, body => updateQuarterGoalInputSchema.parse(body))
  return await getWorkspaceRepository(event).updateQuarterGoal(id, patch)
})
