import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSidebar from '../../app/components/app/ProjectSidebar.vue'
import WorkspaceInfoDialog from '../../app/components/workspace/WorkspaceInfoDialog.vue'
import { desktopUpdateNotice } from '../../app/services/update-notice'
import { createDemoWorkspace } from '../../app/data/demo-workspace'

const mocks = vi.hoisted(() => ({ check: vi.fn(), install: vi.fn() }))
vi.mock('../../app/services/app-updater', () => ({ currentAppVersion: async () => '0.3.21', checkDesktopUpdate: mocks.check }))
const current = { status: 'current', currentVersion: '0.3.21', message: '当前已是最新版本。' }
const Harness = defineComponent({ components: { ProjectSidebar, WorkspaceInfoDialog }, template: '<ProjectSidebar /><WorkspaceInfoDialog embedded section="updates" />' })

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(createDemoWorkspace()))
  desktopUpdateNotice.stop()
  mocks.check.mockResolvedValue(current)
  await desktopUpdateNotice.check()
  vi.clearAllMocks()
  mocks.check.mockResolvedValue({ status: 'available', currentVersion: '0.3.21', version: '0.3.22', date: null, body: null, install: mocks.install })
})

describe('update notice navigation', () => {
  it('shows a labeled red dot only for a detected update and routes to the updater', async () => {
    const wrapper = await mountSuspended(ProjectSidebar)
    try {
      expect(wrapper.find('[data-update-dot]').exists()).toBe(false)
      expect(wrapper.get('.suite-settings-entry').attributes('href')).toBe('/settings')
      await desktopUpdateNotice.check()
      await flushPromises()
      expect(wrapper.get('[data-update-dot]').attributes('aria-label')).toContain('0.3.22')
      expect(wrapper.get('.suite-settings-entry').attributes('href')).toBe('/settings?tab=updates')
      mocks.check.mockResolvedValue(current)
      await desktopUpdateNotice.check()
      await flushPromises()
      expect(wrapper.find('[data-update-dot]').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })

  it('shares manual check results with the sidebar without installing or dismissing on view', async () => {
    const wrapper = await mountSuspended(Harness, { global: { stubs: { Teleport: true } } })
    try {
      await wrapper.get('[data-update-card] .update-button').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-update-dot]').attributes('aria-label')).toContain('0.3.22')
      expect(wrapper.get('[data-update-card]').text()).toContain('发现新版本 0.3.22')
      expect(mocks.install).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
    expect(desktopUpdateNotice.availableVersion.value).toBe('0.3.22')
  })

  it('prevents installing an old native handle while another check is replacing it', async () => {
    await desktopUpdateNotice.check()
    const wrapper = await mountSuspended(Harness, { global: { stubs: { Teleport: true } } })
    let resolve!: (value: typeof current) => void
    mocks.check.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const refreshing = desktopUpdateNotice.check()
    try {
      await flushPromises()
      expect(wrapper.get('[data-update-card] .update-button.primary').attributes('disabled')).toBeDefined()
      await wrapper.get('[data-update-card] .update-button.primary').trigger('click')
      expect(mocks.install).not.toHaveBeenCalled()
    } finally {
      resolve(current)
      await refreshing
      wrapper.unmount()
    }
  })
})
