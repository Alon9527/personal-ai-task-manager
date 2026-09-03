import { workspaceDocumentSchema } from '#shared/workspace'
import type { WorkspaceDocument } from '#shared/workspace'
import type { WorkspaceGateway } from './workspace-gateway'

export class WorkspaceTransaction {
  constructor(private readonly gateway: WorkspaceGateway) {}

  async replace(document: WorkspaceDocument): Promise<WorkspaceDocument> {
    const payload = workspaceDocumentSchema.parse(structuredClone(document))
    const saved = await this.gateway.replaceWorkspaceDocument(payload)
    return structuredClone(workspaceDocumentSchema.parse(saved))
  }
}
