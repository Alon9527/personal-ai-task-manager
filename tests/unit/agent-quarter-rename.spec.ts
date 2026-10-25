import { describe, expect, it } from 'vitest'
import { agentActionSchema, agentPlanDraftSchema } from '../../app/services/agent-plan-schema'
import { validateAgentPlan } from '../../app/services/agent-plan-validation'
import { simulateAgentPlan } from '../../app/services/agent-plan-executor'
import { workspaceDocumentSchema, DEMO_OWNER_ID } from '../../shared/workspace'

const stamp = '2026-10-25T01:00:00.000Z'
const nextStamp = '2026-10-25T02:00:00.000Z'
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']
const fixture = () => workspaceDocumentSchema.parse({ version: 3, tasks: [], projects: [], milestones: [], quarterGoals: ids.map((id, i) => ({
  id, ownerId: DEMO_OWNER_ID, quarter: `2026-Q${i ? 4 : 1}`, title: '提升三维视频制作能力',
  description: '来源：年度总结；原文依据：分阶段推进', progress: 35, status: 'active', sortOrder: i,
  createdAt: stamp, updatedAt: stamp, deletedAt: null,
})) })
const action = (index = 0) => ({ actionId: `rename-${index}`, type: 'renameQuarterGoal', reason: '按季度阶段区分', targetId: ids[index], expectedUpdatedAt: stamp, payload: { title: index ? '完成年度视频成果交付' : '建立视频制作流程' } })
const plan = (actions: unknown[] = [action()]) => agentPlanDraftSchema.parse({ version: 1, id: '20000000-0000-4000-8000-000000000001', question: '区分季度阶段', model: 'test-model', createdAt: stamp, updatedAt: stamp, status: 'draft', actions, validation: { executable: false, selectedCount: 0, dangerousCount: 0, estimatedMinutes: 0, issueCount: 0, issues: [] } })

describe('quarter goal rename plan', () => {
  it('accepts a narrow rename action', () => {
    expect(agentActionSchema.safeParse(action()).success).toBe(true)
  })
  it('renames by ID and preserves identical-name goals and source evidence', () => {
    const original = fixture()
    const draft = plan()
    expect(validateAgentPlan(draft, original).executable).toBe(true)
    const result = simulateAgentPlan(draft, original, { now: () => nextStamp })
    expect(result.document.quarterGoals[0]).toEqual({ ...original.quarterGoals[0], title: '建立视频制作流程', updatedAt: nextStamp })
    expect(result.document.quarterGoals[1]).toEqual(original.quarterGoals[1])
    expect(original.quarterGoals[0]?.title).toBe('提升三维视频制作能力')
    expect(result.results[0]).toMatchObject({ entityType: 'quarterGoal', entityId: ids[0], outcome: 'updated' })
  })
  it.each(['unknown', 'deleted', 'stale'] as const)('rejects %s targets without partial modification', kind => {
    const document = fixture()
    if (kind === 'unknown') document.quarterGoals.pop()
    if (kind === 'deleted') document.quarterGoals[1]!.deletedAt = nextStamp
    if (kind === 'stale') document.quarterGoals[1]!.updatedAt = nextStamp
    const before = JSON.stringify(document)
    expect(() => simulateAgentPlan(plan([action(), action(1)]), document)).toThrow()
    expect(JSON.stringify(document)).toBe(before)
  })
  it('rejects duplicate writes to the same goal', () => {
    expect(() => simulateAgentPlan(plan([action(), { ...action(), actionId: 'duplicate' }]), fixture())).toThrow()
  })
  it.each([{ title: '' }, { title: 'new', progress: 100 }, { title: 'new', quarter: '2027-Q1' }])('rejects extra or empty payload %j', payload => {
    expect(agentActionSchema.safeParse({ ...action(), payload }).success).toBe(false)
  })
})
