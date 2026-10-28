import { describe, it, expect, vi } from 'vitest'
import { shallowRef } from 'vue'
import { createAgentChat } from '../../app/services/agent-chat'
import { createAgentConversation } from '../../app/services/agent-conversation'
import { createAgentPlanController } from '../../app/composables/useAgentPlan'
import { agentPlanDraftSchema } from '../../app/services/agent-plan-schema'
import { workspaceDocumentSchema, DEMO_OWNER_ID } from '../../shared/workspace'
const stamp = '2026-10-25T01:00:00.000Z'
const id = '10000000-0000-4000-8000-000000000001'
function setup() {
  const document = shallowRef(workspaceDocumentSchema.parse({ version: 3, projects: [], tasks: [], milestones: [], quarterGoals: [{ id, ownerId: DEMO_OWNER_ID, title: '同名目标', description: '原文依据', quarter: '2026-Q4', progress: 35, status: 'active', sortOrder: 0, createdAt: stamp, updatedAt: stamp, deletedAt: null }] }))
  const replace = vi.fn(async next => { document.value = next })
  const workspace = { document, readLatestDocument: async () => document.value, replaceWorkspaceDocument: replace }
  const plan = createAgentPlanController({ workspace, storage: { load: () => null, save: () => {}, clear: () => {} } })
  const draft = agentPlanDraftSchema.parse({ version: 1, id: crypto.randomUUID(), question: '改名', model: 'test', createdAt: stamp, updatedAt: stamp, status: 'draft', actions: [{ actionId: 'rename', type: 'renameQuarterGoal', reason: '区分阶段', targetId: id, expectedUpdatedAt: stamp, payload: { title: '年度交付' } }], validation: { executable: false, selectedCount: 0, dangerousCount: 0, estimatedMinutes: 0, issueCount: 0, issues: [] } })
  const ask = vi.fn(async () => ({ status: 'ready' as const, isCurrent: () => true, value: { response: { answer: '建议改成年度交付', actions: draft.actions, sources: [], generatedAt: stamp, model: 'test', usage: null }, draft, error: null } }))
  const log = createAgentConversation()
  const brief = vi.fn(async () => ({ status:'ready' as const, isCurrent:()=>true, value:{ focus:'先处理重点', progress:[], sources:[], model:'test', generatedAt:stamp, usage:null, suggestion:{title:'准备素材',description:'整理文件',rationale:'推进交付',projectId:null,priority:'high' as const,dueDate:null,dueTime:null,isFocus:true} } }))
  const fingerprint=vi.fn(async target => JSON.stringify(target))
  const chat = createAgentChat({ log, plan, readDocument: workspace.readLatestDocument, ask, brief, fingerprint })
  return { chat, log, plan, draft, ask, brief, replace, document, fingerprint }
}
const target = { kind: 'minimax' as const, modelId: 'MiniMax-M3' as const }
describe('shared Agent chat', () => {
  function createTaskReply(s: ReturnType<typeof setup>) {
    s.draft.actions = [{ actionId: 'capture', type: 'createTask', draftRef: 'task:capture', reason: '记录待办', selected: true, dangerous: false, payload: { title: '9666GMS AI视频', description: '', projectId: null, milestoneId: null, priority: null, dueDate: null, dueTime: null, isFocus: false } }]
    return s
  }
  it.each(['帮我记一下今天要做9666GMS的AI视频', '帮我记下分析竞品视频', '帮我记录明天开会讨论视频方案'])('persists an explicit capture immediately and confirms only the resulting summary once: %s', async question => {
    const s = createTaskReply(setup())
    expect(await s.chat.send({ question, target })).toBe(true)
    expect(s.document.value.tasks).toHaveLength(1)
    expect(s.document.value.tasks[0]?.title).toBe('9666GMS AI视频')
    expect(s.log.messages.value.at(-1)?.text).toContain('已创建 1 项任务')
    await s.chat.send({ question: '确定', target })
    expect(s.document.value.tasks).toHaveLength(1)
    expect(s.ask).toHaveBeenCalledTimes(1)
  })
  it.each([
    '分析一下要不要新建任务', '不要新建任务', '如果要新建任务会怎样？',
    '帮我创建一个准备视频的任务，先给我预览，确认后再保存',
    '新增任务的流程是什么', '记录一下你建议怎么修改现有任务',
    '帮我添加一个拍摄任务，等我确认再执行', '帮我新建拍摄任务，先给草稿',
    '新建任务能否自动关联项目', '帮我记录任务，暂不保存',
  ])('never auto-writes a discussion or reserved confirmation: %s', async question => {
    const s = createTaskReply(setup()); await s.chat.send({ question, target })
    expect(s.document.value.tasks).toHaveLength(0)
    expect(s.replace).not.toHaveBeenCalled()
  })
  it('still captures image-only new tasks while reserving existing-record changes for confirmation', async () => {
    const s = createTaskReply(setup())
    await s.chat.send({ question: '请把这些图片中能清楚识别的待办记录为新任务，不编造信息；没有任务就说明未识别到任务。已完成或匹配现有任务的内容只提出修改建议，等我确认。', target, images: ['data:image/png;base64,aA=='] })
    expect(s.document.value.tasks).toHaveLength(1)
    expect(s.replace).toHaveBeenCalledTimes(1)
  })
  it('does not auto-apply existing-record changes even when a request starts with create', async () => {
    const s = setup(); await s.chat.send({ question: '新建一个任务并改季度目标', target })
    expect(s.replace).not.toHaveBeenCalled()
  })
  it('keeps old pending plans for review instead of executing a new capture alongside them', async () => {
    const s = setup(); s.plan.setDraft(s.draft)
    createTaskReply(s)
    await s.chat.send({ question: '帮我记下新任务', target })
    expect(s.replace).not.toHaveBeenCalled()
    expect(s.log.state.value.candidate).not.toBeNull()
  })
  it('does not silently repeat a task already captured', async () => {
    const s = createTaskReply(setup())
    await s.chat.send({ question: '帮我记一下9666GMS的AI视频', target })
    await s.chat.send({ question: '帮我记一下9666GMS的AI视频', target })
    expect(s.document.value.tasks).toHaveLength(1)
    expect(s.replace).toHaveBeenCalledTimes(1)
  })
  it('keeps a failed capture retryable and does not claim it was saved', async () => {
    const s = createTaskReply(setup()); s.replace.mockRejectedValueOnce(new Error('磁盘写入失败'))
    expect(await s.chat.send({ question: '帮我记下新任务', target })).toBe(false)
    expect(s.document.value.tasks).toHaveLength(0)
    expect(s.log.messages.value.at(-1)?.text).not.toContain('已保存')
    expect(s.chat.error.value).toBeTruthy()
  })
  it('reports no recognized image tasks without inventing a plan', async () => {
    const s = setup()
    s.ask.mockResolvedValueOnce({ status: 'ready', isCurrent: () => true, value: { response: { answer: '图片是风景。', actions: [], sources: [], model: 'test', generatedAt: stamp, usage: null }, draft: null, error: null } } as any)
    await s.chat.send({ question: '请把这些图片中可识别的待办记录为新任务', target, images: ['data:image/png;base64,aA=='] })
    expect(s.log.messages.value.at(-1)?.text).toContain('未识别到可新建的任务')
    expect(s.replace).not.toHaveBeenCalled()
  })
  it.each(['brief','message'])('ignores obsolete fingerprint failures after a successful %s retry',async mode=>{
    const s=setup();let reject!: (cause:Error)=>void
    s.fingerprint.mockResolvedValueOnce(JSON.stringify(target)).mockImplementationOnce(()=>new Promise((_,r)=>{reject=r}))
    const run=()=>mode==='brief'?s.chat.generateBrief(target):s.chat.send({question:'分析',target})
    const old=run();await vi.waitFor(()=>expect(s.fingerprint).toHaveBeenCalledTimes(2))
    s.chat.cancel();expect(await run()).toBe(true)
    reject(new Error('过期连接错误'));await old
    expect(s.chat.error.value).toBe('');expect(s.log.messages.value[0]?.status).toBe('ready')
    expect(s.log.messages.value).toHaveLength(2)
  })
  it('allows discarded brief suggestions again but never repeats executed ones',async()=>{
    const s=setup();await s.chat.generateBrief(target)
    const message=s.log.messages.value.at(-1)!
    s.plan.setDraft(s.draft)
    await s.chat.suggestBrief(message.id);expect(s.log.state.value.candidate).not.toBeNull()
    s.chat.keep();expect(await s.chat.suggestBrief(message.id)).toBe(true)
    s.chat.adopt();s.plan.discardDraft()
    expect(await s.chat.suggestBrief(message.id)).toBe(true)
    s.chat.review();expect(await s.chat.confirm()).toBe(true)
    expect(await s.chat.suggestBrief(message.id)).toBe(false)
    expect(s.replace).toHaveBeenCalledTimes(1)
  })
  it('stores sourced briefs in conversation and turns suggestions into reviewable plans only', async () => {
    const s=setup(); await s.chat.generateBrief(target)
    const message=s.log.messages.value.at(-1)!
    expect(message.text).toContain('先处理重点'); expect(message.brief?.suggestion?.title).toBe('准备素材')
    await s.chat.suggestBrief(message.id)
    expect(s.plan.draft.value?.actions[0]?.type).toBe('createTask'); expect(s.replace).not.toHaveBeenCalled()
    const id=s.plan.draft.value?.id; await s.chat.suggestBrief(message.id)
    expect(s.plan.draft.value?.id).toBe(id)
  })
  it('serializes briefs with chat and ignores cancelled brief responses', async () => {
    const s=setup(); let resolve!: (v:any)=>void
    s.brief.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
    const pending=s.chat.generateBrief(target)
    await vi.waitFor(()=>expect(s.brief).toHaveBeenCalledOnce())
    expect(await s.chat.send({question:'继续',target})).toBe(false)
    expect(s.ask).not.toHaveBeenCalled(); s.chat.cancel()
    resolve({status:'ready',isCurrent:()=>true,value:{focus:'迟到的简报'}}); await pending
    expect(s.log.messages.value).toHaveLength(1); expect(s.log.messages.value[0]?.status).toBe('failed')
  })
  it('does not bypass changed-model consent for a brief', async () => {
    const s=setup(); await s.chat.send({question:'分析',target})
    await s.chat.generateBrief({kind:'minimax',modelId:'MiniMax-M2.7'})
    expect(s.brief).not.toHaveBeenCalled(); expect(s.chat.consent.value).toBeTruthy()
  })
  it('binds confirmation to a rendered proposal and executes locally exactly once', async () => {
    const s = setup()
    await s.chat.send({ question: '改第四季度目标名', target })
    await s.chat.send({ question: '确定', target })
    expect(s.replace).not.toHaveBeenCalled()
    s.chat.review()
    await s.chat.send({ question: '确定', target })
    expect(s.ask).toHaveBeenCalledTimes(1)
    expect(s.replace).toHaveBeenCalledTimes(1)
    expect(s.document.value.quarterGoals[0]?.title).toBe('年度交付')
    expect(s.log.messages.value.at(-1)?.text).toContain('年度交付')
    await s.chat.send({ question: '确定', target })
    expect(s.replace).toHaveBeenCalledTimes(1)
  })
  it('sends history and pending plan, but revisions require adoption', async () => {
    const s = setup()
    await s.chat.send({ question: '改名', target })
    s.chat.review()
    await s.chat.send({ question: '换个名字', target })
    const input = s.ask.mock.calls.at(-1)?.[0] as any
    expect(input.conversation.history.map((m: any) => m.text)).toEqual(['改名', '建议改成年度交付'])
    expect(input.conversation.pendingPlan.id).toBe(s.plan.draft.value?.id)
    expect(s.log.state.value.candidate).not.toBeNull()
    await s.chat.send({ question: '确定', target })
    expect(s.replace).not.toHaveBeenCalled()
  })
  it('requires consent for a changed model and does not transmit history beforehand', async () => {
    const s = setup()
    await s.chat.send({ question: '改名', target })
    await s.chat.send({ question: '继续', target: { kind: 'custom', profileId: crypto.randomUUID() } })
    expect(s.ask).toHaveBeenCalledTimes(1)
    expect(s.chat.consent.value).not.toBeNull()
  })
  it('rejects changed plan contents and stale goal versions', async () => {
    const s = setup()
    await s.chat.send({ question: '改名', target }); s.chat.review()
    s.document.value.quarterGoals[0]!.updatedAt = '2026-10-25T02:00:00.000Z'
    await s.chat.confirm()
    expect(s.replace).not.toHaveBeenCalled()
    expect(s.chat.error.value).toBeTruthy()
  })
  it('ignores cancelled responses without erasing the user message', async () => {
    const s = setup(); let finish!: (value: any) => void
    s.ask.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = s.chat.send({ question: '改名', target })
    await vi.waitFor(() => expect(s.ask).toHaveBeenCalledOnce())
    s.chat.cancel()
    finish({ status: 'ready', isCurrent: () => true, value: { response: { answer: '过时回答' }, draft: s.draft, error: null } })
    await pending
    expect(s.plan.draft.value).toBeNull()
    expect(s.log.messages.value).toHaveLength(1)
    expect(s.log.messages.value[0]?.status).toBe('failed')
  })
  it('does not arm a modified plan even with the original timestamp', async () => {
    const s = setup(); await s.chat.send({ question: '改名', target }); s.chat.review()
    s.plan.draft.value!.actions[0]!.payload = { title: '偷偷改动' }
    await s.chat.confirm()
    expect(s.replace).not.toHaveBeenCalled()
  })
  it('rejects obsolete content inside the execution controller', async () => {
    const s = setup(); s.plan.setDraft(s.draft)
    expect((await s.plan.requestExecution('old-content')).status).toBe('confirmation-stale')
    expect(s.replace).not.toHaveBeenCalled()
  })
  it('retains a saved candidate when the original changed, and requires choosing again', async () => {
    const s = setup(); await s.chat.send({ question: '改名', target })
    await s.chat.send({ question: '修订', target })
    s.plan.draft.value!.question = 'another change'
    s.chat.adopt()
    expect(s.log.state.value.candidate).not.toBeNull()
    expect(s.chat.error.value).toContain('计划已变化')
    expect(s.replace).not.toHaveBeenCalled()
  })
  it('preserves structured proposal versions after adopting a revision', async () => {
    const s = setup(); await s.chat.send({ question: '改名', target })
    const first = s.plan.draft.value!.id
    await s.chat.send({ question: '修订', target })
    s.chat.adopt()
    const snapshots = s.log.messages.value.filter(m => 'plan' in m)
    expect(snapshots).toHaveLength(2)
    expect((snapshots[0] as any).plan.id).toBe(first)
    expect((snapshots[0] as any).plan.actions[0].payload.title).toBe('年度交付')
  })
  it('records execution through the independent review controller, not only chat confirm', async () => {
    const s = setup(); await s.chat.send({ question: '改名', target })
    await s.plan.requestExecution()
    expect(s.log.messages.value.at(-1)?.text).toContain('已执行 1 项操作')
    expect(s.log.messages.value.at(-1)?.text).toContain('同名目标')
    expect(s.log.messages.value.at(-1)?.text).toContain('年度交付')
  })
})
