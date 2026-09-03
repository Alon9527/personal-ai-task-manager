import { createMilestoneInputSchema, getWorkspaceRepository } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => createMilestoneInputSchema.parse(body))
  return await getWorkspaceRepository(event).createMilestone(input)
})
