import { expect, test } from '@playwright/test'

test('reference redesign keeps navigation, editor and overview usable', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.config.globalProperties.$nuxt
    return app && !app.isHydrating
  })
  await expect(page.locator('.focus-overview')).toBeVisible()
  await page.locator('.add-button').click()
  await expect(page.getByRole('radiogroup', { name: '任务状态' })).toBeVisible()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  if (testInfo.project.name === 'desktop') {
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await expect(page.locator('.add-button')).toBeVisible()
    }
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.screenshot({ path: 'artifacts/reference-today-1600.png' })
    await page.screenshot({ path: 'artifacts/reference-today-full.png', fullPage: true })
    await page.getByRole('link', { name: '任务与日程', exact: true }).first().click()
    await expect(page.locator('.suite-week-scroll')).toBeVisible()
    await page.screenshot({ path: 'artifacts/reference-agenda-1600.png' })
    await page.locator('.sidebar-nav').getByRole('link', { name: /收集箱/ }).click()
    await expect(page.locator('[data-select-all]')).toBeVisible()
    await page.screenshot({ path: 'artifacts/reference-inbox-1600.png' })
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
