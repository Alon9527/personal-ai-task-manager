import { isTauri } from '@tauri-apps/api/core'
import { ApiWorkspaceGateway } from '../data/api-workspace-gateway'
import { DesktopWorkspaceGateway } from '../data/desktop-workspace-gateway'
import { LocalWorkspaceGateway } from '../data/local-workspace-gateway'
import { createWorkspaceModel } from '../models/workspace-model'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const resolvedBackend = useState<'local' | 'supabase'>('resolved-data-backend', () => {
    if (import.meta.server) {
      const privateConfigReady = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey)
      return config.public.dataBackend === 'supabase' && privateConfigReady ? 'supabase' : 'local'
    }
    return 'local'
  })
  const fallbackReason = useState<string | null>('data-backend-fallback-reason', () => {
    if (
      import.meta.server
      && config.public.dataBackend === 'supabase'
      && (!config.supabaseUrl || !config.supabaseServiceRoleKey)
    ) {
      return 'Supabase 配置不完整，已使用本机数据'
    }
    return null
  })
  const desktop = import.meta.client && isTauri()
  const gateway = import.meta.client
    ? resolvedBackend.value === 'supabase'
      ? new ApiWorkspaceGateway()
      : desktop
        ? new DesktopWorkspaceGateway(window.localStorage)
        : new LocalWorkspaceGateway(window.localStorage)
    : null
  const workspace = createWorkspaceModel(gateway)
  if (gateway) workspace.setGateway(gateway, fallbackReason.value)

  return {
    provide: { workspace },
  }
})
