import { getWorkspaceRepository } from '../utils/workspace-api'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  return await getWorkspaceRepository(event).loadWorkspace({
    includeDeleted: query.includeDeleted === 'true',
  })
})
