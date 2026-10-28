import { test, expect, type Page } from '@playwright/test'
import { createDenseToday } from '../fixtures/today-dense'
const errors = new WeakMap<Page, string[]>()
async function ready(page: Page) { await page.waitForFunction(() => { const app = (document.querySelector('#__nuxt') as any)?.__vue_app__?.config.globalProperties.$nuxt; return app && !app.isHydrating }) }
async function start(page: Page, inbox = false) {
  const doc = createDenseToday()
  if (inbox) { doc.tasks = doc.tasks.slice(0, 24); doc.tasks.forEach(t => { t.projectId = null }) }
  await page.addInitScript(doc => { if (!localStorage.getItem('personal-ai-workspace:v1')) localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(doc)) }, doc)
  await page.goto(inbox ? '/inbox' : '/calendar'); await ready(page)
}
test.beforeEach(async ({page}) => { const list: string[] = []; errors.set(page,list); page.on('pageerror', e => list.push(e.message)); await page.route('https://**/*', r => r.abort()) })
test.afterEach(async ({page}) => { expect(errors.get(page)).toEqual([]) })

test('calendar list is compact and the focus toggle stays in both editor headers while scrolling', async ({page},info) => {
  await start(page)
  await page.getByRole('button',{name:'列表',exact:true}).click()
  const rows = page.locator('.compact-calendar-grid [data-task-row]')
  await expect(rows).toHaveCount(24)
  const a = (await rows.nth(0).boundingBox())!, b = (await rows.nth(1).boundingBox())!
  expect(a.height).toBeLessThanOrEqual(50)
  const width = await page.locator('.compact-calendar-list').evaluate(el => el.clientWidth)
  if (width >= 680) { expect(a.y).toBe(b.y); expect(b.x).toBeGreaterThan(a.x) } else expect(b.y).toBeGreaterThan(a.y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path:info.outputPath('compact-calendar-list.png')})
  await rows.first().locator('.suite-task-title').click()
  let editor = page.locator('.task-editor')
  const focus = editor.locator('.dialog-header [name=isFocus]')
  await expect(focus).toBeVisible(); await expect(editor.locator('[name=isFocus]')).toHaveCount(1)
  const before = (await focus.boundingBox())!
  await editor.locator('form').evaluate(el => { el.scrollTop = el.scrollHeight })
  expect((await focus.boundingBox())!.y).toBe(before.y)
  expect(before.y + before.height).toBeLessThan(page.viewportSize()!.height)
  await focus.uncheck()
  await page.screenshot({path:info.outputPath('fixed-focus-editor.png')})
  await editor.getByRole('button',{name:'保存更改',exact:true}).click()
  await expect(editor).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!).tasks[0].isFocus)).toBe(false)
  await page.getByRole('button',{name:'新建任务',exact:true}).click()
  editor = page.locator('.suite-inline-editor .task-editor')
  await editor.locator('[name=title]').fill('固定顶部重点验收')
  await editor.locator('.dialog-header [name=isFocus]').check()
  await editor.locator('form').evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(editor.locator('.dialog-header [name=isFocus]')).toBeVisible()
  await editor.getByRole('button',{name:'创建任务',exact:true}).click()
  await expect(editor).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!).tasks.find((t:any) => t.title === '固定顶部重点验收').isFocus)).toBe(true)
})

test('compact inbox applies the same enabled fields to all selected tasks and persists them', async ({page},info) => {
  await start(page, true)
  const rows = page.locator('[data-inbox-task]')
  await expect(rows).toHaveCount(24)
  expect((await rows.first().boundingBox())!.height).toBeLessThanOrEqual(52)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path:info.outputPath('compact-inbox.png')})
  for (let i = 0; i < 3; i++) await rows.nth(i).locator('[data-task-select]').check()
  if (await rows.first().locator('[data-organize-suggestion]').isVisible()) await rows.first().locator('[data-organize-suggestion]').click()
  else await page.locator('[data-bulk-edit]').click()
  const dialog = page.locator('[data-bulk-editor]')
  await expect(dialog).toContainText('统一编辑 3 项任务')
  await dialog.locator('[data-enable-field=projectId]').check()
  await dialog.locator('[data-bulk-project]').selectOption(createDenseToday().projects[0]!.id)
  await dialog.locator('[data-enable-field=priority]').check()
  await dialog.getByLabel('统一优先级',{exact:true}).selectOption('high')
  await dialog.locator('[data-enable-field=dueDate]').check()
  await dialog.getByLabel('统一截止日期',{exact:true}).fill('261031')
  const fieldsBox = (await dialog.locator('form > fieldset').boundingBox())!
  const footerBox = (await dialog.locator('footer').boundingBox())!
  expect(footerBox.y).toBeGreaterThanOrEqual(fieldsBox.y + fieldsBox.height)
  expect((await dialog.getByRole('button',{name:'应用到 3 项任务',exact:true}).boundingBox())!.height).toBeLessThanOrEqual(60)
  await dialog.screenshot({path:info.outputPath('bulk-task-editor.png')})
  await dialog.getByRole('button',{name:'应用到 3 项任务',exact:true}).click()
  await expect(dialog).toHaveCount(0); await expect(rows).toHaveCount(21)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!))
  for (const task of saved.tasks.slice(0,3)) expect(task).toMatchObject({ projectId:createDenseToday().projects[0]!.id, priority:'high', dueDate:'2026-10-31' })
  expect(saved.tasks[3].projectId).toBeNull()
  await page.reload(); await ready(page); await expect(rows).toHaveCount(21)
})

test('image send creates tasks once without an extra checkbox and separates empty recognition from network errors', async ({page},info) => {
  test.skip(page.viewportSize()!.width <= 760, 'Existing mobile shell hides the AI sidebar; desktop AI is the approved scope.')
  await start(page); await page.goto('/'); await ready(page)
  // Mock only the model bridge AFTER workspace startup; never open the native database or credentials.
  await page.evaluate(() => {
    const scope = window as any; scope.isTauri = true; scope.requests = []
    scope.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      if (command === 'minimax_get_status') return { available:true, configured:true, region:'cn', connectionRevision:'isolated-test' }
      if (command === 'model_provider_list') return { profiles:[],pendingCredentialDeletes:[] }
      if (command !== 'ai_ask') throw new Error(`验收禁止命令 ${command}`)
      scope.requests.push(args.request)
      if (args.request.question.includes('连接失败')) throw new Error('合成连接失败')
      return { answer: '已识别内容。', model:'synthetic-model', generatedAt:new Date().toISOString(), sources:[], usage:null,
        actions: args.request.question.includes('风景') ? [] : [{actionId:'image-task',type:'createTask',reason:'用户要求记录',draftRef:'task:image',selected:true,dangerous:false,payload:{title:'截图里的视频任务',description:'',projectId:null,milestoneId:null,priority:null,dueDate:null,dueTime:null,isFocus:false}}] }
    } }
    window.dispatchEvent(new Event('focus-ai-model-changed'))
  })
  const upload = () => page.locator('.chat-first-panel input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTfkAAAAASUVORK5CYII=','base64')})
  await upload(); await expect(page.locator('.ai-image-preview')).toHaveCount(1)
  await expect(page.locator('.ai-image-input input[type=checkbox]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).requests.length)).toBe(0)
  await page.getByLabel('发送计划要求',{exact:true}).click()
  await expect(page.getByRole('log')).toContainText('已创建 1 项任务')
  await expect(page.locator('.ai-image-preview')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!).tasks.length)).toBe(54)
  const input = page.getByLabel('AI 计划要求',{exact:true})
  await input.fill('确定'); await input.press('Enter')
  expect(await page.evaluate(() => (window as any).requests.length)).toBe(1)
  await upload(); await input.fill('请把这些图片中的风景记录为新任务'); await input.press('Enter')
  await expect(page.getByRole('log')).toContainText('未识别到可新建的任务')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!).tasks.length)).toBe(54)
  await upload(); await input.fill('帮我记下连接失败'); await input.press('Enter')
  await expect(page.locator('[data-ai-composer-error]')).toContainText('合成连接失败')
  await expect(page.locator('.ai-image-preview')).toHaveCount(1)
  await page.locator('.chat-first-panel').screenshot({path:info.outputPath('capture-result-and-retry.png')})
})
