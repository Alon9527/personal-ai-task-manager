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
