import { describe, expect, it } from 'vitest'
import { createAgentConversation, conversationHistory, isExplicitConfirmation, planContentRevision } from '../../app/services/agent-conversation'
import { agentPlanDraftSchema } from '../../app/services/agent-plan-schema'
function storage(initial: string | null = null) {
  let value = initial
  return { getItem: () => value, setItem: (_: string, next: string) => { value = next }, removeItem: () => { value = null } }
}
describe('durable agent conversation', () => {
  it('persists image count only, never image bytes in history', () => {
    const disk = storage(); const c = createAgentConversation(disk)
    const id = c.beginTurn('看看图片', 'model', 2); c.finishTurn(id, '识别完成')
    const restored = createAgentConversation(disk); restored.load()
    expect(restored.messages.value[0]?.imageCount).toBe(2)
    expect(conversationHistory(restored.messages.value)[0]).toEqual({role:'user',text:'看看图片'})
    expect(disk.getItem()).not.toContain('base64')
  })
  it('does not discard a pending plan when new-conversation storage fails', () => {
    let discarded = false
    const c = createAgentConversation({ getItem: () => null, setItem: () => { throw new Error('disk full') } })
    c.load(); c.append('user', '保留历史')
    expect(() => c.reset(() => { discarded = true })).toThrow()
    expect(discarded).toBe(false)
    expect(c.messages.value[0]?.text).toBe('保留历史')
  })
  it('restores the transcript if abandoning the pending plan fails', () => {
    const disk = storage(); const c = createAgentConversation(disk)
    c.load(); c.append('user', '保留历史')
    expect(() => c.reset(() => { throw new Error('plan storage failed') })).toThrow()
    const restored = createAgentConversation(disk); restored.load()
    expect(restored.messages.value[0]?.text).toBe('保留历史')
  })
  it('retains both sides across reload without arming an old confirmation', () => {
    const disk = storage(); const c = createAgentConversation(disk)
    c.load(); c.append('user', '改第一季度'); c.append('assistant', '建议建立基础')
    const restored = createAgentConversation(disk); restored.load()
    expect(restored.messages.value.map(m => m.text)).toEqual(['改第一季度', '建议建立基础'])
    expect(restored.displayedRevision.value).toBeNull()
  })
  it('does not overwrite corrupt stored content', () => {
    const disk = storage('{bad'); const c = createAgentConversation(disk); c.load()
    expect(c.error.value).toContain('损坏')
    expect(() => c.append('user', '新内容')).toThrow()
    expect(disk.getItem()).toBe('{bad')
  })
  it('does not duplicate a failed user turn on retry', () => {
    const c = createAgentConversation(storage()); c.load()
    const id = c.beginTurn('改名称', 'model-a'); c.failTurn(id, '连接失败')
    expect(c.beginTurn('改名称', 'model-a')).toBe(id)
    c.finishTurn(id, '建议如下')
    expect(c.messages.value.filter(m => m.role === 'user')).toHaveLength(1)
    expect(c.messages.value.at(-1)?.text).toBe('建议如下')
  })
  it('requires fresh consent for a changed model target and keeps visible messages', () => {
    const c = createAgentConversation(storage()); c.load()
    c.beginTurn('第一条', 'a'); c.append('assistant', '回答')
    expect(c.needsConsent('b')).toBe(true)
    expect(() => c.beginTurn('继续', 'b')).toThrow(/授权/)
    c.allowTarget('b'); expect(c.needsConsent('b')).toBe(false)
    expect(c.messages.value).toHaveLength(2)
  })
  it('keeps full visible text while bounding transmitted Unicode history', () => {
    const c = createAgentConversation(storage()); c.load()
    for (let i = 0; i < 30; i++) c.append(i % 2 ? 'assistant' : 'user', `${i}:` + '😀'.repeat(1000))
    const history = conversationHistory(c.messages.value)
    expect(history.length).toBeLessThanOrEqual(20)
    expect(history.reduce((n, m) => n + Array.from(m.text).length, 0)).toBeLessThanOrEqual(16000)
    expect(c.messages.value).toHaveLength(30)
  })
  it('refuses to silently discard records at the message limit', () => {
    const c = createAgentConversation(storage()); c.load()
    for (let i = 0; i < 500; i++) c.append('user', String(i))
    expect(() => c.append('user', '501')).toThrow(/上限/)
    expect(c.messages.value[0]?.text).toBe('0')
  })
  it.each(['确定', '确认。', '执行！', '确认执行'])('accepts exact local confirmation %s', text => expect(isExplicitConfirmation(text)).toBe(true))
  it.each(['不确定', '确认，另外改成明天', '确认后再说', '先别确认'])('does not execute compound/negative %s', text => expect(isExplicitConfirmation(text)).toBe(false))
  it('binds confirmation to full content even if timestamp is unchanged', () => {
    const draft = agentPlanDraftSchema.parse({ version: 1, id: crypto.randomUUID(), question: '改名', model: 'test', createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z', status: 'draft', actions: [{ actionId: 'a', type: 'renameQuarterGoal', reason: '区分', targetId: crypto.randomUUID(), expectedUpdatedAt: '2026-10-25T00:00:00.000Z', payload: { title: '旧建议' } }], validation: { executable: false, selectedCount: 0, dangerousCount: 0, estimatedMinutes: 0, issueCount: 0, issues: [] } })
    const revision = planContentRevision(draft)
    draft.actions[0]!.payload = { title: '新建议' }
    expect(planContentRevision(draft)).not.toBe(revision)
  })
})
