import { onBeforeUnmount, onMounted } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { desktopUpdateNotice } from '../services/update-notice'

export function useUpdateNotifications() {
  const workspace = useWorkspace()
  onMounted(() => {
    if (isTauri()) desktopUpdateNotice.start(() => !workspace.updateLocked.value)
  })
  onBeforeUnmount(() => desktopUpdateNotice.stop())
}
