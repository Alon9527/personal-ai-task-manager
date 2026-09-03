import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'The desktop voice entry point is covered here.')
  await page.addInitScript(() => {
    class PreviewSpeechRecognition {
      continuous = false
      interimResults = false
      lang = ''
      start() {}
      stop() {}
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: PreviewSpeechRecognition })
  })
  await page.goto('/')
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: unknown })?.__vue_app__))
  await page.evaluate(() => localStorage.removeItem('personal-ai-voice-consent:v1'))
  await page.reload()
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: unknown })?.__vue_app__))
})

test('voice entry explains privacy before microphone access', async ({ page }) => {
  await page.locator('[data-quick-add] [data-voice-input]').click()

  const dialog = page.locator('[data-voice-consent]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '启用系统语音录入' })).toBeVisible()
  await expect(dialog).toContainText('不会保存录音')
  await expect(dialog).toContainText('不会自动创建或发送')
  await page.screenshot({ path: 'output/playwright/voice-consent-0.1.4.png' })

  await dialog.getByRole('button', { name: '暂不启用' }).click()
  await expect(dialog).toBeHidden()
})
