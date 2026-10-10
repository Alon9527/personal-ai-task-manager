import { expect, test } from '@playwright/test'

async function ready(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.config.globalProperties.$nuxt
    return app && !app.isHydrating
  })
}

test('microphone is visible without access to external icon services', async ({ page }, info) => {
  await page.route('https://**/*', route => route.abort())
  await page.goto('/')
  await ready(page)
  const icon = page.locator('.suite-ai-input [data-voice-input] svg')
  await expect(icon).toBeVisible()
  const box = await icon.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(16)
  expect(box!.height).toBeGreaterThanOrEqual(16)
  await page.screenshot({ path: info.outputPath('microphone-visible.png') })
})

test('a half-hour calendar event shows its title and exposes full information', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/calendar')
  await ready(page)
  await page.getByRole('button', { name: '新建任务', exact: true }).first().click()
  const editor = page.locator('.suite-inline-editor')
  await editor.locator('[name="title"]').fill('9206 半小时日历标题验收')
  await editor.getByRole('button', { name: '创建任务', exact: true }).click()
  const event = page.locator('.suite-calendar-event').filter({ hasText: '9206 半小时日历标题验收' })
  await event.click()
  const title = event.locator('strong')
  const clipped = await title.evaluate(el => {
    const titleRect = el.getBoundingClientRect()
    const cardRect = el.parentElement!.getBoundingClientRect()
    return titleRect.bottom > cardRect.bottom || titleRect.top < cardRect.top
  })
  expect(clipped).toBe(false)
  await expect(event).toHaveAttribute('title', /9206 半小时日历标题验收/)
  await expect(event).toHaveAttribute('title', /09:00/)
  await expect(editor.locator('[name="title"]')).toHaveValue('9206 半小时日历标题验收')
  await page.screenshot({ path: info.outputPath('calendar-readable.png') })
})

test('chat visibly waits, displays a model reply, and reports a failed retry beside the input', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.route('https://**/*', route => route.abort())
  await page.goto('/')
  await ready(page)
  // Only the transport is simulated. The page, service schemas and workspace
  // remain real, using a fresh browser profile rather than the installed app.
  await page.evaluate(() => {
    const scope = window as any
    scope.isTauri = true
    scope.__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command !== 'ai_ask') throw new Error('验收未授权的命令')
        await new Promise(resolve => setTimeout(resolve, 800))
        if (scope.testModelFailure) throw '验收模拟：本机模型服务未连接'
        return { answer: '先处理今天即将到期的任务，再安排其他事项。', actions: [], sources: [], model: 'test-model', generatedAt: new Date().toISOString(), usage: null }
      },
    }
  })
  await page.getByLabel('AI 计划要求').fill('你好，今天怎么安排？')
  await page.getByRole('button', { name: '发送计划要求' }).click()
  await expect(page.locator('[data-ai-composer-status]')).toBeVisible()
  await expect(page.getByRole('log')).toContainText('你好，今天怎么安排？')
  await expect(page.getByRole('log')).toContainText('先处理今天即将到期的任务')
  await expect(page.locator('[data-ai-composer-status]')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('chat-reply.png') })
  await page.evaluate(() => { (window as any).testModelFailure = true })
  await page.getByLabel('AI 计划要求').fill('再试一次')
  await page.getByRole('button', { name: '发送计划要求' }).click()
  await expect(page.locator('[data-ai-composer-error]')).toBeVisible()
  await expect(page.locator('[data-ai-composer-error]')).toContainText('本机模型服务未连接')
  await expect(page.getByLabel('AI 计划要求')).toHaveValue('再试一次')
  await expect(page.getByRole('button', { name: '发送计划要求' })).toBeEnabled()
})
