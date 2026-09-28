import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'

const mocks = vi.hoisted(() => ({ state: null as any, restore: vi.fn(), load: vi.fn() }))
mockNuxtImport('useWorkspace', () => () => mocks.state)
import WorkspaceRecoveryPanel from '../../app/components/workspace/WorkspaceRecoveryPanel.vue'

describe('explicit workspace recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state = { recoveryRequired: ref(true), recoverWorkspaceDocument: mocks.restore, load: mocks.load }
  })

  it('previews a valid backup and requires an explicit acknowledgement before restoring', async () => {
    const wrapper = await mountSuspended(WorkspaceRecoveryPanel)
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [{ name: 'backup.json', size: 100, text: async () => JSON.stringify(createDemoWorkspace()) }] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.get('[data-recovery-preview]').text()).toContain('7 项任务')
    expect(wrapper.get('[data-confirm-recovery]').attributes('disabled')).toBeDefined()
    expect(mocks.restore).not.toHaveBeenCalled()
    await wrapper.get('input[type=checkbox]').setValue(true)
    await wrapper.get('[data-confirm-recovery]').trigger('click')
    await flushPromises()
    expect(mocks.restore).toHaveBeenCalledOnce()
    expect(mocks.restore.mock.calls[0]![0].tasks).toHaveLength(7)
    wrapper.unmount()
  })

  it('does not offer to restore malformed backup content', async () => {
    const wrapper = await mountSuspended(WorkspaceRecoveryPanel)
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [{ name: 'broken.json', size: 5, text: async () => '{broken' }] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('原始数据未改变')
    expect(wrapper.find('[data-recovery-preview]').exists()).toBe(false)
    expect(mocks.restore).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
