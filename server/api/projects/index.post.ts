import { createProjectInputSchema, getWorkspaceRepository } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => createProjectInputSchema.parse(body))
  return await getWorkspaceRepository(event).createProject(input)
})
