import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUpdateNotice } from '../../app/services/update-notice'
import type { DesktopUpdateCheck } from '../../app/services/app-updater'

const current = { status: 'current', currentVersion: '0.3.21', message: '当前已是最新版本。' } satisfies DesktopUpdateCheck
function available() {
  return { status: 'available' as const, currentVersion: '0.3.21', version: '0.3.22', date: null, body: null,
    install: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) }
}
afterEach(() => vi.useRealTimers())

describe('shared update notice', () => {
  it('shows only a detected update, keeps it across failures and clears after a current result', async () => {
    const update = available()
    const check = vi.fn().mockResolvedValueOnce(update).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(current)
    const monitor = createUpdateNotice(check)
    expect(monitor.availableVersion.value).toBeNull()
    await monitor.check()
    expect(monitor.availableVersion.value).toBe('0.3.22')
    await expect(monitor.check()).rejects.toThrow('offline')
    expect(monitor.availableVersion.value).toBe('0.3.22')
    expect(update.dispose).not.toHaveBeenCalled()
    await monitor.check()
    expect(monitor.availableVersion.value).toBeNull()
    expect(update.dispose).toHaveBeenCalledOnce()
    expect(update.install).not.toHaveBeenCalled()
  })

  it('coalesces concurrent checks and shares the same usable update object', async () => {
    let resolve!: (value: DesktopUpdateCheck) => void
    const check = vi.fn(() => new Promise<DesktopUpdateCheck>(done => { resolve = done }))
    const monitor = createUpdateNotice(check)
    const first = monitor.check()
    const second = monitor.check()
    expect(check).toHaveBeenCalledOnce()
    expect(monitor.checking.value).toBe(true)
    const update = available()
    resolve(update)
    expect(await first).toBe(update)
    expect(await second).toBe(update)
    expect(monitor.result.value).toBe(update)
    expect(monitor.checking.value).toBe(false)
    expect(update.dispose).not.toHaveBeenCalled()
  })

  it('silently checks at startup and every six hours without downloading, stops and skips maintenance', async () => {
    vi.useFakeTimers()
    const update = available()
    const check = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(update)
    const monitor = createUpdateNotice(check)
    let maintenance = false
    monitor.start(() => !maintenance)
    monitor.start(() => !maintenance)
    await vi.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledOnce()
    expect(monitor.availableVersion.value).toBeNull()
    await vi.advanceTimersByTimeAsync(21_599_999)
    expect(check).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledTimes(2)
    expect(monitor.availableVersion.value).toBe('0.3.22')
    maintenance = true
    await vi.advanceTimersByTimeAsync(21_600_000)
    expect(check).toHaveBeenCalledTimes(2)
    monitor.stop()
    maintenance = false
    await vi.advanceTimersByTimeAsync(21_600_000)
    expect(check).toHaveBeenCalledTimes(2)
    expect(update.install).not.toHaveBeenCalled()
  })

  it('does not mask a successful refresh when releasing an old handle fails', async () => {
    const old = available()
    old.dispose.mockRejectedValue(new Error('already closed'))
    const monitor = createUpdateNotice(vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(current))
    await monitor.check()
    await expect(monitor.check()).resolves.toBe(current)
    expect(monitor.availableVersion.value).toBeNull()
  })
})
