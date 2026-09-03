import { workspaceDocumentSchema } from '#shared/workspace'
import { getWorkspaceRepository } from '../utils/workspace-api'

const replacementSchema = workspaceDocumentSchema.strict()

export default defineEventHandler(async (event) => {
  const document = await readValidatedBody(event, body => replacementSchema.parse(body))
  return await getWorkspaceRepository(event).replaceWorkspaceDocument(document)
})
