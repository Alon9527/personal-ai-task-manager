import { describe, expect, it, vi } from 'vitest'
import { ApiWorkspaceGateway } from '../../app/data/api-workspace-gateway'

describe('ApiWorkspaceGateway', () => {
  it('loads the workspace only through the Nuxt API', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: 1, projects: [], tasks: [] })
    const gateway = new ApiWorkspaceGateway(fetcher)

    const document = await gateway.loadWorkspace()

    expect(document).toEqual({
      version: 3,
      projects: [],
      milestones: [],
      tasks: [],
      quarterGoals: [],
    })
    expect(fetcher).toHaveBeenCalledWith('/api/workspace', { query: { includeDeleted: false } })
  })

  it('rejects malformed API workspace responses instead of casting them as current', async () => {
    const gateway = new ApiWorkspaceGateway(vi.fn().mockResolvedValue({ version: 3, projects: [] }))

    await expect(gateway.loadWorkspace()).rejects.toThrow()
  })

  it('maps project deletion to the resource route', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    const gateway = new ApiWorkspaceGateway(fetcher)

    await gateway.deleteProject('10000000-0000-4000-8000-000000000001')

    expect(fetcher).toHaveBeenCalledWith(
      '/api/projects/10000000-0000-4000-8000-000000000001',
      { method: 'DELETE' },
    )
  })

  it('maps permanent trash cleanup to the protected API route', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    const gateway = new ApiWorkspaceGateway(fetcher)

    await gateway.emptyTrash()

    expect(fetcher).toHaveBeenCalledWith('/api/trash', { method: 'DELETE' })
  })

  it('maps full workspace clearing to a separate protected API route', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    const gateway = new ApiWorkspaceGateway(fetcher)

    await gateway.clearWorkspaceData()

    expect(fetcher).toHaveBeenCalledWith('/api/workspace-data', { method: 'DELETE' })
  })

  it('maps milestone mutations to their exact resource routes', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      id: '40000000-0000-4000-8000-000000000001',
    })
    const gateway = new ApiWorkspaceGateway(fetcher)
    const id = '40000000-0000-4000-8000-000000000001'
    const projectId = '10000000-0000-4000-8000-000000000001'
    const input = {
      projectId,
      title: 'API milestone',
      description: '',
      targetDate: null,
      status: 'planned' as const,
      progressMode: 'auto' as const,
      progress: 0,
    }

    expect(gateway.createMilestone).toBeTypeOf('function')
    expect(gateway.updateMilestone).toBeTypeOf('function')
    expect(gateway.deleteMilestone).toBeTypeOf('function')
    expect(gateway.restoreMilestone).toBeTypeOf('function')
    expect(gateway.reorderMilestones).toBeTypeOf('function')

    await gateway.createMilestone(input)
    await gateway.updateMilestone(id, { title: 'Updated' })
    await gateway.deleteMilestone(id)
    await gateway.restoreMilestone(id)
    await gateway.reorderMilestones(projectId, [id])

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/milestones', { method: 'POST', body: input })
    expect(fetcher).toHaveBeenNthCalledWith(2, `/api/milestones/${id}`, {
      method: 'PATCH', body: { title: 'Updated' },
    })
    expect(fetcher).toHaveBeenNthCalledWith(3, `/api/milestones/${id}`, { method: 'DELETE' })
    expect(fetcher).toHaveBeenNthCalledWith(4, `/api/milestones/${id}/restore`, { method: 'POST' })
    expect(fetcher).toHaveBeenNthCalledWith(5, '/api/milestones/reorder', {
      method: 'POST', body: { projectId, orderedIds: [id] },
    })
  })
})
