import { getWorkspaceRepository, reorderTasksInputSchema } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => reorderTasksInputSchema.parse(body))
  await getWorkspaceRepository(event).reorderTasks(input.group, input.orderedIds)
  return { ok: true }
})
