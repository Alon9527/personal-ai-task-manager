import { beforeEach, describe, expect, it, vi } from 'vitest'

const isTauri = vi.fn()
const getVersion = vi.fn()
const check = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ isTauri }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check }))

describe('desktop updater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauri.mockReturnValue(true)
    getVersion.mockResolvedValue('0.1.0')
    vi.stubEnv('VITE_DESKTOP_UPDATES_ENABLED', '0')
  })

  it('reports an available signed update without relying on a build-time feature flag', async () => {
    const update = { version: '0.2.0', date: '2026-08-05', body: 'Agent update' }
    check.mockResolvedValue(update)
    const { checkDesktopUpdate } = await import('../../app/services/app-updater')

    const result = await checkDesktopUpdate()

    expect(result).toMatchObject({ status: 'available', currentVersion: '0.1.0', version: '0.2.0' })
    expect(result.status === 'available' && result.install).toBeTypeOf('function')
  })

  it('does not contact an update endpoint in browser preview', async () => {
    isTauri.mockReturnValue(false)
    const { checkDesktopUpdate } = await import('../../app/services/app-updater')

    await expect(checkDesktopUpdate()).resolves.toMatchObject({ status: 'unavailable' })
    expect(check).not.toHaveBeenCalled()
  })

  it('downloads and installs through the signed updater while reporting progress', async () => {
    const downloadAndInstall = vi.fn(async (notify) => {
      notify({ event: 'Started', data: { contentLength: 100 } })
      notify({ event: 'Progress', data: { chunkLength: 40 } })
      notify({ event: 'Progress', data: { chunkLength: 60 } })
      notify({ event: 'Finished' })
    })
    check.mockResolvedValue({ version: '0.3.6', downloadAndInstall })
    const { checkDesktopUpdate } = await import('../../app/services/app-updater')
    const result = await checkDesktopUpdate()
    if (result.status !== 'available') throw new Error('Expected available update')
    const progress = vi.fn()
    await result.install(progress)
    expect(downloadAndInstall).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenLastCalledWith({ downloaded: 100, total: 100 })
  })

  it('surfaces installation and signature errors without a fallback installer', async () => {
    check.mockResolvedValue({ version: '0.3.6', downloadAndInstall: vi.fn().mockRejectedValue(new Error('signature verification failed')) })
    const { checkDesktopUpdate } = await import('../../app/services/app-updater')
    const result = await checkDesktopUpdate()
    if (result.status !== 'available') throw new Error('Expected available update')
    await expect(result.install(vi.fn())).rejects.toThrow('signature verification failed')
  })
})
