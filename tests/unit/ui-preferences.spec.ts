import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent } from 'vue'

const isTauri = vi.fn()
const setZoom = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ isTauri }))
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom }),
}))

describe('readable defaults', () => {
  it('uses the enlarged CSS type scale with safe native zoom options', async () => {
    const { DEFAULT_UI_SCALE, UI_SCALE_OPTIONS } = await import('../../app/composables/useUiPreferences')
    expect(DEFAULT_UI_SCALE).toBe(1)
    expect(UI_SCALE_OPTIONS).toEqual([0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1])
  })
})
describe('UI scaling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete document.documentElement.dataset.uiScale
  })

  it('uses native WebView zoom in the desktop application', async () => {
    isTauri.mockReturnValue(true)
    const { applyUiScale } = await import('../../app/composables/useUiPreferences')

    await applyUiScale(1.1)

    expect(setZoom).toHaveBeenCalledWith(1.1)
    expect(document.body.style.getPropertyValue('zoom')).toBe('')
  })

  it.each([0.9, 0.95] as const)('supports smaller desktop scale %s', async (scale) => {
    isTauri.mockReturnValue(true)
    const { applyUiScale } = await import('../../app/composables/useUiPreferences')
    await applyUiScale(scale)
    expect(setZoom).toHaveBeenCalledWith(scale)
  })

  it('does not apply unsafe global zoom in browser preview', async () => {
    isTauri.mockReturnValue(false)
    const { applyUiScale } = await import('../../app/composables/useUiPreferences')

    await applyUiScale(1.05)

    expect(setZoom).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.uiScale).toBe('1.05')
  })

  it.each([0.9, 0.95] as const)('saves and restores smaller preference %s', async (value) => {
    isTauri.mockReturnValue(true)
    const { useUiPreferences, UI_SCALE_STORAGE_KEY } = await import('../../app/composables/useUiPreferences')
    let preferences!: ReturnType<typeof useUiPreferences>
    const wrapper = await mountSuspended(defineComponent({
      setup() { preferences = useUiPreferences(); return () => null },
    }))
    await preferences.setScale(value)
    expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBe(String(value))
    await preferences.setScale(1)
    localStorage.setItem(UI_SCALE_STORAGE_KEY, String(value))
    await preferences.load()
    expect(preferences.scale.value).toBe(value)
    expect(setZoom).toHaveBeenLastCalledWith(value)
    await preferences.setScale(1)
    wrapper.unmount()
  })
})
