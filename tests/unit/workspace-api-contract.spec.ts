import { describe, expect, it } from 'vitest'
import { DEMO_OWNER_ID } from '../../shared/workspace'
import {
  createTaskInputSchema,
  createWorkspaceRepository,
  reorderProjectsInputSchema,
} from '../../server/utils/workspace-api'

describe('workspace API contract', () => {
  it('rejects missing private Supabase configuration', () => {
    expect(() => createWorkspaceRepository({ url: '', key: '', ownerId: DEMO_OWNER_ID }))
      .toThrow('Supabase 服务端配置不完整')
  })

  it('rejects invalid task and ordering input before persistence', () => {
    expect(createTaskInputSchema.safeParse({
      title: '   ', description: '', projectId: null, priority: null,
      dueDate: null, dueTime: null, isFocus: false,
    }).success).toBe(false)

    const id = '10000000-0000-4000-8000-000000000001'
    expect(reorderProjectsInputSchema.safeParse({ orderedIds: [id, id] }).success).toBe(false)
  })
})
