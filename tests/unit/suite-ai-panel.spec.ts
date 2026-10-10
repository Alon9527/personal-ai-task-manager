import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
const injected=vi.hoisted(()=>({workspace:null as any,plan:null as any,ask:vi.fn()}))
vi.mock('../../app/composables/useWorkspace',()=>({useWorkspace:()=>injected.workspace}))
vi.mock('../../app/composables/useAgentPlan',()=>({useAgentPlan:()=>injected.plan}))
vi.mock('../../app/services/minimax',async(load)=>({...await load<typeof import('../../app/services/minimax')>(),askAi:injected.ask}))
vi.mock('../../app/services/model-provider',()=>({listModelProviders:async()=>({profiles:[],pendingCredentialDeletes:[]})}))
import SuiteAiPanel from '../../app/components/suite/SuiteAiPanel.vue'
let response:any
it('shows native model errors instead of swallowing the reason',async()=>{
 injected.ask.mockRejectedValue('模型回答格式不正确：示例错误')
 const wrapper=await mountSuspended(SuiteAiPanel,{global:{stubs:{VoiceInputButton:true}}});await flushPromises()
 await wrapper.find('.suite-ai-confirm').trigger('click');await flushPromises()
 expect(wrapper.get('[role="alert"]').text()).toContain('模型回答格式不正确')
 expect(injected.plan.setDraft).not.toHaveBeenCalled();wrapper.unmount()
})
beforeEach(()=>{
 localStorage.clear(); const doc=createDemoWorkspace();const task=doc.tasks[0]!
 injected.workspace={tasks:ref(doc.tasks),readLatestDocument:vi.fn().mockResolvedValue(doc),createTask:vi.fn(),updateTask:vi.fn()}
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
 expect(wrapper.find('[data-ai-composer-error]').text()).toContain('原计划')
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
