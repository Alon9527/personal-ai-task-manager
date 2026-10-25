import { describe, it, expect, vi } from 'vitest'
import { shallowRef } from 'vue'
import { createAgentChat } from '../../app/services/agent-chat'
import { createAgentConversation } from '../../app/services/agent-conversation'
import { createAgentPlanController } from '../../app/composables/useAgentPlan'
import { agentPlanDraftSchema } from '../../app/services/agent-plan-schema'
import { workspaceDocumentSchema, DEMO_OWNER_ID } from '../../shared/workspace'
const stamp = '2026-10-25T01:00:00.000Z'
const id = '10000000-0000-4000-8000-000000000001'
function setup() {
  const document = shallowRef(workspaceDocumentSchema.parse({ version: 3, projects: [], tasks: [], milestones: [], quarterGoals: [{ id, ownerId: DEMO_OWNER_ID, title: '同名目标', description: '原文依据', quarter: '2026-Q4', progress: 35, status: 'active', sortOrder: 0, createdAt: stamp, updatedAt: stamp, deletedAt: null }] }))
  const replace = vi.fn(async next => { document.value = next })
  const workspace = { document, readLatestDocument: async () => document.value, replaceWorkspaceDocument: replace }
  const plan = createAgentPlanController({ workspace, storage: { load: () => null, save: () => {}, clear: () => {} } })
  const draft = agentPlanDraftSchema.parse({ version: 1, id: crypto.randomUUID(), question: '改名', model: 'test', createdAt: stamp, updatedAt: stamp, status: 'draft', actions: [{ actionId: 'rename', type: 'renameQuarterGoal', reason: '区分阶段', targetId: id, expectedUpdatedAt: stamp, payload: { title: '年度交付' } }], validation: { executable: false, selectedCount: 0, dangerousCount: 0, estimatedMinutes: 0, issueCount: 0, issues: [] } })
  const ask = vi.fn(async () => ({ status: 'ready' as const, isCurrent: () => true, value: { response: { answer: '建议改成年度交付', actions: draft.actions, sources: [], generatedAt: stamp, model: 'test', usage: null }, draft, error: null } }))
  const log = createAgentConversation()
  const chat = createAgentChat({ log, plan, readDocument: workspace.readLatestDocument, ask, fingerprint: async target => JSON.stringify(target) })
  return { chat, log, plan, draft, ask, replace, document }
}
const target = { kind: 'minimax' as const, modelId: 'MiniMax-M3' as const }
describe('shared Agent chat', () => {
  it('binds confirmation to a rendered proposal and executes locally exactly once', async () => {
    const s = setup()
    await s.chat.send({ question: '改第四季度目标名', target })
    await s.chat.send({ question: '确定', target })
    expect(s.replace).not.toHaveBeenCalled()
    s.chat.review()
    await s.chat.send({ question: '确定', target })
    expect(s.ask).toHaveBeenCalledTimes(1)
    expect(s.replace).toHaveBeenCalledTimes(1)
    expect(s.document.value.quarterGoals[0]?.title).toBe('年度交付')
    expect(s.log.messages.value.at(-1)?.text).toContain('年度交付')
    await s.chat.send({ question: '确定', target })
    expect(s.replace).toHaveBeenCalledTimes(1)
  })
  it('sends history and pending plan, but revisions require adoption', async () => {
    const s = setup()
    await s.chat.send({ question: '改名', target })
    s.chat.review()
    await s.chat.send({ question: '换个名字', target })
    const input = s.ask.mock.calls.at(-1)?.[0] as any
    expect(input.conversation.history.map((m: any) => m.text)).toEqual(['改名', '建议改成年度交付'])
    expect(input.conversation.pendingPlan.id).toBe(s.plan.draft.value?.id)
    expect(s.log.state.value.candidate).not.toBeNull()
    await s.chat.send({ question: '确定', target })
    expect(s.replace).not.toHaveBeenCalled()
  })
  it('requires consent for a changed model and does not transmit history beforehand', async () => {
    const s = setup()
    await s.chat.send({ question: '改名', target })
    await s.chat.send({ question: '继续', target: { kind: 'custom', profileId: crypto.randomUUID() } })
    expect(s.ask).toHaveBeenCalledTimes(1)
    expect(s.chat.consent.value).not.toBeNull()
  })
  it('rejects changed plan contents and stale goal versions', async () => {
    const s = setup()
    await s.chat.send({ question: '改名', target }); s.chat.review()
    s.document.value.quarterGoals[0]!.updatedAt = '2026-10-25T02:00:00.000Z'
    await s.chat.confirm()
    expect(s.replace).not.toHaveBeenCalled()
    expect(s.chat.error.value).toBeTruthy()
  })
  it('ignores cancelled responses without erasing the user message', async () => {
    const s = setup(); let finish!: (value: any) => void
    s.ask.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = s.chat.send({ question: '改名', target })
    await vi.waitFor(() => expect(s.ask).toHaveBeenCalledOnce())
    s.chat.cancel()
    finish({ status: 'ready', isCurrent: () => true, value: { response: { answer: '过时回答' }, draft: s.draft, error: null } })
    await pending
    expect(s.plan.draft.value).toBeNull()
    expect(s.log.messages.value).toHaveLength(1)
    expect(s.log.messages.value[0]?.status).toBe('failed')
  })
  it('does not arm a modified plan even with the original timestamp', async () => {
    const s = setup(); await s.chat.send({ question: '改名', target }); s.chat.review()
    s.plan.draft.value!.actions[0]!.payload = { title: '偷偷改动' }
    await s.chat.confirm()
    expect(s.replace).not.toHaveBeenCalled()
  })
  it('rejects obsolete content inside the execution controller', async () => {
    const s = setup(); s.plan.setDraft(s.draft)
    expect((await s.plan.requestExecution('old-content')).status).toBe('confirmation-stale')
    expect(s.replace).not.toHaveBeenCalled()
  })
  it('retains a saved candidate when the original changed, and requires choosing again', async () => {
    const s = setup(); await s.chat.send({ question: '改名', target })
    await s.chat.send({ question: '修订', target })
    s.plan.draft.value!.question = 'another change'
    s.chat.adopt()
    expect(s.log.state.value.candidate).not.toBeNull()
    expect(s.chat.error.value).toContain('计划已变化')
    expect(s.replace).not.toHaveBeenCalled()
  })
  it('preserves structured proposal versions after adopting a revision', async () => {
    const s = setup(); await s.chat.send({ question: '改名', target })
    const first = s.plan.draft.value!.id
    await s.chat.send({ question: '修订', target })
    s.chat.adopt()
    const snapshots = s.log.messages.value.filter(m => 'plan' in m)
    expect(snapshots).toHaveLength(2)
    expect((snapshots[0] as any).plan.id).toBe(first)
    expect((snapshots[0] as any).plan.actions[0].payload.title).toBe('年度交付')
  })
  it('records execution through the independent review controller, not only chat confirm', async () => {
    const s = setup(); await s.chat.send({ question: '改名', target })
    await s.plan.requestExecution()
    expect(s.log.messages.value.at(-1)?.text).toContain('已执行 1 项操作')
    expect(s.log.messages.value.at(-1)?.text).toContain('同名目标')
    expect(s.log.messages.value.at(-1)?.text).toContain('年度交付')
  })
})
