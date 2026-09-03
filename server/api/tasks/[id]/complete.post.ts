import { z } from 'zod'
import { completionInputSchema, getWorkspaceRepository } from '../../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, body => completionInputSchema.parse(body))
  return await getWorkspaceRepository(event).setTaskCompleted(id, input.completed)
})
