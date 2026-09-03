import { getWorkspaceRepository, reorderMilestonesInputSchema } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => reorderMilestonesInputSchema.parse(body))
  await getWorkspaceRepository(event).reorderMilestones(input.projectId, input.orderedIds)
  return { ok: true }
})
