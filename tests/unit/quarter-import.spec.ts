import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }))
vi.mock('@tauri-apps/api/core', () => mocks)
import { suggestQuarterGoals } from '../../app/services/quarter-import'
const target = { kind: 'minimax', modelId: 'MiniMax-M3' } as const
describe('quarter suggestions require source evidence', () => {
  it('accepts sourced goals only for the requested year', async () => {
    const goal = { quarter: '2026-Q2', title: '视频标准化', description: '季度分配为建议', evidence: '今年目标是视频标准化' }
    mocks.invoke.mockResolvedValue({ goals: [goal] })
    expect(await suggestQuarterGoals('去年完成建模。今年目标是视频标准化。', 2026, target)).toEqual([goal])
    mocks.invoke.mockResolvedValue({ goals: [{ ...goal, quarter: '2025-Q2' }] })
    await expect(suggestQuarterGoals('今年目标是视频标准化', 2026, target)).rejects.toThrow('年份')
    mocks.invoke.mockResolvedValue({ goals: [{ ...goal, evidence: '杜撰目标' }] })
    await expect(suggestQuarterGoals('今年目标是视频标准化', 2026, target)).rejects.toThrow('原文')
  })
})
