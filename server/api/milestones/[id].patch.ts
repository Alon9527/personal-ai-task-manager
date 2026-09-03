import { z } from 'zod'
import { getWorkspaceRepository, updateMilestoneInputSchema } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const patch = await readValidatedBody(event, body => updateMilestoneInputSchema.parse(body))
  return await getWorkspaceRepository(event).updateMilestone(id, patch)
})
