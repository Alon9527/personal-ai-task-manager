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
    const detail = cause instanceof Error ? cause.message : String(cause)
    if (/endpoint|url|configuration|config/i.test(detail)) {
      throw new Error('当前安装包还未配置签名更新发布地址。')
    }
    throw new Error(`检查更新失败：${detail}`)
  }
}

export async function installDesktopUpdate(
  update: Update,
  onProgress: (progress: UpdateProgress) => void,
) {
  let downloaded = 0
  let total: number | null = null
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') total = event.data.contentLength ?? null
    if (event.event === 'Progress') downloaded += event.data.chunkLength
    onProgress({ downloaded, total })
  })
}
