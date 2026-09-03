import { z } from 'zod'
import { getWorkspaceRepository, snoozeInputSchema } from '../../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, body => snoozeInputSchema.parse(body))
  return await getWorkspaceRepository(event).snoozeTask(id, input.until)
})
