import { expect, test } from '@playwright/test'

const STORAGE_KEY = 'personal-ai-workspace:v1'

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop workspace interactions are covered here; mobile shell has separate coverage.')
  await page.goto('/')
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: unknown })?.__vue_app__))
  await page.evaluate(key => localStorage.removeItem(key), STORAGE_KEY)
  await page.reload()
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: unknown })?.__vue_app__))
})

test('global search opens a real task and project links filter Today', async ({ page }) => {
  await page.getByRole('button', { name: '全局搜索' }).first().click()
  const palette = page.locator('[data-command-palette]')
  await expect(palette).toBeVisible()
  await palette.getByLabel('搜索任务、项目和目标').fill('MiniMax API')
  await palette.locator('[data-search-task]').filter({ hasText: '整理 MiniMax API 接入方案' }).click()
  await expect(page.getByRole('dialog', { name: '编辑任务' })).toBeVisible()
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await page.locator('[data-project-row]').filter({ hasText: '个人效率系统' }).locator('a').click()
  await expect(page).toHaveURL(/project=10000000-0000-4000-8000-000000000002/)
  await expect(page.locator('h1')).toHaveText('个人效率系统')
  await expect(page.locator('[data-task-row]')).toHaveCount(4)
})

test('Today filters, sorting, collapsing, and agenda view are interactive', async ({ page }) => {
  await page.getByRole('button', { name: '筛选任务' }).click()
  await page.getByLabel('筛选关键词').fill('MiniMax')
  await page.getByLabel('完成状态筛选').selectOption('active')
  await expect(page.locator('[data-task-row]')).toHaveCount(1)

  await page.getByLabel('任务排序').selectOption('priority')
  await page.getByRole('button', { name: '日程' }).click()
  await expect(page.locator('[data-agenda-view] .agenda-task')).toHaveCount(1)

  await page.getByRole('button', { name: '列表' }).click()
  await page.getByRole('button', { name: '收起今日重点' }).click()
  await expect(page.locator('[data-task-row]')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '展开今日重点' })).toBeVisible()
})
