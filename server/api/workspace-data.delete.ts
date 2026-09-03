import { getWorkspaceRepository } from '../utils/workspace-api'

export default defineEventHandler(async (event) => {
  await getWorkspaceRepository(event).clearWorkspaceData()
  return { ok: true }
})
