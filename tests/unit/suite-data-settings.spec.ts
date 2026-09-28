import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
const mocks = vi.hoisted(() => ({ state: null as any, restore: vi.fn() }))
mockNuxtImport('useWorkspace', () => () => mocks.state)
import SuiteDataSettings from '../../app/components/suite/SuiteDataSettings.vue'

describe('portable workspace import from settings', () => {
  beforeEach(() => {
    mocks.restore.mockReset().mockResolvedValue(undefined)
    mocks.state = { backendMode: ref('sqlite'), importWorkspaceBackup: mocks.restore }
  })
  it('previews a backup and does not replace healthy data until explicitly confirmed', async () => {
    const wrapper = await mountSuspended(SuiteDataSettings, { props: { section: 'data' }, global: { stubs: { WorkspaceInfoDialog: true } } })
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [{ name: 'from-old-pc.json', size: 100, text: async () => JSON.stringify(createDemoWorkspace()) }] })
    await input.trigger('change'); await flushPromises()
    expect(wrapper.text()).toContain('7 项任务')
    expect(wrapper.get('[data-confirm-import]').attributes('disabled')).toBeDefined()
    expect(mocks.restore).not.toHaveBeenCalled()
    await wrapper.get('input[type=checkbox]').setValue(true)
    await wrapper.get('[data-confirm-import]').trigger('click'); await flushPromises()
    expect(mocks.restore).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('导入完成')
    wrapper.unmount()
  })
  it('rejects a reference-only backup and keeps existing data untouched', async () => {
    const doc = createDemoWorkspace()
    const id = '40000000-0000-4000-8000-000000000001'
    doc.tasks[0]!.attachments = [{ id, name: 'x.png', mimeType: 'image/png', size: 3, dataUrl: `attachment:${id}` }]
    const wrapper = await mountSuspended(SuiteDataSettings, { props: { section: 'data' }, global: { stubs: { WorkspaceInfoDialog: true } } })
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [{ name: 'refs.json', size: 100, text: async () => JSON.stringify(doc) }] })
    await input.trigger('change'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('完整')
    expect(mocks.restore).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
