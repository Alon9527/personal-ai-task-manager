import { expect, test } from '@playwright/test'

const STORAGE_KEY = 'personal-ai-workspace:v1'
const PROJECT_ID = '10000000-0000-4000-8000-000000000002'

test('milestone actions remain clickable beside the AI panel at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`http://localhost:3000/?project=${PROJECT_ID}`)
  await waitForNuxtHydration(page)
  await page.evaluate(key => localStorage.removeItem(key), STORAGE_KEY)
  await page.reload()
  await waitForNuxtHydration(page)

  const title = 'Phase 1 responsive milestone'
  await page.locator('[data-new-milestone]').click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input').first().fill(title)
  await dialog.locator('button[type="submit"]').click()

  const menuButton = page.locator(`[aria-label^="${title}"]`)
  const contextPanel = page.locator('[data-zone="context"]')
  await expect(menuButton).toBeVisible()

  const menuBox = await menuButton.boundingBox()
  const contextBox = await contextPanel.boundingBox()
  expect(menuBox).not.toBeNull()
  expect(contextBox).not.toBeNull()
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(contextBox!.x)

  await menuButton.click()
  await expect(page.getByRole('menu')).toBeVisible()

  const metricWidths = await page.locator('.metric-grid article').evaluateAll(cards =>
    cards.map(card => card.getBoundingClientRect().width),
  )
  expect(metricWidths).toHaveLength(4)
  expect(Math.min(...metricWidths)).toBeGreaterThanOrEqual(200)
})

async function waitForNuxtHydration(page: import('@playwright/test').Page) {
  await page.waitForFunction(() =>
    Boolean((document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: unknown }) | null)?.__vue_app__),
  )
}
