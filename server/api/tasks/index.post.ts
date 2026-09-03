import { createTaskInputSchema, getWorkspaceRepository } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => createTaskInputSchema.parse(body))
  return await getWorkspaceRepository(event).createTask(input)
})
