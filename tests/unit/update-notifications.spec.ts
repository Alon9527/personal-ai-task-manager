import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUpdateNotifications } from '../../app/composables/useUpdateNotifications'
import { desktopUpdateNotice } from '../../app/services/update-notice'

const mocks = vi.hoisted(() => ({ desktop: vi.fn(), check: vi.fn(), workspace: null as any }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: mocks.desktop }))
vi.mock('../../app/services/app-updater', () => ({ checkDesktopUpdate: mocks.check }))
mockNuxtImport('useWorkspace', () => () => mocks.workspace)
const Harness = defineComponent({ setup() { useUpdateNotifications() }, template: '<div />' })
beforeEach(() => {
  desktopUpdateNotice.stop()
  vi.clearAllMocks()
  mocks.desktop.mockReturnValue(true)
  mocks.workspace = { updateLocked: ref(false) }
  mocks.check.mockResolvedValue({ status: 'current', currentVersion: '0.3.21', message: 'current' })
})
afterEach(() => { desktopUpdateNotice.stop(); vi.useRealTimers() })

it('never starts update network checks in a browser preview', async () => {
  mocks.desktop.mockReturnValue(false)
  const wrapper = await mountSuspended(Harness)
  await flushPromises()
  expect(mocks.check).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('checks on desktop mount, pauses during maintenance, and cleans up on unmount', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const wrapper = await mountSuspended(Harness)
  await flushPromises()
  expect(mocks.check).toHaveBeenCalledOnce()
  mocks.workspace.updateLocked.value = true
  await vi.advanceTimersByTimeAsync(21_600_000)
  expect(mocks.check).toHaveBeenCalledOnce()
  mocks.workspace.updateLocked.value = false
  await vi.advanceTimersByTimeAsync(21_600_000)
  expect(mocks.check).toHaveBeenCalledTimes(2)
  wrapper.unmount()
  await vi.advanceTimersByTimeAsync(21_600_000)
  expect(mocks.check).toHaveBeenCalledTimes(2)
})
