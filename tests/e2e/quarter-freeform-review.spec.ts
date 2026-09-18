import { expect, test } from '@playwright/test'

test('ordinary summary can be organized manually without an AI format requirement', async ({ page }) => {
  await page.goto('/quarter')
  await page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.config.globalProperties.$nuxt
    return app && !app.isHydrating
  })
  const panel = page.locator('.quarter-summary-import')
  await panel.locator('summary').click()
  await expect(panel).toContainText('不需要固定模板')
  await panel.locator('[data-summary-text]').fill('普通叙述：明年想把工作流程做得更清晰，没有固定表头。')
  await panel.locator('[data-add-draft]').click()
  const title = '自由总结整理验收目标'
  await panel.getByLabel('目标标题', { exact: true }).fill(title)
  const quarter = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-Q${Math.floor(d.getMonth()/3)+1}` })
  await panel.getByLabel('目标季度', { exact: true }).selectOption(quarter)
  await panel.getByLabel('衡量与行动建议', { exact: true }).fill('先试点，再复盘；安排由我确认。')
  await expect(page.locator('[data-quarter-goal]').filter({ hasText: title })).toHaveCount(0)
  await panel.getByRole('checkbox').check()
  await expect(page.locator('[data-quarter-goal]').filter({ hasText: title })).toHaveCount(0)
  await panel.locator('[data-confirm-goals]').click()
  await expect(panel.getByRole('status')).toContainText('已添加 1 项')
  await expect(page.locator('[data-quarter-goal]').filter({ hasText: title })).toHaveCount(1)
  await page.reload()
  await expect(page.locator('[data-quarter-goal]').filter({ hasText: title })).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
