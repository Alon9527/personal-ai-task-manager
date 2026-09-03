import { getWorkspaceRepository, reorderProjectsInputSchema } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => reorderProjectsInputSchema.parse(body))
  await getWorkspaceRepository(event).reorderProjects(input.orderedIds)
  return { ok: true }
})
