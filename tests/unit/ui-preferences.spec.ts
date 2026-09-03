import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    expect(UI_SCALE_OPTIONS).toEqual([1, 1.05, 1.1])
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

  it('does not apply unsafe global zoom in browser preview', async () => {
    isTauri.mockReturnValue(false)
    const { applyUiScale } = await import('../../app/composables/useUiPreferences')

    await applyUiScale(1.05)

    expect(setZoom).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.uiScale).toBe('1.05')
  })
})
