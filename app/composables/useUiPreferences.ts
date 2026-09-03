import { isTauri } from '@tauri-apps/api/core'
import { computed } from 'vue'

export const UI_SCALE_STORAGE_KEY = 'personal-ai-ui-scale:v4'
export const UI_SCALE_OPTIONS = [1, 1.05, 1.1] as const
export const DEFAULT_UI_SCALE: UiScale = 1
export type UiScale = typeof UI_SCALE_OPTIONS[number]

function isUiScale(value: unknown): value is UiScale {
  return typeof value === 'number' && UI_SCALE_OPTIONS.includes(value as UiScale)
}

export async function applyUiScale(value: UiScale) {
  if (!import.meta.client) return
  if (isTauri()) {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    await getCurrentWebview().setZoom(value)
    return
  }
  document.documentElement.dataset.uiScale = String(value)
}

export function useUiPreferences() {
  const scale = useState<UiScale>('ui-scale', () => DEFAULT_UI_SCALE)

  async function load() {
    if (!import.meta.client) return
    const stored = Number(localStorage.getItem(UI_SCALE_STORAGE_KEY))
    scale.value = isUiScale(stored) ? stored : DEFAULT_UI_SCALE
    await applyUiScale(scale.value)
  }

  async function setScale(value: UiScale) {
    if (!isUiScale(value)) return
    scale.value = value
    if (import.meta.client) localStorage.setItem(UI_SCALE_STORAGE_KEY, String(value))
    await applyUiScale(value)
  }

  return {
    scale: computed(() => scale.value),
    load,
    setScale,
  }
}
