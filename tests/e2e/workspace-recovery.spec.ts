import { expect, test } from '@playwright/test'

test('corrupt workspace is preserved until a valid backup is previewed and confirmed', async ({ page }) => {
  const unhandled: string[] = []
  page.on('pageerror', error => unhandled.push(error.message))
  page.on('console', message => { if (message.text().includes('Unhandled rejection')) unhandled.push(message.text()) })
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('recovery-test-seeded')) {
      localStorage.setItem('personal-ai-workspace:v1', '{synthetic-broken-workspace')
      sessionStorage.setItem('recovery-test-seeded', '1')
    }
  })
  await page.goto('/')
  const dialog = page.getByRole('dialog', { name: '工作区需要恢复' })
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('personal-ai-workspace:v1'))).toBe('{synthetic-broken-workspace')
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '')
  const backup = { version: 3, projects: [], milestones: [], tasks: [], quarterGoals: [] }
  await dialog.locator('input[type=file]').setInputFiles({ name: 'valid-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await expect(dialog.locator('[data-recovery-preview]')).toContainText('0 项任务')
  await expect(dialog.getByRole('button', { name: '确认恢复备份' })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('personal-ai-workspace:v1'))).toBe('{synthetic-broken-workspace')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '确认恢复备份' }).click()
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!))).toEqual(backup)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('personal-ai-workspace:backup:')).some(k => localStorage.getItem(k) === '{synthetic-broken-workspace'))).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(unhandled).toEqual([])
})
