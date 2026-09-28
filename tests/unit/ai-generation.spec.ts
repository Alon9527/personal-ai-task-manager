import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { z } from 'zod'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import type { MiniMaxAnswer, MiniMaxBrief } from '../../app/services/minimax'
import type { AiModelTarget } from '../../app/services/ai-model-target'
import { aiErrorMessage, buildAiPlanDraft, createAiGeneration, saveAiProposal } from '../../app/services/ai-generation'

const transport = vi.hoisted(() => ({ ask: vi.fn(), brief: vi.fn() }))
vi.mock('../../app/services/minimax', async load => ({
  ...await load<typeof import('../../app/services/minimax')>(), askAi: transport.ask, generateAiBrief: transport.brief,
}))
const target: AiModelTarget = { kind: 'minimax', modelId: 'MiniMax-M3' }
const timestamp = '2026-09-28T01:00:00.000Z'
const response: MiniMaxAnswer = { answer: '先处理重要事项', actions: [], sources: [], model: 'test', generatedAt: timestamp, usage: null }
const brief: MiniMaxBrief = { focus: '重点', progress: [], suggestion: null, sources: [], model: 'test', generatedAt: timestamp, usage: null }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.clearAllMocks()
  transport.ask.mockResolvedValue(response)
  transport.brief.mockResolvedValue(brief)
})
describe('shared AI generation', () => {
  it('does not send an invalidated request after its snapshot arrives', async () => {
    const read = deferred<ReturnType<typeof createDemoWorkspace>>()
    const generation = createAiGeneration(() => read.promise)
    const request = generation.ask({ question: '安排', target })
    generation.invalidate()
    read.resolve(createDemoWorkspace())
    expect(await request).toBeNull()
    expect(transport.ask).not.toHaveBeenCalled()
    expect(generation.asking.value).toBe(false)
  })
  it('captures model, selection and image inputs before awaiting the latest document', async () => {
    const doc = createDemoWorkspace()
    const read = deferred<typeof doc>()
    const generation = createAiGeneration(() => read.promise)
    const requestTarget = reactive<AiModelTarget>({ ...target })
    const ids = [doc.tasks[0]!.id]
    const images = ['data:image/png;base64,YQ==']
    const request = generation.ask({ question: '安排', target: requestTarget, taskIds: ids, images })
    requestTarget.modelId = 'MiniMax-M2.7'; ids.length = 0; images.length = 0
    read.resolve(reactive(doc))
    const result = await request
    expect(result?.status).toBe('ready')
    expect(transport.ask.mock.calls[0]![0].tasks.map((t: { id: string }) => t.id)).toEqual([doc.tasks[0]!.id])
    expect(transport.ask.mock.calls[0]![2]).toEqual(target)
    expect(transport.ask.mock.calls[0]![3]).toEqual(['data:image/png;base64,YQ=='])
  })
  it('ignores stale errors without clearing the busy state of a newer request', async () => {
    const old = deferred<MiniMaxAnswer>(); const current = deferred<MiniMaxAnswer>()
    transport.ask.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const generation = createAiGeneration(async () => createDemoWorkspace())
    const a = generation.ask({ question: '旧', target })
    await vi.waitFor(() => expect(transport.ask).toHaveBeenCalledOnce())
    generation.invalidate()
    const b = generation.ask({ question: '新', target })
    await vi.waitFor(() => expect(transport.ask).toHaveBeenCalledTimes(2))
    old.reject('过期错误')
    expect(await a).toBeNull(); expect(generation.asking.value).toBe(true)
    current.resolve(response)
    expect((await b)?.status).toBe('ready'); expect(generation.asking.value).toBe(false)
  })
  it('allows separate brief and answer channels but prevents duplicate clicks', async () => {
    const answerWait = deferred<MiniMaxAnswer>(); const briefWait = deferred<MiniMaxBrief>()
    transport.ask.mockReturnValueOnce(answerWait.promise); transport.brief.mockReturnValueOnce(briefWait.promise)
    const read = vi.fn(async () => createDemoWorkspace())
    const generation = createAiGeneration(read)
    const a = generation.ask({ question: '安排', target }); const b = generation.brief(target)
    expect(await generation.ask({ question: '重复', target })).toBeNull()
    expect(read).toHaveBeenCalledTimes(2)
    answerWait.resolve(response); await a
    expect(generation.generatingBrief.value).toBe(true)
    briefWait.resolve(brief); await b
    expect(generation.generatingBrief.value).toBe(false)
  })
  it('disposes all channels and refuses later requests', async () => {
    const wait = deferred<MiniMaxBrief>(); transport.brief.mockReturnValueOnce(wait.promise)
    const read = vi.fn(async () => createDemoWorkspace()); const generation = createAiGeneration(read)
    const pending = generation.brief(target)
    await vi.waitFor(() => expect(transport.brief).toHaveBeenCalledOnce())
    generation.dispose(); wait.resolve(brief)
    expect(await pending).toBeNull()
    expect(await generation.ask({ question: '安排', target })).toBeNull()
    expect(read).toHaveBeenCalledOnce()
  })
  it('retains a stable validation snapshot when the UI changes during transport', async () => {
    const doc = reactive(createDemoWorkspace()); const task = doc.tasks[0]!
    const wait = deferred<MiniMaxAnswer>(); transport.ask.mockReturnValueOnce(wait.promise)
    const generation = createAiGeneration(async () => doc)
    const pending = generation.ask({ question: '安排', target })
    await vi.waitFor(() => expect(transport.ask).toHaveBeenCalledOnce())
    const action = { actionId: 'one', type: 'updateTask' as const, targetId: task.id, expectedUpdatedAt: task.updatedAt, reason: '安排', selected: true, dangerous: false as const, payload: { title: '新标题' } }
    task.updatedAt = timestamp
    wait.resolve({ ...response, actions: [action] })
    const result = await pending
    expect(result?.status).toBe('ready')
    if (result?.status !== 'ready') throw new Error('no proposal')
    expect(result.value.draft?.validation.issues.some(issue => issue.code === 'conflict')).toBe(false)
  })
  it('keeps plain answers and reports snapshot failures without calling the model', async () => {
    const generation = createAiGeneration(async () => createDemoWorkspace())
    const result = await generation.ask({ question: '问答', target })
    expect(result?.status === 'ready' && result.value.draft).toBeNull()
    const failed = await createAiGeneration(async () => { throw new Error('本机数据暂不可读取') }).ask({ question: '安排', target })
    expect(failed).toMatchObject({ status: 'failed', error: '本机数据暂不可读取' })
    expect(transport.ask).toHaveBeenCalledOnce()
  })
  it('uses safe schema errors but preserves sanitized native error strings', () => {
    const result = z.string().safeParse(4)
    expect(aiErrorMessage(result.error)).toBe('AI 返回的计划格式无效，请重新生成。')
    expect(aiErrorMessage('模型访问被拒绝')).toBe('模型访问被拒绝')
    expect(aiErrorMessage({ secret: 'do not display' })).toBe('AI 操作失败，请重试')
  })
  it('requires exact revision confirmation before replacing a different pending plan', () => {
    const doc = createDemoWorkspace()
    const old = buildAiPlanDraft(response, '旧计划', doc)
    const candidate = buildAiPlanDraft(response, '新计划', doc)
    const sink = { draft: ref(old), error: ref<string | null>(null), setDraft: vi.fn(() => true) }
    const first = saveAiProposal(sink, candidate)
    if (first.status !== 'replacement-required') throw new Error('confirmation missing')
    expect(sink.setDraft).not.toHaveBeenCalled()
    sink.draft.value.question = '编辑后的旧计划'
    expect(saveAiProposal(sink, candidate, first.revision)).toMatchObject({ status: 'replacement-required', changed: true })
    const next = saveAiProposal(sink, candidate)
    if (next.status !== 'replacement-required') throw new Error('confirmation missing')
    expect(saveAiProposal(sink, candidate, next.revision)).toEqual({ status: 'saved' })
    expect(sink.setDraft).toHaveBeenCalledOnce()
  })
  it('reports a storage failure without claiming a successful save', () => {
    const draft = buildAiPlanDraft(response, '计划', createDemoWorkspace())
    const sink = { draft: ref(null), error: ref('磁盘不可写'), setDraft: () => false }
    expect(() => saveAiProposal(sink, draft)).toThrow('无法保存 AI 计划草稿')
  })
})
