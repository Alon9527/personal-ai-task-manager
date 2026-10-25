import { test, expect, type Page } from '@playwright/test'
const ids = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002']
const stamp = '2026-10-25T00:00:00.000Z'
async function ready(page: Page) {
  await page.waitForFunction(() => !(document.querySelector('#__nuxt') as any)?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating && !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
}
async function transport(page: Page) {
  // Installed only AFTER workspace startup: the workspace stays in a fresh
  // browser profile, never SQLite. Native AI transport is the sole mock.
  await page.evaluate(() => {
    const scope = window as any
    scope.isTauri = true
    scope.requests = []
    scope.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      if (command === 'minimax_get_status') return { available:true,configured:true,region:'cn',model:'MiniMax-M3',credentialStore:'windows-credential-manager',connectionRevision:'synthetic-session' }
      if (command === 'model_provider_list') return { profiles:[],pendingCredentialDeletes:[] }
      if (command !== 'ai_ask') throw new Error(`验收不允许命令 ${command}`)
      const request = args.request; scope.requests.push(request)
      if (request.question === '失败重试') throw new Error('模拟连接失败')
      const goal = request.context.quarterGoals.find((g: any) => g.quarter === '2026-Q4')
      const change = request.question.includes('改名') || request.question.includes('修订')
      return { answer: change ? '建议区分季度阶段，等待你确认。' : `分析：${request.question}\n` + '第一季度建立流程，第四季度验收交付。'.repeat(18),
        actions: change ? [{ actionId:'rename-q4',type:'renameQuarterGoal',reason:'第四季度强调年度成果',targetId:goal.id,expectedUpdatedAt:goal.updatedAt,payload:{title:request.question.includes('修订')?'完成年度成果验收':'完成年度交付'}}] : [],
        model:'synthetic-model',generatedAt:new Date().toISOString(),sources:[],usage:null }
    } }
    window.dispatchEvent(new Event('focus-ai-model-changed'))
  })
}
async function send(page: Page, text: string) {
  const input = page.locator('.ask-ai input, .suite-ai-input input').first()
  await input.fill(text)
  await input.press('Enter')
  await expect(page.locator('.agent-conversation [data-chat-role="assistant"]').last()).toBeVisible()
  await expect(input).toBeEnabled()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('focus-agent-conversation:v1')!).messages.some((m: any) => m.status === 'pending'))).toBe(false)
}
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort())
  await page.addInitScript(({ ids, stamp }) => {
    if (localStorage.getItem('personal-ai-workspace:v1')) return
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify({ version:3,projects:[],milestones:[],tasks:[],quarterGoals:ids.map((id, i) => ({ id,ownerId:'00000000-0000-4000-8000-000000000011',title:'提升视频制作能力',quarter:`2026-Q${i?4:1}`,description:'年度总结原文：分阶段推进',progress:35,status:'active',sortOrder:i,createdAt:stamp,updatedAt:stamp,deletedAt:null })) }))
  }, { ids, stamp })
  await page.goto('/'); await ready(page); await transport(page)
})

test('goal picker stages references and leaves one scroll area with a reachable composer', async ({page},info)=>{
  const open=page.locator('[data-goal-picker]')
  await expect(open).toBeEnabled()
  await open.click()
  const dialog=page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('目标年份',{exact:true}).fill('2026')
  await dialog.getByRole('button',{name:'Q4',exact:true}).click()
  await expect(dialog.locator('input[type=checkbox]')).toHaveCount(1)
  await dialog.locator('input[type=checkbox]').check()
  await expect(open).toContainText('已选 0 项')
  await dialog.getByRole('button',{name:'取消',exact:true}).click()
  await expect(open).toBeFocused()
  await open.click()
  await expect(dialog.locator('input[type=checkbox]:checked')).toHaveCount(0)
  await dialog.getByLabel('搜索目标名称').fill('不存在')
  await expect(dialog).toContainText('没有匹配的目标')
  await dialog.getByLabel('搜索目标名称').fill('视频')
  await dialog.locator('input[type=checkbox]').first().check()
  await dialog.locator('input[type=checkbox]').last().check()
  await expect(dialog).not.toContainText(ids[0])
  await dialog.screenshot({path:info.outputPath('goal-picker.png')})
  await dialog.getByRole('button',{name:'确认引用',exact:true}).click()
  await expect(open).toContainText('已选 2 项')
  await send(page,'比较两个目标')
  const request=await page.evaluate(()=>(window as any).requests.at(-1))
  expect(request.context.quarterGoals.map((g:any)=>g.id)).toEqual(ids)
  const panel=page.locator('.chat-first-panel')
  expect(await panel.locator('select').count()).toBe(0)
  const log=page.getByRole('log')
  const bounds=await log.boundingBox();expect(bounds!.height).toBeGreaterThan(150)
  for(const name of ['AI 计划要求','添加图片','发送计划要求']){
    const b=await page.getByLabel(name,{exact:true}).boundingBox()
    expect(b!.y+b!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  }
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
  await panel.screenshot({path:info.outputPath('chat-sidebar.png')})
})
test('five-turn conversation, revision, local confirmation, navigation and restart', async ({ page }, info) => {
  await page.getByRole('link', { name: /季度追踪/ }).first().click()
  await expect(page.locator('.ask-ai')).toBeVisible()
  await send(page, '分析两个季度为什么同名')
  await send(page, '第四季度应强调什么')
  await send(page, '请给第四季度改名')
  await expect(page.locator('[data-chat-plan]')).toContainText('2026-Q4')
  await send(page, '修订为年度成果验收')
  await expect(page.getByRole('button', { name:'采用这版修改' })).toBeVisible()
  await send(page, '为什么用这个名字')
  await page.getByRole('button', { name:'采用这版修改' }).click()
  await expect(page.getByRole('button', { name:'确认执行当前方案', exact:true })).toBeVisible()
  const calls = await page.evaluate(() => (window as any).requests.length)
  await page.locator('.ask-ai input').fill('确定'); await page.locator('.ask-ai input').press('Enter')
  await expect(page.getByRole('log')).toContainText('已执行 1 项操作')
  expect(await page.evaluate(() => (window as any).requests.length)).toBe(calls)
  const goals = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!).quarterGoals)
  expect(goals[0].title).toBe('提升视频制作能力')
  expect(goals[1]).toMatchObject({title:'完成年度成果验收',progress:35,description:'年度总结原文：分阶段推进'})
  const requests = await page.evaluate(() => (window as any).requests)
  expect(requests[3].history).toHaveLength(6)
  expect(requests[3].pendingPlan.actions[0].targetId).toBe(ids[1])
  expect(requests[3].connectionGuard).toEqual({kind:'minimax',revision:'synthetic-session',region:'cn'})
  expect(requests[3].context.quarterGoals[1].updatedAt).toBe(stamp)
  await page.locator('.ask-ai input').fill('确定'); await page.locator('.ask-ai input').press('Enter')
  expect(await page.evaluate(() => (window as any).requests.length)).toBe(calls)
  await page.getByRole('link', { name:'Today',exact:true }).first().click()
  await expect(page.getByRole('log')).toContainText('分析两个季度为什么同名')
  const input = page.getByLabel('AI 计划要求')
  await expect(input).toBeVisible()
  const box = await input.boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await page.screenshot({path:info.outputPath('history-and-result.png')})
  await page.reload(); await ready(page)
  await expect(page.getByRole('log')).toContainText('完成年度成果验收')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('focus-agent-conversation:v1')!).messages.filter((m:any)=>m.plan).length)).toBe(2)
})

test('composer and goal dialog stay reachable at effective 80 and 110 percent desktop zoom',async({page},info)=>{
  const physical=page.viewportSize()!
  // WebView zoom changes the effective CSS viewport. This tests layout at the
  // equivalent sizes; it is not a test of the Windows setZoom bridge itself.
  for(const scale of [0.8,1.1]){
    await page.setViewportSize({width:Math.floor(physical.width/scale),height:Math.floor(physical.height/scale)})
    await page.locator('.chat-first-panel input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTfkAAAAASUVORK5CYII=','base64')})
    await expect(page.locator('.ai-image-preview')).toHaveCount(1)
    for(const name of ['AI 计划要求','添加图片','发送计划要求']){
      const b=await page.getByLabel(name,{exact:true}).boundingBox()
      expect(b).not.toBeNull();expect(b!.y).toBeGreaterThanOrEqual(0)
      expect(b!.y+b!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    }
    await page.locator('[data-goal-picker]').click()
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible()
    const footer=await dialog.getByRole('button',{name:'确认引用'}).boundingBox()
    expect(footer!.y+footer!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible()
    await expect(page.locator('[data-goal-picker]')).toBeFocused()
    await page.screenshot({path:info.outputPath(`scaled-${scale}.png`)})
    await page.getByRole('button',{name:'移除图片 synthetic.png',exact:true}).click()
  }
})

test('review-page execution leaves a persistent receipt in shared chat', async ({page}) => {
  await send(page, '请给第四季度改名')
  await page.locator('[data-review-agent-plan]').click()
  await expect(page.locator('[data-confirm-agent-plan]')).toBeEnabled()
  await page.locator('[data-confirm-agent-plan]').click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('focus-agent-conversation:v1')!).messages.at(-1).text)).toContain('已执行 1 项操作')
  await page.getByRole('link', {name:'Today',exact:true}).first().click()
  await expect(page.getByRole('log')).toContainText('完成年度交付')
  await page.reload(); await ready(page)
  await expect(page.getByRole('log')).toContainText('已执行 1 项操作')
})
test('restored plan cannot execute until reviewed and errors keep the input reachable', async ({ page }, info) => {
  await send(page, '请给第四季度改名')
  await page.reload(); await ready(page); await transport(page)
  const input = page.getByLabel('AI 计划要求')
  await input.fill('确定'); await input.press('Enter')
  await expect(page.locator('[data-ai-composer-error]')).toContainText('先查看')
  expect(await page.evaluate(() => (window as any).requests.length)).toBe(0)
  const goals = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!).quarterGoals)
  expect(goals[1].title).toBe('提升视频制作能力')
  await page.getByRole('button', {name:'我已查看此方案'}).click()
  await input.fill('失败重试'); await input.press('Enter')
  await expect(page.locator('[data-ai-composer-error]')).toContainText('模拟连接失败')
  const box = await input.boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await page.screenshot({path:info.outputPath('recovery-error.png')})
})
