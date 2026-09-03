import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ClearWorkspaceDataDialog from '../../app/components/workspace/ClearWorkspaceDataDialog.vue'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import { createWorkspaceModel } from '../../app/models/workspace-model'
import {
  AGENT_PLAN_STORAGE_KEY,
  createAgentPlanStorage,
} from '../../app/services/agent-plan-storage'
import { AI_MODEL_SELECTION_KEY } from '../../app/services/ai-model-target'

const NOW = '2026-08-13T08:00:00.000Z'

function pendingDraft() {
  return {
    version: 1 as const,
    id: '90000000-0000-4000-8000-000000000002',
    question: '整理本周计划',
    model: 'MiniMax-M2.7',
    createdAt: NOW,
    updatedAt: NOW,
    status: 'draft' as const,
    actions: [],
    validation: {
      executable: true,
      selectedCount: 0,
      dangerousCount: 0,
      estimatedMinutes: 0,
      issueCount: 0,
      issues: [],
    },
  }
}

describe('ClearWorkspaceDataDialog', () => {
  it('requires the exact confirmation phrase and shows deletion counts', async () => {
    const wrapper = await mountSuspended(ClearWorkspaceDataDialog, {
      props: { open: true, taskCount: 7, projectCount: 3, milestoneCount: 2, quarterGoalCount: 4, saving: false },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('7 项任务')
    expect(wrapper.text()).toContain('3 个项目')
    expect(wrapper.text()).toContain('2 个里程碑')
    expect(wrapper.text()).toContain('4 个季度目标')
    expect(wrapper.text()).toContain('不会删除 MiniMax 密钥、模型及界面设置')
    const confirm = wrapper.get('[data-confirm-clear-workspace]')
    expect(confirm.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-clear-workspace-phrase]').setValue('清空')
    expect(wrapper.get('[data-confirm-clear-workspace]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-clear-workspace-phrase]').setValue('清空数据')
    expect((wrapper.get('[data-clear-workspace-phrase]').element as HTMLInputElement).value).toBe('清空数据')
    expect(wrapper.get('[data-confirm-clear-workspace]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-confirm-clear-workspace]').trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('allows cancellation when idle and locks every exit while saving', async () => {
    const idle = await mountSuspended(ClearWorkspaceDataDialog, {
      props: { open: true, taskCount: 1, projectCount: 1, milestoneCount: 1, quarterGoalCount: 1, saving: false },
      global: { stubs: { Teleport: true } },
    })
    await idle.get('[data-cancel-clear-workspace]').trigger('click')
    expect(idle.emitted('close')).toHaveLength(1)

    const saving = await mountSuspended(ClearWorkspaceDataDialog, {
      props: { open: true, taskCount: 1, projectCount: 1, milestoneCount: 1, quarterGoalCount: 1, saving: true },
      global: { stubs: { Teleport: true } },
    })
    expect(saving.get('[data-clear-workspace-phrase]').attributes('disabled')).toBeDefined()
    expect(saving.get('[data-cancel-clear-workspace]').attributes('disabled')).toBeDefined()
    expect(saving.get('[data-close-clear-workspace]').attributes('disabled')).toBeDefined()
    expect(saving.get('[data-confirm-clear-workspace]').attributes('disabled')).toBeDefined()
  })

  it('passes the milestone collection count from the workspace info dialog', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'app/components/workspace/WorkspaceInfoDialog.vue'),
      'utf8',
    )

    expect(source).toContain(':milestone-count="workspace.document.value.milestones.length"')
    expect(source).toContain(':quarter-goal-count="workspace.document.value.quarterGoals.length"')
    expect(source).not.toContain(':milestone-count="workspace.document.value.quarterGoals.length"')
  })
})

describe('workspace data reset and Agent plan storage', () => {
  it('clears business collections and the pending draft while preserving settings', async () => {
    const values = new Map<string, string>()
    const backingStore = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    values.set('personal-ai-minimax-model:v1', 'MiniMax-M2.7')
    values.set('personal-ai-minimax-region:v1', 'global')
    values.set('personal-ai-ui-scale:v4', '1.1')
    values.set(AI_MODEL_SELECTION_KEY, JSON.stringify({
      kind: 'custom',
      profileId: '550e8400-e29b-41d4-a716-446655440000',
    }))
    const gateway = new LocalWorkspaceGateway(backingStore, () => NOW)
    const draftStorage = createAgentPlanStorage(backingStore)
    draftStorage.save(pendingDraft())
    const model = createWorkspaceModel(gateway, draftStorage)
    await model.load()
    expect(model.tasks.value.length).toBeGreaterThan(0)

    await model.clearWorkspaceData()

    expect(model.document.value).toEqual({
      version: 3,
      projects: [],
      milestones: [],
      tasks: [],
      quarterGoals: [],
    })
    expect(draftStorage.load()).toBeNull()
    expect(values.get('personal-ai-minimax-model:v1')).toBe('MiniMax-M2.7')
    expect(values.get('personal-ai-minimax-region:v1')).toBe('global')
    expect(values.get('personal-ai-ui-scale:v4')).toBe('1.1')
    expect(values.get(AI_MODEL_SELECTION_KEY)).toBe(JSON.stringify({
      kind: 'custom',
      profileId: '550e8400-e29b-41d4-a716-446655440000',
    }))
  })

  it('preserves the pending draft when the gateway clear fails', async () => {
    const values = new Map<string, string>()
    const backingStore = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    const gateway = new LocalWorkspaceGateway(backingStore, () => NOW)
    const draftStorage = createAgentPlanStorage(backingStore)
    draftStorage.save(pendingDraft())
    const model = createWorkspaceModel(gateway, draftStorage)
    await model.load()
    gateway.clearWorkspaceData = async () => { throw new Error('workspace clear failed') }

    await expect(model.clearWorkspaceData()).rejects.toThrow('workspace clear failed')

    expect(draftStorage.load()).toEqual(pendingDraft())
    expect(model.tasks.value.length).toBeGreaterThan(0)
  })

  it('reports draft-clear failure after durable workspace clear without resurrecting business data', async () => {
    const values = new Map<string, string>()
    const backingStore = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => {
        if (key === AGENT_PLAN_STORAGE_KEY) throw new Error('draft clear failed')
        values.delete(key)
      },
    }
    const gateway = new LocalWorkspaceGateway(backingStore, () => NOW)
    const draftStorage = createAgentPlanStorage(backingStore)
    draftStorage.save(pendingDraft())
    const model = createWorkspaceModel(gateway, draftStorage)
    await model.load()

    await expect(model.clearWorkspaceData()).rejects.toThrow('工作区数据已清空，但 Agent 计划草稿清理失败')

    expect(await gateway.loadWorkspace({ includeDeleted: true })).toEqual({
      version: 3,
      projects: [],
      milestones: [],
      tasks: [],
      quarterGoals: [],
    })
    expect(model.document.value.tasks).toEqual([])
    expect(values.get(AGENT_PLAN_STORAGE_KEY)).not.toBeUndefined()
    expect(model.error.value).toContain('工作区数据已清空')
  })
})
