import { z } from 'zod'
import { getWorkspaceRepository, updateProjectInputSchema } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const patch = await readValidatedBody(event, body => updateProjectInputSchema.parse(body))
  return await getWorkspaceRepository(event).updateProject(id, patch)
})
