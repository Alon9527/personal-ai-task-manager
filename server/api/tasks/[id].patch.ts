import { z } from 'zod'
import { getWorkspaceRepository, updateTaskInputSchema } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const patch = await readValidatedBody(event, body => updateTaskInputSchema.parse(body))
  return await getWorkspaceRepository(event).updateTask(id, patch)
})
