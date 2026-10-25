import { describe, expect, it, vi } from 'vitest'
import { buildMiniMaxWorkspaceContext, askAi } from '../../app/services/minimax'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }))
describe('agent conversation request', () => {
  it('includes the version and selected goals beyond the previous 20 goal limit', () => {
    const doc = createDemoWorkspace()
    const goal = doc.quarterGoals[0]!
    doc.quarterGoals = Array.from({ length: 90 }, (_, i) => ({ ...goal, id: crypto.randomUUID(), sortOrder: i, quarter: '2026-Q4', deletedAt: null }))
    const selected = doc.quarterGoals[89]!
    const context = buildMiniMaxWorkspaceContext(doc, undefined, { goalIds: [selected.id] })
    expect(context.quarterGoals.some(g => g.id === selected.id && g.updatedAt === selected.updatedAt)).toBe(true)
    expect(context.quarterGoals).toHaveLength(80)
    expect(() => buildMiniMaxWorkspaceContext(doc, undefined, { goalIds: doc.quarterGoals.map(g => g.id) })).toThrow()
  })
  it('sends separate bounded historical messages and never truncates them into the current question', async () => {
    bridge.invoke.mockResolvedValue({ answer: '请确认', actions: [], sources: [], model: 'test', generatedAt: '2026-10-25T00:00:00.000Z', usage: null })
    const history = [{ role: 'user' as const, text: '第一季度改为建立流程' }, { role: 'assistant' as const, text: '第四季度建议成果交付' }]
    await askAi(buildMiniMaxWorkspaceContext(createDemoWorkspace()), '第四季度再突出验收', { kind: 'minimax', modelId: 'MiniMax-M3' }, [], { history })
    expect(bridge.invoke.mock.calls[0]![1].request).toMatchObject({ question: '第四季度再突出验收', history })
  })
  it('carries a connection guard into the native request before any model traffic', async () => {
    bridge.invoke.mockClear()
    await askAi(buildMiniMaxWorkspaceContext(createDemoWorkspace()), '继续', { kind: 'minimax', modelId: 'MiniMax-M3' }, [], { history: [], connectionGuard: { kind: 'minimax', revision: 'consented-revision', region: 'cn' } } as any)
    expect(bridge.invoke.mock.calls[0]![1].request.connectionGuard).toEqual({kind:'minimax',revision:'consented-revision',region:'cn'})
  })
})
