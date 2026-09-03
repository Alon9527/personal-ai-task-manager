import { z } from 'zod'
import { getWorkspaceRepository } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  await getWorkspaceRepository(event).deleteMilestone(id)
  return { ok: true }
})
