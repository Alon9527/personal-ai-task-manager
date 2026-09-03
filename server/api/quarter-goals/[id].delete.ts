import { z } from 'zod'
import { getWorkspaceRepository } from '../../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  await getWorkspaceRepository(event).deleteQuarterGoal(id)
  return { ok: true }
})
