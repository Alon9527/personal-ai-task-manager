import { expect, test } from '@playwright/test'

test('FOCUS navigation, real editor and responsive layout', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.goto('/')
  await page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.config.globalProperties.$nuxt
    return app && !app.isHydrating
  })
  await expect(page.locator('.focus-logo')).toBeAttached()
  await expect(page.locator('.suite-metrics').first()).toBeVisible()
  if (test.info().project.name === 'desktop') {
    await page.getByRole('link', { name: '任务与日程', exact: true }).first().click()
    await expect(page.locator('.suite-week-scroll')).toBeVisible()
    await page.getByRole('link', { name: '设置', exact: true }).first().click()
    await page.locator('.suite-settings-nav').getByRole('link', { name: '数据与备份', exact: true }).click()
    await expect(page.getByRole('button', { name: '导出工作区备份', exact: true })).toBeVisible()
    await page.goto('/')
  }
  await page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.config.globalProperties.$nuxt
    return app && !app.isHydrating
  })
  await page.locator('.add-button').click()
  await expect(page.locator('.task-editor')).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: '任务状态' })).toBeVisible()
  expect(errors).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
  expect(overflow).toBe(false)
})
