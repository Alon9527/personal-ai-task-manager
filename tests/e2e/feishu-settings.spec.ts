import { expect, test } from '@playwright/test'

test('Feishu preview clearly disables native credentials and smaller display options remain available', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/settings?tab=feishu')
  const panel = page.getByRole('region', { name: '飞书 API 接入' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('alert')).toContainText('Windows 桌面')
  await expect(panel.getByRole('button', { name: '保存安全配置' })).toBeDisabled()
  await expect(panel.getByRole('button', { name: '测试连接并获取数据表' })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: `artifacts/feishu-api-${info.project.name}.png`, fullPage: true })
  await page.goto('/settings?tab=appearance')
  await page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.config.globalProperties.$nuxt
    return app && !app.isHydrating
  })
  await page.getByRole('button', { name: '90%', exact: true }).click()
  await expect(page.getByRole('button', { name: '90%', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByRole('button', { name: '90%', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '95%', exact: true }).click()
  await expect(page.getByRole('button', { name: '95%', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})
