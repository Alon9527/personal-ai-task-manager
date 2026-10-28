import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { dateKey } from '../utils/calendar-view'

const REFRESH_MS = 30_000

/** Local calendar time, refreshed at midnight and when the app resumes. */
export function useLocalClock() {
  const now = ref(new Date())
  const today = computed(() => dateKey(now.value))
  let timer: ReturnType<typeof setTimeout> | undefined
  let mounted = false

  function refresh() {
    now.value = new Date()
    if (!mounted) return
    if (timer !== undefined) clearTimeout(timer)
    const midnight = new Date(now.value)
    midnight.setHours(24, 0, 0, 0)
    timer = setTimeout(refresh, Math.min(REFRESH_MS, midnight.getTime() - now.value.getTime()))
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') refresh()
  }

  onMounted(() => {
    mounted = true
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onBeforeUnmount(() => {
    mounted = false
    if (timer !== undefined) clearTimeout(timer)
    window.removeEventListener('focus', refresh)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { now, today, refresh }
}
