import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const STORAGE_KEY = 'personal-ai-workspace:v1'

test.beforeEach(async ({ page }) => {
  await gotoHydrated(page, '/')
  await page.evaluate(key => localStorage.removeItem(key), STORAGE_KEY)
  await page.reload()
  await waitForNuxtHydration(page)
  await expect(page.getByRole('link', { name: 'Today', exact: true }).first()).toBeVisible()
})

test('inbox task CRUD persists and soft deletion stays recoverable', async ({ page }) => {
  await gotoHydrated(page, '/inbox')
  await page.getByRole('button', { name: '详细新建', exact: true }).click()
  await page.getByLabel('任务标题').fill('收集箱验收任务')
  await page.getByRole('button', { name: '创建任务', exact: true }).click()
  await expect(page.getByText('收集箱验收任务', { exact: true })).toBeVisible()

  await page.reload()
  const createdRow = page.locator('[data-inbox-task]').filter({ hasText: '收集箱验收任务' })
  await expect(createdRow).toBeVisible()

  await createdRow.getByRole('button', { name: /收集箱验收任务 操作菜单/ }).click()
  await createdRow.locator('[data-action="edit"]' ).click()
  await page.getByLabel('任务标题').fill('收集箱验收任务（已编辑）')
  await page.getByRole('button', { name: '保存更改', exact: true }).click()

  const editedRow = page.locator('[data-inbox-task]').filter({ hasText: '收集箱验收任务（已编辑）' })
  await editedRow.getByRole('button', { name: /完成 收集箱验收任务/ }).click()
  await expect(editedRow.getByRole('button', { name: /恢复 收集箱验收任务/ })).toBeVisible()

  await editedRow.getByRole('button', { name: /收集箱验收任务（已编辑） 操作菜单/ }).click()
  await editedRow.locator('[data-action="delete"]').click()
  await page.locator('[data-confirm-delete]').click()
  await expect(page.getByText('收集箱验收任务（已编辑）', { exact: true })).toHaveCount(0)

  const deletedTask = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key) ?? '{}')
    return document.tasks?.find((task: { title: string }) =>
      task.title === '收集箱验收任务（已编辑）',
    )
  }, STORAGE_KEY)
  expect(deletedTask?.completedAt).not.toBeNull()
  expect(deletedTask?.deletedAt).not.toBeNull()
})

test('quarter goal create, update, review linkage, and soft delete persist', async ({ page }) => {
  await gotoHydrated(page, '/quarter')
  await page.getByRole('button', { name: '新建目标', exact: true }).click()
  await page.getByLabel('目标标题').fill('季度验收目标')
  await page.getByRole('spinbutton', { name: '进度', exact: true }).fill('80')
  await page.getByRole('button', { name: '创建目标', exact: true }).click()

  let goalCard = page.locator('[data-quarter-goal]').filter({ hasText: '季度验收目标' })
  await expect(goalCard).toBeVisible()
  await goalCard.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByLabel('目标标题').fill('季度验收目标（已编辑）')
  await page.getByRole('spinbutton', { name: '进度', exact: true }).fill('90')
  await page.getByRole('button', { name: '保存更改', exact: true }).click()

  await gotoHydrated(page, '/review')
  await expect(page.locator('[data-metric="goal-progress"]')).toContainText('74%')

  await gotoHydrated(page, '/quarter')
  goalCard = page.locator('[data-quarter-goal]').filter({ hasText: '季度验收目标（已编辑）' })
  await goalCard.getByRole('button', { name: /季度验收目标（已编辑） 操作菜单/ }).click()
  await goalCard.locator('[data-action="delete"]').click()
  await page.locator('[data-confirm-delete]').click()
  await expect(page.getByText('季度验收目标（已编辑）', { exact: true })).toHaveCount(0)

  const deletedGoal = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key) ?? '{}')
    return document.quarterGoals?.find((goal: { title: string }) =>
      goal.title === '季度验收目标（已编辑）',
    )
  }, STORAGE_KEY)
  expect(deletedGoal?.progress).toBe(90)
  expect(deletedGoal?.deletedAt).not.toBeNull()

  await gotoHydrated(page, '/review')
  await expect(page.locator('[data-metric="goal-progress"]')).toContainText('68%')
})

test('secondary dashboards remain usable at desktop and mobile viewports', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile'
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 })

  if (!isMobile) {
    await moveDemoTaskIntoInbox(page)
    await gotoHydrated(page, '/inbox')
    await expect(page.locator('[data-inbox-task]')).toHaveCount(1)
    await expect(page.locator('a[href="/inbox"].router-link-active').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: 'output/playwright/inbox-desktop.png' })

    await gotoHydrated(page, '/quarter')
    await expect(page.locator('[data-quarter-goal]')).toHaveCount(3)
    await expect(page.locator('a[href="/quarter"].router-link-active').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: 'output/playwright/quarter-desktop.png' })

    await gotoHydrated(page, '/review')
    await expect(page.locator('[data-quarter-trend-point]')).toHaveCount(4)
    await expect(page.locator('[data-project-distribution]').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: 'output/playwright/review-desktop.png' })
    return
  }

  await gotoHydrated(page, '/quarter')
  await expect(page.locator('[data-quarter-goal]')).toHaveCount(3)
  await expect(page.locator('[data-zone="sidebar"]')).toBeHidden()
  await expect(page.locator('[data-zone="context"]')).toBeHidden()
  await expect(page.locator('.rail-tools a')).toHaveCount(4)
  await expectNoHorizontalOverflow(page)

  const railBox = await page.locator('[data-zone="rail"]').boundingBox()
  const actionBox = await page.getByRole('button', { name: '添加目标', exact: true }).boundingBox()
  expect(railBox).not.toBeNull()
  expect(actionBox).not.toBeNull()
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(railBox!.y)

  await page.getByRole('button', { name: '添加目标', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '创建季度目标' })).toBeInViewport()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.screenshot({ path: 'output/playwright/quarter-mobile.png' })
})

async function moveDemoTaskIntoInbox(page: Page) {
  await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key) ?? '{}')
    const inbox = document.projects?.find((project: { name: string }) => project.name === '收集箱')
    const task = document.tasks?.find((item: { title: string }) => item.title.includes('MiniMax API'))
    if (inbox && task) task.projectId = inbox.id
    localStorage.setItem(key, JSON.stringify(document))
  }, STORAGE_KEY)
  await page.reload()
  await waitForNuxtHydration(page)
}

async function gotoHydrated(page: Page, path: string) {
  await page.goto(path)
  await waitForNuxtHydration(page)
}

async function waitForNuxtHydration(page: Page) {
  await page.waitForFunction(() =>
    Boolean((document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: unknown }) | null)?.__vue_app__),
  )
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
}
test('AI panel remains visible at readable desktop widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile')
  await page.setViewportSize({ width: 1030, height: 900 })
  await gotoHydrated(page, '/')
  await expect(page.locator('[data-zone="context"]')).toBeVisible()
  await expect(page.locator('.suite-ai')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.setViewportSize({ width: 820, height: 900 })
  await expect(page.locator('[data-zone="sidebar"]')).toBeHidden()
  await expect(page.locator('[data-zone="context"]')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
