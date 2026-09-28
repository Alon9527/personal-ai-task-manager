import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { DesktopWorkspaceGateway } from '../../app/data/desktop-workspace-gateway'
import { createWorkspaceModel } from '../../app/models/workspace-model'

const mocks = vi.hoisted(() => ({ suggest: vi.fn(), create: vi.fn(), read: vi.fn(), batch: vi.fn(), workspace: null as any }))
mockNuxtImport('useWorkspace', () => () => mocks.workspace ?? ({ createQuarterGoal: mocks.create, readLatestDocument: mocks.read, createQuarterGoals: mocks.batch }))
vi.mock('../../app/services/quarter-import', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../app/services/quarter-import')>(), suggestQuarterGoals: mocks.suggest,
}))
import QuarterSummaryImport from '../../app/components/workspace/QuarterSummaryImport.vue'

describe('free-form annual summary review', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.workspace = null; mocks.read.mockResolvedValue({ quarterGoals: [] }); mocks.create.mockResolvedValue({}); mocks.batch.mockResolvedValue({ addedCount: 1, skippedCount: 0 }) })

  async function selectedDraft() {
    const wrapper = await mountSuspended(QuarterSummaryImport)
    await wrapper.get('[data-add-draft]').trigger('click')
    await wrapper.get('[aria-label="目标标题"]').setValue('保留我的编辑')
    await wrapper.get('[aria-label="目标季度"]').setValue(`${new Date().getFullYear()}-Q1`)
    await wrapper.get('[aria-label="衡量与行动建议"]').setValue('用户修改的衡量方法')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    return wrapper
  }

  it('retains edits and selection after failure, then reports created and skipped counts separately on retry', async () => {
    mocks.batch.mockRejectedValueOnce(new Error('写入失败')).mockResolvedValueOnce({ addedCount: 0, skippedCount: 1 })
    const wrapper = await selectedDraft()
    await wrapper.get('[data-confirm-goals]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('勾选已保留')
    expect((wrapper.get('[aria-label="目标标题"]').element as HTMLInputElement).value).toBe('保留我的编辑')
    expect((wrapper.get('[aria-label="衡量与行动建议"]').element as HTMLTextAreaElement).value).toBe('用户修改的衡量方法')
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    await wrapper.get('[data-confirm-goals]').trigger('click'); await flushPromises()
    expect(mocks.batch).toHaveBeenCalledTimes(2)
    expect(mocks.batch.mock.calls[1]).toEqual(mocks.batch.mock.calls[0])
    expect(wrapper.get('[role="status"]').text()).toContain('已添加 0 项季度目标，跳过 1 项')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="目标标题"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('blocks duplicate confirmation and lets an already-confirmed batch finish after unmount', async () => {
    let resolve!: (value: { addedCount: number, skippedCount: number }) => void
    mocks.batch.mockImplementation(() => new Promise(done => { resolve = done }))
    const wrapper = await selectedDraft()
    await wrapper.get('[data-confirm-goals]').trigger('click')
    await wrapper.get('[data-confirm-goals]').trigger('click')
    expect(mocks.batch).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-confirm-goals]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="目标标题"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
    resolve({ addedCount: 1, skippedCount: 0 }); await flushPromises()
    expect(mocks.batch).toHaveBeenCalledTimes(1)
  })

  it('keeps the entire persisted document unchanged if the confirmed batch cannot commit', async () => {
    const original = JSON.stringify(createDemoWorkspace())
    let stored = original
    let writes = 0
    const gateway = new DesktopWorkspaceGateway(localStorage, {
      loadDocument: async () => stored,
      saveDocument: async next => { if (++writes === 2) throw new Error('disk failure'); stored = next; return next },
      applyPlan: async () => { throw new Error('disk failure') },
    })
    const workspace = createWorkspaceModel(gateway)
    await workspace.load()
    writes = 0
    const before = stored
    mocks.workspace = workspace
    const wrapper = await mountSuspended(QuarterSummaryImport)
    for (const [index, title] of ['一季度目标', '二季度目标'].entries()) {
      await wrapper.get('[data-add-draft]').trigger('click')
      const card = wrapper.findAll('article')[index]!
      await card.get('[aria-label="目标标题"]').setValue(title)
      await card.get('[aria-label="目标季度"]').setValue(`${new Date().getFullYear()}-Q${index + 1}`)
      await card.get('input[type="checkbox"]').setValue(true)
    }
    await wrapper.get('[data-confirm-goals]').trigger('click'); await flushPromises()
    expect(stored).toBe(before)
    expect(wrapper.findAll('article input[type="checkbox"]').every(box => (box.element as HTMLInputElement).checked)).toBe(true)
    expect(wrapper.text()).not.toContain('此前已成功添加')
    wrapper.unmount()
  })
  it('retains readable analysis after automatic card conversion fails and permits manual confirmation', async () => {
    mocks.suggest.mockResolvedValue({ analysis: '建议逐季度改进工作流程。', goals: [], notice: '分析已保留，可手动整理目标。' })
    const wrapper = await mountSuspended(QuarterSummaryImport)
    await wrapper.get('[data-summary-text]').setValue('普通叙述，不含固定表头。')
    await wrapper.get('[data-generate-goals]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-ai-analysis]').text()).toContain('逐季度改进')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(mocks.create).not.toHaveBeenCalled()
    await wrapper.get('[data-add-draft]').trigger('click')
    await wrapper.get('[aria-label="目标标题"]').setValue('完善流程')
    await wrapper.get('[aria-label="目标季度"]').setValue(`${new Date().getFullYear()}-Q2`)
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(mocks.create).not.toHaveBeenCalled()
    await wrapper.get('[data-confirm-goals]').trigger('click'); await flushPromises()
    expect(mocks.batch).toHaveBeenCalledTimes(1)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.batch.mock.calls[0]?.[0][0]).toMatchObject({ title: '完善流程', progress: 0, status: 'active' })
    expect(mocks.batch.mock.calls[0]?.[0][0].description).not.toContain('原文依据：')
    wrapper.unmount()
  })
  it('requires a title and quarter before saving a selected manual draft', async () => {
    const wrapper = await mountSuspended(QuarterSummaryImport)
    await wrapper.get('[data-add-draft]').trigger('click')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('[data-confirm-goals]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('标题和季度')
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.batch).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
