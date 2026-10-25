import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
const injected=vi.hoisted(()=>({workspace:null as any,plan:null as any,ask:vi.fn()}))
vi.mock('../../app/composables/useWorkspace',()=>({useWorkspace:()=>injected.workspace}))
vi.mock('../../app/composables/useAgentPlan',()=>({useAgentPlan:()=>injected.plan}))
vi.mock('../../app/services/minimax',async(load)=>({...await load<typeof import('../../app/services/minimax')>(),askAi:injected.ask,getMiniMaxStatus:async()=>({available:true,configured:true,region:'cn',connectionRevision:'synthetic-session'})}))
vi.mock('../../app/services/model-provider',()=>({listModelProviders:async()=>({profiles:[],pendingCredentialDeletes:[]})}))
import SuiteAiPanel from '../../app/components/suite/SuiteAiPanel.vue'
import { saveAiModelTarget } from '../../app/services/ai-model-target'
let response:any
const imageData = 'data:image/png;base64,iVBORw0KGgo='
function pngFile(name = 'test.png') {
 return new File([new Uint8Array([137,80,78,71,13,10,26,10])], name, { type: 'image/png' })
}
async function attachImages(wrapper: Awaited<ReturnType<typeof mountSuspended>>, files: File[]) {
 const input = wrapper.get('input[type="file"]')
 Object.defineProperty(input.element, 'files', { value: files, configurable: true })
 await input.trigger('change'); await flushPromises()
}
it.each(['MiniMax-M3.1-Flash', 'MiniMax-M3'])('sends images to %s only after consent and keeps task changes pending', async modelId => {
 saveAiModelTarget({ kind: 'minimax', modelId })
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises()
 await attachImages(wrapper, [pngFile()])
 expect(wrapper.get('.ai-image-preview img').attributes('src')).toBe(imageData)
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(injected.ask).not.toHaveBeenCalled()
 expect(wrapper.get('[role="alert"]').text()).toContain('允许')
 await wrapper.get('.ai-image-input input[type="checkbox"]').setValue(true)
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(injected.ask).toHaveBeenCalledWith(expect.any(Object), expect.any(String), { kind:'minimax', modelId }, [imageData])
 expect(injected.ask.mock.calls[0][1]).toContain('图片')
 expect(wrapper.get('.suite-plan-card').text()).toContain('09:30')
 expect(injected.plan.requestExecution).not.toHaveBeenCalled()
 expect(injected.workspace.updateTask).not.toHaveBeenCalled()
 wrapper.unmount()
})

it('blocks old MiniMax image requests but still allows text requests', async () => {
 saveAiModelTarget({ kind:'minimax', modelId:'MiniMax-M2.7' })
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises(); await attachImages(wrapper, [pngFile()])
 await wrapper.get('.ai-image-input input[type="checkbox"]').setValue(true)
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(injected.ask).not.toHaveBeenCalled()
 expect(wrapper.get('[role="alert"]').text()).toContain('M3.1 Flash')
 await wrapper.get('[aria-label="移除图片 test.png"]').trigger('click')
 await wrapper.get('[aria-label="AI 计划要求"]').setValue('先做什么？')
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(injected.ask).toHaveBeenCalledWith(expect.any(Object), '先做什么？', { kind:'minimax', modelId:'MiniMax-M2.7' })
 wrapper.unmount()
})

it('revokes image consent when changing models or adding another picture', async () => {
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises(); await attachImages(wrapper, [pngFile()])
 await wrapper.get('.ai-image-input input[type="checkbox"]').setValue(true)
 await wrapper.get('[aria-label="选择 AI 模型"]').setValue('minimax:MiniMax-M3.1-Flash')
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(injected.ask).not.toHaveBeenCalled()
 expect((wrapper.get('.ai-image-input input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
 await wrapper.get('.ai-image-input input[type="checkbox"]').setValue(true)
 await attachImages(wrapper, [pngFile('second.png')])
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(injected.ask).not.toHaveBeenCalled()
 expect(wrapper.findAll('.ai-image-preview')).toHaveLength(2)
 wrapper.unmount()
})

it('accepts a clipboard image without sending it until consent and submit', async () => {
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises()
 const event = new Event('paste', { bubbles: true, cancelable: true })
 Object.defineProperty(event, 'clipboardData', { value: { items:[{ kind:'file', type:'image/png', getAsFile:()=>pngFile() }] } })
 wrapper.element.dispatchEvent(event); await flushPromises()
 expect(event.defaultPrevented).toBe(true)
 expect(wrapper.get('.ai-image-preview img').attributes('src')).toBe(imageData)
 expect(injected.ask).not.toHaveBeenCalled()
 wrapper.unmount()
})

it.each([
 { files:()=>[new File(['gif'], 'a.gif', {type:'image/gif'})], reason:'PNG' },
 { files:()=>Array.from({length:5}, (_,i)=>pngFile(`a${i}.png`)), reason:'4 张' },
 { files:()=>[new File([new Uint8Array(5*1024*1024+1)], 'large.png', {type:'image/png'})], reason:'5 MB' },
 { files:()=>[new File([new Uint8Array(5*1024*1024)], 'a.png', {type:'image/png'}), new File([new Uint8Array(4*1024*1024)], 'b.png', {type:'image/png'})], reason:'8 MB' },
])('rejects invalid image input before model submission: $reason', async ({files,reason}) => {
 const wrapper=await mountSuspended(SuiteAiPanel,{global:{stubs:{VoiceInputButton:true}}})
 await flushPromises(); await attachImages(wrapper,files())
 expect(wrapper.get('[role="alert"]').text()).toContain(reason)
 expect(wrapper.findAll('.ai-image-preview')).toHaveLength(0)
 expect(injected.ask).not.toHaveBeenCalled()
 wrapper.unmount()
})

it('keeps consented images and input after a model failure for an explicit retry', async () => {
 injected.ask.mockRejectedValue(new Error('合成网络错误'))
 const wrapper=await mountSuspended(SuiteAiPanel,{global:{stubs:{VoiceInputButton:true}}})
 await flushPromises(); await attachImages(wrapper,[pngFile()])
 await wrapper.get('[aria-label="AI 计划要求"]').setValue('分析图中任务')
 await wrapper.get('.ai-image-input input[type="checkbox"]').setValue(true)
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(wrapper.get('[role="alert"]').text()).toContain('合成网络错误')
 expect(wrapper.get('.ai-image-preview img').attributes('src')).toBe(imageData)
 expect((wrapper.get('[aria-label="AI 计划要求"]').element as HTMLInputElement).value).toBe('分析图中任务')
 expect(injected.plan.requestExecution).not.toHaveBeenCalled()
 wrapper.unmount()
})
it('shows native model errors instead of swallowing the reason',async()=>{
 injected.ask.mockRejectedValue('模型回答格式不正确：示例错误')
 const wrapper=await mountSuspended(SuiteAiPanel,{global:{stubs:{VoiceInputButton:true}}});await flushPromises()
 await wrapper.find('.suite-ai-confirm').trigger('click');await flushPromises()
 expect(wrapper.get('[role="alert"]').text()).toContain('模型回答格式不正确')
 expect(injected.plan.setDraft).not.toHaveBeenCalled();wrapper.unmount()
})
beforeEach(()=>{
 localStorage.clear(); const doc=createDemoWorkspace();const task=doc.tasks[0]!
 injected.workspace={tasks:ref(doc.tasks),quarterGoals:ref(doc.quarterGoals),ready:ref(true),readLatestDocument:vi.fn().mockResolvedValue(doc),createTask:vi.fn(),updateTask:vi.fn()}
 const draft=shallowRef<any>(null)
 injected.plan={draft,validation:ref(null),executing:ref(false),error:ref(null),loadDraft:vi.fn(),setDraft:vi.fn((value)=>{draft.value=value;return true}),requestExecution:vi.fn().mockResolvedValue({status:'executed'}),toggleAction:vi.fn(),discardDraft:vi.fn()}
 response={answer:'建议安排在上午。',model:'test-model',generatedAt:'2026-09-15T01:00:00.000Z',actions:[{actionId:'schedule-one',type:'updateTask',reason:'先安排重要事项',selected:true,dangerous:false,targetId:task.id,expectedUpdatedAt:task.updatedAt,payload:{dueDate:'2026-09-15',dueTime:'09:30'}}]}
 injected.ask.mockReset().mockResolvedValue(response)
})
it('saves a proposal without executing and executes only after explicit confirmation',async()=>{
 const wrapper=await mountSuspended(SuiteAiPanel,{global:{stubs:{VoiceInputButton:true}}});await flushPromises()
 await wrapper.find('.suite-ai-confirm').trigger('click');await flushPromises()
 expect(injected.plan.setDraft).toHaveBeenCalledOnce();expect(injected.plan.requestExecution).not.toHaveBeenCalled()
 expect(injected.workspace.createTask).not.toHaveBeenCalled();expect(injected.workspace.updateTask).not.toHaveBeenCalled()
 expect(wrapper.find('.suite-plan-card').text()).toContain('09:30')
 await wrapper.find('.suite-ai-confirm').trigger('click');await flushPromises()
 expect(injected.plan.requestExecution).toHaveBeenCalledOnce();wrapper.unmount()
})
it('does not persist a late proposal after the panel is unmounted',async()=>{
 let resolveResponse!:(value:any)=>void
 injected.ask.mockImplementation(()=>new Promise(resolve=>{resolveResponse=resolve}))
 const wrapper=await mountSuspended(SuiteAiPanel,{global:{stubs:{VoiceInputButton:true}}});await flushPromises()
 await wrapper.find('.suite-ai-confirm').trigger('click');await flushPromises();wrapper.unmount()
 resolveResponse(response);await flushPromises();expect(injected.plan.setDraft).not.toHaveBeenCalled()
})
it('validates the proposal against the captured workspace before saving', async () => {
 response.actions[0].expectedUpdatedAt = '2000-01-01T00:00:00.000Z'
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises()
 await wrapper.find('.suite-ai-confirm').trigger('click'); await flushPromises()
 expect(injected.plan.setDraft).toHaveBeenCalledOnce()
 const draft = injected.plan.setDraft.mock.calls[0][0]
 expect(draft.validation.issues.some((issue: { code: string }) => issue.code === 'conflict')).toBe(true)
 expect(draft.validation.executable).toBe(false)
 wrapper.unmount()
})
it('uses a readable format error and preserves the input for retry', async () => {
 response.generatedAt = 'not-a-date'
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises()
 await wrapper.get('[aria-label="AI 计划要求"]').setValue('安排今天工作')
 await wrapper.find('.suite-ai-confirm').trigger('click'); await flushPromises()
 expect(wrapper.get('[role="alert"]').text()).toContain('AI 返回的计划格式无效')
 expect(wrapper.get('[role="alert"]').text()).not.toContain('invalid_format')
 expect((wrapper.get('[aria-label="AI 计划要求"]').element as HTMLInputElement).value).toBe('安排今天工作')
 expect(injected.plan.setDraft).not.toHaveBeenCalled()
 wrapper.unmount()
})

it('acknowledges a submitted message beside the composer while waiting, then shows the answer', async () => {
 let resolveResponse!: (value: any) => void
 injected.ask.mockImplementation(() => new Promise(resolve => { resolveResponse = resolve }))
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises()
 await wrapper.get('[aria-label="AI 计划要求"]').setValue('你好，今天先做什么？')
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(wrapper.find('[data-ai-composer-status]').text()).toContain('正在等待模型回复')
 expect(wrapper.find('[role="log"]').text()).toContain('你好，今天先做什么？')
 resolveResponse({ ...response, actions: [], answer: '可以先检查临近截止的事项。' }); await flushPromises()
 expect(wrapper.get('[role="log"]').text()).toContain('可以先检查临近截止的事项。')
 expect(wrapper.find('[data-ai-composer-status]').exists()).toBe(false)
 wrapper.unmount()
})

it('allows a question with a pending plan without replacing or executing that plan', async () => {
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises()
 await wrapper.get('.suite-ai-confirm').trigger('click'); await flushPromises()
 const original = injected.plan.draft.value
 response = { ...response, answer: '建议先做截止时间更早的任务。', actions: [] }
 injected.ask.mockResolvedValue(response)
 await wrapper.get('[aria-label="AI 计划要求"]').setValue('为什么这样安排？')
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(wrapper.find('[role="log"]').text()).toContain('建议先做截止时间更早的任务。')
 expect(injected.plan.draft.value).toBe(original)
 expect(injected.plan.requestExecution).not.toHaveBeenCalled()
 wrapper.unmount()
})

it('keeps the existing plan when a follow-up returns new actions and explains it by the composer', async () => {
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises()
 await wrapper.get('.suite-ai-confirm').trigger('click'); await flushPromises()
 const original = injected.plan.draft.value
 await wrapper.get('[aria-label="AI 计划要求"]').setValue('改到下午如何？')
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(wrapper.find('[data-chat-plan]').text()).toContain('候选修改')
 expect(wrapper.find('[data-chat-plan]').text()).toContain('保留原方案')
 expect(injected.plan.draft.value).toBe(original)
 wrapper.unmount()
})

it('shows transport failures beside the input and preserves the question for retry', async () => {
 injected.ask.mockRejectedValue(new Error('本机模型服务未连接'))
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises()
 await wrapper.get('[aria-label="AI 计划要求"]').setValue('请帮我分析任务')
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(wrapper.find('[data-ai-composer-error]').text()).toContain('本机模型服务未连接')
 expect((wrapper.get('[aria-label="AI 计划要求"]').element as HTMLInputElement).value).toBe('请帮我分析任务')
 wrapper.unmount()
})

it('does not turn an empty chat submission into an unsolicited scheduling request', async () => {
 const wrapper = await mountSuspended(SuiteAiPanel, { global: { stubs: { VoiceInputButton: true } } })
 await flushPromises()
 await wrapper.get('form.suite-ai-input').trigger('submit'); await flushPromises()
 expect(injected.ask).not.toHaveBeenCalled()
 wrapper.unmount()
})
