import { beforeEach, describe, expect, it } from 'vitest'
import {
  AGENT_PLAN_RECOVERY_STORAGE_KEY,
  AGENT_PLAN_STORAGE_KEY,
  AgentPlanStorageError,
  createAgentPlanStorage,
} from '../../app/services/agent-plan-storage'

const CREATED_AT = '2026-08-13T08:00:00.000Z'
const DRAFT_ID = '90000000-0000-4000-8000-000000000001'

function draft(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: DRAFT_ID,
    question: '安排今天的重点工作',
    model: 'MiniMax-M2.7',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status: 'draft',
    actions: [{
      actionId: 'create-project-1',
      type: 'createProject',
      reason: '先建立项目',
      selected: true,
      dangerous: false,
      draftRef: 'project-1',
      payload: {
        name: '发布计划',
        color: '#6655DD',
        description: '',
        priority: 'high',
        status: 'active',
        targetDate: '2026-08-31',
      },
    }],
    validation: {
      executable: true,
      selectedCount: 1,
      dangerousCount: 0,
      estimatedMinutes: 0,
      issueCount: 0,
      issues: [],
    },
    ...overrides,
  }
}

describe('Agent plan storage', () => {
  beforeEach(() => localStorage.clear())

  it('round trips the latest pending draft without credential material', () => {
    const storage = createAgentPlanStorage(localStorage)

    storage.save(draft())

    expect(storage.load()).toEqual(draft())
    const raw = localStorage.getItem(AGENT_PLAN_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('apiKey')
    expect(raw).not.toContain('credential')
    expect(raw).not.toContain('region')
    expect(raw).not.toContain('modelSetting')
  })

  it('rejects provider registry, endpoint, region and credential fields instead of persisting them', () => {
    const storage = createAgentPlanStorage(localStorage)

    const forbiddenFields = {
      providerRegistry: { profiles: [] },
      endpoint: 'https://api.example.invalid/v1',
      region: 'global',
      credential: 'synthetic-agent-draft-secret',
      apiKey: 'synthetic-agent-draft-secret',
      modelSetting: { temperature: 0.2 },
    }

    for (const [field, value] of Object.entries(forbiddenFields)) {
      expect(() => storage.save({ ...draft(), [field]: value })).toThrow(AgentPlanStorageError)
      expect(localStorage.getItem(AGENT_PLAN_STORAGE_KEY)).toBeNull()
    }

    expect(localStorage.getItem(AGENT_PLAN_RECOVERY_STORAGE_KEY)).toBeNull()
  })

  it('quarantines malformed JSON before removing the active draft', () => {
    const storage = createAgentPlanStorage(localStorage)
    localStorage.setItem(AGENT_PLAN_STORAGE_KEY, '{bad json')

    expect(storage.load()).toBeNull()

    expect(localStorage.getItem(AGENT_PLAN_RECOVERY_STORAGE_KEY)).toBe('{bad json')
    expect(localStorage.getItem(AGENT_PLAN_STORAGE_KEY)).toBeNull()
  })

  it('quarantines schema-invalid saved data before removing the active draft', () => {
    const storage = createAgentPlanStorage(localStorage)
    const raw = JSON.stringify({ version: 1, status: 'draft', actions: [] })
    localStorage.setItem(AGENT_PLAN_STORAGE_KEY, raw)

    expect(storage.load()).toBeNull()

    expect(localStorage.getItem(AGENT_PLAN_RECOVERY_STORAGE_KEY)).toBe(raw)
    expect(localStorage.getItem(AGENT_PLAN_STORAGE_KEY)).toBeNull()
  })

  it('clears a previously pending draft when an applied draft is saved', () => {
    const storage = createAgentPlanStorage(localStorage)
    storage.save(draft())

    storage.save(draft({ status: 'applied' }))

    expect(storage.load()).toBeNull()
    expect(localStorage.getItem(AGENT_PLAN_STORAGE_KEY)).toBeNull()
  })

  it('writes an applied tombstone before cleanup and never reloads it as executable', () => {
    const values = new Map<string, string>()
    let removalBlocked = true
    const backingStore = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => {
        if (key === AGENT_PLAN_STORAGE_KEY && removalBlocked) throw new Error('remove blocked')
        values.delete(key)
      },
    }
    const storage = createAgentPlanStorage(backingStore)

    expect(() => storage.save(draft({ status: 'applied' })))
      .toThrow('无法清除 Agent 计划草稿')
    expect(JSON.parse(values.get(AGENT_PLAN_STORAGE_KEY)!)).toMatchObject({ status: 'applied' })

    expect(() => createAgentPlanStorage(backingStore).load())
      .toThrow('无法清除 Agent 计划草稿')
    removalBlocked = false
    expect(createAgentPlanStorage(backingStore).load()).toBeNull()
    expect(values.has(AGENT_PLAN_STORAGE_KEY)).toBe(false)
  })

  it('validates input and stores canonical defaults instead of the caller object', () => {
    const storage = createAgentPlanStorage(localStorage)
    const input = draft({
      question: '  安排今天的重点工作  ',
      model: '  MiniMax-M2.7  ',
      actions: [{
        actionId: 'create-project-1',
        type: 'createProject',
        reason: '  先建立项目  ',
        draftRef: ' project-1 ',
        payload: {
          name: '  发布计划  ',
          color: '#6655DD',
          description: '',
          priority: null,
          status: 'active',
          targetDate: null,
        },
      }],
    })

    storage.save(input)

    expect(storage.load()).toMatchObject({
      question: '安排今天的重点工作',
      model: 'MiniMax-M2.7',
      actions: [{
        actionId: 'create-project-1',
        reason: '先建立项目',
        selected: true,
        dangerous: false,
        draftRef: 'project-1',
        payload: { name: '发布计划' },
      }],
    })
    expect(JSON.parse(localStorage.getItem(AGENT_PLAN_STORAGE_KEY)!)).not.toHaveProperty('apiKey')
  })

  it('clear removes only the Agent draft and preserves MiniMax and UI settings', () => {
    localStorage.setItem('personal-ai-minimax-model:v1', 'MiniMax-M2.7')
    localStorage.setItem('personal-ai-minimax-region:v1', 'global')
    localStorage.setItem('personal-ai-ui-scale:v4', '1.1')
    const storage = createAgentPlanStorage(localStorage)
    storage.save(draft())

    storage.clear()

    expect(localStorage.getItem(AGENT_PLAN_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem('personal-ai-minimax-model:v1')).toBe('MiniMax-M2.7')
    expect(localStorage.getItem('personal-ai-minimax-region:v1')).toBe('global')
    expect(localStorage.getItem('personal-ai-ui-scale:v4')).toBe('1.1')
  })

  it('keeps the active copy when quarantine itself cannot be persisted', () => {
    const values = new Map([[AGENT_PLAN_STORAGE_KEY, '{bad json']])
    const backingStore = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === AGENT_PLAN_RECOVERY_STORAGE_KEY) throw new Error('disk full')
        values.set(key, value)
      },
      removeItem: (key: string) => { values.delete(key) },
    }

    expect(() => createAgentPlanStorage(backingStore).load()).toThrow(AgentPlanStorageError)
    expect(values.get(AGENT_PLAN_STORAGE_KEY)).toBe('{bad json')
  })

  it('reports an explicit error when reading the active draft fails', () => {
    const backingStore = {
      getItem: () => { throw new Error('storage blocked') },
      setItem: () => undefined,
      removeItem: () => undefined,
    }

    expect(() => createAgentPlanStorage(backingStore).load())
      .toThrow('无法读取 Agent 计划草稿')
  })

  it('reports an explicit error when a valid draft cannot be saved', () => {
    const backingStore = {
      getItem: () => null,
      setItem: () => { throw new Error('disk full') },
      removeItem: () => undefined,
    }

    expect(() => createAgentPlanStorage(backingStore).save(draft()))
      .toThrow('无法保存 Agent 计划草稿')
  })

  it('reports an explicit error when clearing the active draft fails', () => {
    const backingStore = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => { throw new Error('storage blocked') },
    }

    expect(() => createAgentPlanStorage(backingStore).clear())
      .toThrow('无法清除 Agent 计划草稿')
  })

  it('retains both raw copies when active removal fails after recovery succeeds', () => {
    const raw = '{bad json'
    const values = new Map([[AGENT_PLAN_STORAGE_KEY, raw]])
    const backingStore = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => {
        if (key === AGENT_PLAN_STORAGE_KEY) throw new Error('remove blocked')
        values.delete(key)
      },
    }

    expect(() => createAgentPlanStorage(backingStore).load())
      .toThrow('Agent 计划草稿已损坏，但无法安全隔离原始数据')
    expect(values.get(AGENT_PLAN_RECOVERY_STORAGE_KEY)).toBe(raw)
    expect(values.get(AGENT_PLAN_STORAGE_KEY)).toBe(raw)
  })
})
