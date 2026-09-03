import { getWorkspaceRepository, reorderQuarterGoalsInputSchema } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => reorderQuarterGoalsInputSchema.parse(body))
  await getWorkspaceRepository(event).reorderQuarterGoals(input.quarter, input.orderedIds)
  return { ok: true }
})
