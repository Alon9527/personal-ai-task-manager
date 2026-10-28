import { isTauri } from '@tauri-apps/api/core'
import type { Update } from '@tauri-apps/plugin-updater'

export type DesktopUpdateCheck =
  | { status: 'unavailable', currentVersion: string, message: string }
  | { status: 'current', currentVersion: string, message: string }
  | { status: 'available', currentVersion: string, version: string, date: string | null, body: string | null, install: (onProgress: (progress: UpdateProgress) => void) => Promise<void> }

export interface UpdateProgress {
  downloaded: number
  total: number | null
}

export type DesktopUpdateErrorCode = 'network' | 'configuration' | 'signature' | 'installation' | 'check'

export class DesktopUpdateError extends Error {
  constructor(public readonly code: DesktopUpdateErrorCode, message: string) {
    super(message)
    this.name = 'DesktopUpdateError'
  }
}

function updateError(cause: unknown, phase: 'check' | 'installation') {
  // Classification does not need the address, query, credentials, or key contents.
  // Only fixed safe messages leave this boundary; native diagnostics may contain secrets.
  const detail = (cause instanceof Error ? cause.message : String(cause)).replace(/https?:\/\/\S+/gi, '[address]')
  if (/configuration|\bconfig\b|missing field|deserializ|invalid json|(?:missing|invalid|malformed)\s+(?:updater?\s+)?(?:manifest|endpoint|url|public\s*key|pubkey)/i.test(detail)) {
    return new DesktopUpdateError('configuration', '更新清单或配置无效，请联系发布者检查更新地址、版本清单和签名配置。')
  }
  if (/signature|\bsign(?:ing|ed)?\b|public\s*key|pubkey|verification/i.test(detail)) {
    return new DesktopUpdateError('signature', '更新包签名验证失败，已停止安装。请等待发布者提供有效的签名更新。')
  }
  if (/network|timed?\s*out|timeout|dns|connection|connect error|request error|error sending request|failed to fetch|download.{0,30}fail|status code\D{0,5}[45]\d\d\b|http.{0,15}[45]\d\d/i.test(detail)) {
    return new DesktopUpdateError('network', '更新网络请求失败，请检查网络连接后重试。')
  }
  return phase === 'installation'
    ? new DesktopUpdateError('installation', '更新安装失败，请检查系统提示后重试。')
    : new DesktopUpdateError('check', '检查更新失败，请稍后重试；如持续失败，请联系发布者。')
}

export async function currentAppVersion() {
  if (!isTauri()) return '0.1.4-dev'
  const { getVersion } = await import('@tauri-apps/api/app')
  return getVersion()
}

export async function checkDesktopUpdate(): Promise<DesktopUpdateCheck> {
  const currentVersion = await currentAppVersion()
  if (!isTauri()) {
    return { status: 'unavailable', currentVersion, message: '请在 Windows 桌面版中检查更新。' }
  }
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return { status: 'current', currentVersion, message: '当前已是最新版本。' }
    return {
      status: 'available',
      currentVersion,
      version: update.version,
      date: update.date ?? null,
      body: update.body ?? null,
      install: onProgress => installDesktopUpdate(update, onProgress),
    }
  }
  catch (cause) {
    throw updateError(cause, 'check')
  }
}

export async function installDesktopUpdate(
  update: Update,
  onProgress: (progress: UpdateProgress) => void,
) {
  let downloaded = 0
  let total: number | null = null
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? null
      if (event.event === 'Progress') downloaded += event.data.chunkLength
      onProgress({ downloaded, total })
    })
  }
  catch (cause) {
    throw updateError(cause, 'installation')
  }
}
