import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ suggest: vi.fn(), create: vi.fn(), read: vi.fn() }))
mockNuxtImport('useWorkspace', () => () => ({ createQuarterGoal: mocks.create, readLatestDocument: mocks.read }))
vi.mock('../../app/services/quarter-import', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../app/services/quarter-import')>(), suggestQuarterGoals: mocks.suggest,
}))
import QuarterSummaryImport from '../../app/components/workspace/QuarterSummaryImport.vue'

describe('free-form annual summary review', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue({ quarterGoals: [] }); mocks.create.mockResolvedValue({}) })
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
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({ title: '完善流程', progress: 0, status: 'active' })
    expect(mocks.create.mock.calls[0]?.[0].description).not.toContain('原文依据：')
    wrapper.unmount()
  })
  it('requires a title and quarter before saving a selected manual draft', async () => {
    const wrapper = await mountSuspended(QuarterSummaryImport)
    await wrapper.get('[data-add-draft]').trigger('click')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('[data-confirm-goals]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('标题和季度')
    expect(mocks.create).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
