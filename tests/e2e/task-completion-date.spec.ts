import { expect, test } from '@playwright/test'

test('completion date accepts compact input, persists on reload, and can be cleared', async ({ page }) => {
  const ready = async () => page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.config.globalProperties.$nuxt
    return app && !app.isHydrating
  })
  await page.goto('/calendar')
  await ready()
  await page.getByRole('button', { name: '新建任务', exact: true }).first().click()
  const editor = page.locator('.suite-inline-editor')
  await editor.locator('[name="title"]').fill('完成日期功能验收')
  await editor.getByLabel('完成日期', { exact: true }).fill('260918')
  await editor.getByRole('button', { name: '创建任务', exact: true }).click()
  const event = page.locator('.suite-calendar-event').filter({ hasText: '完成日期功能验收' })
  await expect(event).toHaveCount(1)
  await page.reload()
  await ready()
  await event.click()
  await expect(editor.getByLabel('完成日期', { exact: true })).toHaveValue('2026-09-18')
  await expect(editor.locator('input[name="status-choice"][value="todo"]')).toBeChecked()
  await editor.getByLabel('完成日期', { exact: true }).fill('260231')
  await editor.getByRole('button', { name: '保存更改', exact: true }).click()
  await expect(editor).toContainText('完成日期无效')
  await editor.getByLabel('完成日期', { exact: true }).fill('')
  await editor.getByRole('button', { name: '保存更改', exact: true }).click()
  await page.reload()
  await ready()
  await event.click()
  await expect(editor.getByLabel('完成日期', { exact: true })).toHaveValue('')
})
