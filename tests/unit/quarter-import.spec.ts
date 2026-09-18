import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }))
vi.mock('@tauri-apps/api/core', () => mocks)
import { suggestQuarterGoals } from '../../app/services/quarter-import'
const target = { kind: 'minimax', modelId: 'MiniMax-M3' } as const
describe('quarter suggestions require source evidence', () => {
  it('accepts sourced goals only for the requested year', async () => {
    const goal = { quarter: '2026-Q2', title: '视频标准化', description: '季度分配为建议', evidence: '今年目标是视频标准化' }
    mocks.invoke.mockResolvedValue({ goals: [goal] })
    expect((await suggestQuarterGoals('去年完成建模。今年目标是视频标准化。', 2026, target)).goals).toEqual([goal])
    mocks.invoke.mockResolvedValue({ goals: [{ ...goal, quarter: '2025-Q2' }] })
    await expect(suggestQuarterGoals('今年目标是视频标准化', 2026, target)).rejects.toThrow('年份')
    mocks.invoke.mockResolvedValue({ goals: [{ ...goal, evidence: '杜撰目标' }] })
    await expect(suggestQuarterGoals('今年目标是视频标准化', 2026, target)).rejects.toThrow('原文')
  })
  it('keeps natural-language analysis without requiring any document template', async () => {
    mocks.invoke.mockResolvedValue({ goals: [], analysis: '建议先完善流程，再逐季复盘。', notice: '可手动整理目标' })
    const result = await suggestQuarterGoals('去年做了不少工作。明年想逐步完善流程，没有写季度或表头。', 2026, target)
    expect(result.analysis).toContain('逐季复盘')
    expect(result.goals).toEqual([])
  })
  it('allows suggested goals without an exact quote or a preassigned quarter', async () => {
    mocks.invoke.mockResolvedValue({ goals: [{ quarter: '', title: '完善流程', description: '请确认安排', evidence: '' }], analysis: '根据总结提出的建议', notice: '' })
    expect((await suggestQuarterGoals('希望把工作做得更有条理。', 2026, target)).goals[0]?.quarter).toBe('')
  })
})
