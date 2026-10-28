import { computed, readonly, ref, shallowReadonly, shallowRef } from 'vue'
import { checkDesktopUpdate } from './app-updater'
import type { DesktopUpdateCheck } from './app-updater'

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// Native updater resources and install functions stay in memory, never in a Nuxt payload or database.
export function createUpdateNotice(checkUpdate: () => Promise<DesktopUpdateCheck> = checkDesktopUpdate) {
  const result = shallowRef<DesktopUpdateCheck | null>(null)
  const checking = ref(false)
  const availableVersion = computed(() => result.value?.status === 'available' ? result.value.version : null)
  let pending: Promise<DesktopUpdateCheck> | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  function check(): Promise<DesktopUpdateCheck> {
    if (pending) return pending
    checking.value = true
    pending = (async () => {
      try {
        const next = await checkUpdate()
        const previous = result.value
        result.value = next
        if (previous?.status === 'available' && previous !== next) {
          try { await previous.dispose?.() }
          catch { /* Cleanup failure must not hide the new verified result. */ }
        }
        return next
      }
      finally { checking.value = false; pending = null }
    })()
    return pending
  }

  function start(canCheck: () => boolean = () => true) {
    if (timer !== null) return
    const tick = () => {
      if (canCheck()) void check().catch(() => { /* Background checks stay quiet; retain known availability. */ })
    }
    timer = setInterval(tick, UPDATE_CHECK_INTERVAL_MS)
    tick()
  }

  function stop() {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  return { result: shallowReadonly(result), checking: readonly(checking), availableVersion, check, start, stop }
}

export const desktopUpdateNotice = createUpdateNotice()
