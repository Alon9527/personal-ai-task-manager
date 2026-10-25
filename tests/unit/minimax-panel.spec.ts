import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
enableAutoUnmount(afterEach)
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import ContextPanel from '../../app/components/app/ContextPanel.vue'
import Settings from '../../app/pages/settings.vue'
import { saveAiModelTarget } from '../../app/services/ai-model-target'
import { flushPromises } from '@vue/test-utils'

const minimaxMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  saveKey: vi.fn(),
  setRegion: vi.fn(),
  removeKey: vi.fn(),
  generateBrief: vi.fn(),
  ask: vi.fn(),
}))

const providerMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  replaceCredential: vi.fn(),
  remove: vi.fn(),
  retryCleanup: vi.fn(),
  testConnection: vi.fn(),
}))

vi.mock('../../app/services/minimax', async () => {
  const actual = await vi.importActual<typeof import('../../app/services/minimax')>(
    '../../app/services/minimax',
  )
  return {
    ...actual,
    getMiniMaxStatus: minimaxMocks.getStatus,
    saveMiniMaxApiKey: minimaxMocks.saveKey,
    setMiniMaxRegion: minimaxMocks.setRegion,
    removeMiniMaxApiKey: minimaxMocks.removeKey,
    generateAiBrief: minimaxMocks.generateBrief,
    askAi: minimaxMocks.ask,
  }
})

vi.mock('../../app/services/model-provider', async () => {
  const actual = await vi.importActual<typeof import('../../app/services/model-provider')>(
    '../../app/services/model-provider',
  )
  return {
    ...actual,
    listModelProviders: providerMocks.list,
    createModelProvider: providerMocks.create,
    updateModelProvider: providerMocks.update,
    replaceModelProviderCredential: providerMocks.replaceCredential,
    deleteModelProvider: providerMocks.remove,
    retryModelProviderCredentialCleanup: providerMocks.retryCleanup,
    testModelProviderConnection: providerMocks.testConnection,
  }
})

const configuredStatus = {
  connectionRevision: 'synthetic-session',
  available: true,
  configured: true,
  model: 'MiniMax-M2.7',
  credentialStore: 'windows-credential-manager' as const,
  region: 'cn' as const,
}

const PROFILE_ID = '123e4567-e89b-42d3-a456-426614174000'
const LOCAL_PROFILE_ID = '223e4567-e89b-42d3-a456-426614174000'

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    name: '团队网关',
    baseUrl: 'https://ai.example.com/v1',
    modelId: 'qwen3-coder',
    credentialGeneration: 0,
    hasCredential: true,
    isLocal: false,
    createdAt: '2026-08-14T08:00:00.000Z',
    updatedAt: '2026-08-14T08:00:00.000Z',
    ...overrides,
  }
}


describe('chat-first model settings and sidebar', () => {
  beforeEach(async()=>{
    localStorage.clear();localStorage.setItem('personal-ai-workspace:v1',JSON.stringify(createDemoWorkspace()))
    vi.clearAllMocks()
    providerMocks.list.mockResolvedValue({profiles:[],pendingCredentialDeletes:[]})
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    minimaxMocks.saveKey.mockResolvedValue(configuredStatus);minimaxMocks.setRegion.mockResolvedValue(configuredStatus)
    minimaxMocks.ask.mockResolvedValue({answer:'正常回答',actions:[],sources:[],generatedAt:'2026-10-26T00:00:00.000Z',model:'test',usage:null})
    minimaxMocks.generateBrief.mockResolvedValue({focus:'先处理重点',progress:[],suggestion:null,sources:[{taskId:'task-1',title:'真实任务',projectName:null}],model:'test',generatedAt:'2026-10-26T00:00:00.000Z',usage:null})
    const { defineComponent }=await import('vue')
    const { useAgentConversation }=await import('../../app/composables/useAgentConversation')
    const reset=await mountSuspended(defineComponent({setup(){useAgentConversation().cancel();useAgentConversation().reset(true);return()=>null}}));reset.unmount()
  })
  async function mountPanel(){const w=await mountSuspended(ContextPanel);await flushPromises();return w}
  it('deletes a built-in credential only after explicit confirmation and updates sidebar readiness',async()=>{
    const panel=await mountPanel()
    const w=await mountSuspended(Settings,{route:'/settings?tab=models'});await flushPromises()
    await w.get('[data-remove-minimax-key]').trigger('click');await flushPromises()
    expect(minimaxMocks.removeKey).not.toHaveBeenCalled()
    await w.get('[data-cancel-remove-minimax-key]').trigger('click');await flushPromises()
    expect(minimaxMocks.removeKey).not.toHaveBeenCalled()
    await w.get('[data-remove-minimax-key]').trigger('click');await flushPromises()
    minimaxMocks.removeKey.mockResolvedValue({...configuredStatus,configured:false})
    minimaxMocks.getStatus.mockResolvedValue({...configuredStatus,configured:false})
    await w.get('[data-confirm-remove-minimax-key]').trigger('click');await flushPromises()
    expect(minimaxMocks.removeKey).toHaveBeenCalledOnce()
    expect(panel.get('[data-model-unavailable]').text()).toContain('尚未配置')
    expect(minimaxMocks.ask).not.toHaveBeenCalled()
  })
  it('removes duplicate model configuration and directs unconfigured users to settings',async()=>{
    minimaxMocks.getStatus.mockResolvedValue({...configuredStatus,configured:false})
    const w=await mountPanel()
    expect(w.get('[data-model-unavailable]').text()).toContain('前往设置')
    expect(w.get('[data-model-unavailable] a').attributes('href')).toBe('/settings?tab=models')
    expect(w.find('select').exists()).toBe(false);expect(w.find('input[type=password]').exists()).toBe(false)
    expect(minimaxMocks.ask).not.toHaveBeenCalled();expect(minimaxMocks.generateBrief).not.toHaveBeenCalled()
  })
  it('preserves credential configuration in settings, not in chat',async()=>{
    minimaxMocks.getStatus.mockResolvedValue({...configuredStatus,configured:false})
    const w=await mountSuspended(Settings,{route:'/settings?tab=models'});await flushPromises()
    await w.get('.suite-settings-form input[type=password]').setValue('synthetic-test-not-real')
    await w.get('.suite-settings-form').trigger('submit');await flushPromises()
    expect(minimaxMocks.saveKey).toHaveBeenCalledWith('synthetic-test-not-real','cn')
    expect((w.get('.suite-settings-form input[type=password]').element as HTMLInputElement).value).toBe('')
    expect(minimaxMocks.ask).not.toHaveBeenCalled()
  })
  it('keeps legacy model selection and uses it without an inline model selector',async()=>{
    localStorage.setItem('personal-ai-minimax-model:v1','MiniMax-M2.5')
    const w=await mountPanel();await w.get('.ask-ai input').setValue('你好');await w.get('.ask-ai').trigger('submit');await flushPromises()
    expect(minimaxMocks.ask).toHaveBeenCalledWith(expect.any(Object),'你好',{kind:'minimax',modelId:'MiniMax-M2.5'})
    expect(w.find('[data-minimax-model]').exists()).toBe(false)
  })
  it.each([
    [profile({id:LOCAL_PROFILE_ID,isLocal:true,hasCredential:false,baseUrl:'http://localhost:11434/v1'}),true],
    [profile(),true],[profile({hasCredential:false}),false],
  ] as const)('derives readiness from the selected custom profile %#',async(p,ready)=>{
    providerMocks.list.mockResolvedValue({profiles:[p],pendingCredentialDeletes:[]})
    saveAiModelTarget({kind:'custom',profileId:p.id})
    const w=await mountPanel()
    expect(w.find('[data-generate-minimax-brief]').exists()).toBe(ready)
    expect(w.find('[data-model-unavailable]').exists()).toBe(!ready)
  })
  it('requires region confirmation in settings, without calling a model',async()=>{
    minimaxMocks.getStatus.mockResolvedValue({...configuredStatus,region:null})
    const w=await mountPanel()
    expect(w.get('[data-model-unavailable]').text()).toContain('服务区域')
    expect(w.find('[data-generate-minimax-brief]').exists()).toBe(false)
    expect(minimaxMocks.generateBrief).not.toHaveBeenCalled()
  })
  it('generates a sourced brief on click and keeps it after remount',async()=>{
    const w=await mountPanel()
    expect(w.get('.ask-ai [data-voice-input]').exists()).toBe(true)
    expect(minimaxMocks.generateBrief).not.toHaveBeenCalled()
    await w.get('[data-generate-minimax-brief]').trigger('click');await flushPromises()
    expect(w.get('[role=log]').text()).toContain('先处理重点')
    expect(w.get('[role=log]').text()).toContain('真实任务')
    w.unmount();const restored=await mountPanel()
    expect(restored.get('[role=log]').text()).toContain('先处理重点')
    expect(minimaxMocks.generateBrief).toHaveBeenCalledOnce()
  })
  it('does not silently fall back to a paid model after a profile disappears',async()=>{
    providerMocks.list.mockResolvedValue({profiles:[profile()],pendingCredentialDeletes:[]})
    saveAiModelTarget({kind:'custom',profileId:PROFILE_ID})
    const w=await mountPanel()
    providerMocks.list.mockResolvedValue({profiles:[],pendingCredentialDeletes:[]})
    window.dispatchEvent(new Event('focus-ai-model-changed'));await flushPromises()
    expect(w.get('[data-model-unavailable]').text()).toContain('不可用')
    expect(JSON.parse(localStorage.getItem('personal-ai-model-selection:v2')!).kind).toBe('custom')
    expect(minimaxMocks.ask).not.toHaveBeenCalled()
  })
  it('keeps newer profile reads when an older read resolves late',async()=>{
    let finish!:(v:any)=>void
    providerMocks.list.mockReturnValueOnce(new Promise(r=>{finish=r}))
    saveAiModelTarget({kind:'custom',profileId:PROFILE_ID})
    const w=await mountSuspended(ContextPanel)
    providerMocks.list.mockResolvedValue({profiles:[profile()],pendingCredentialDeletes:[]})
    window.dispatchEvent(new Event('focus-ai-model-changed'));await flushPromises()
    finish({profiles:[],pendingCredentialDeletes:[]});await flushPromises()
    expect(w.find('[data-model-unavailable]').exists()).toBe(false)
    expect(w.find('[data-generate-minimax-brief]').exists()).toBe(true)
  })
  it.each(['baseUrl','credentialGeneration','updatedAt'] as const)('ignores a late reply after selected profile %s changes',async(field)=>{
    let finish!:(v:any)=>void
    providerMocks.list.mockResolvedValue({profiles:[profile()],pendingCredentialDeletes:[]})
    saveAiModelTarget({kind:'custom',profileId:PROFILE_ID})
    minimaxMocks.ask.mockReturnValueOnce(new Promise(r=>{finish=r}))
    const w=await mountPanel();await w.get('.ask-ai input').setValue('分析');await w.get('.ask-ai').trigger('submit');await flushPromises()
    providerMocks.list.mockResolvedValue({profiles:[profile({[field]:field==='credentialGeneration'?1:field==='baseUrl'?'https://changed.example.com/v1':'2026-10-26T00:00:00Z'})],pendingCredentialDeletes:[]})
    window.dispatchEvent(new Event('focus-ai-model-changed'));await flushPromises()
    finish({answer:'过时回答',actions:[],sources:[],model:'test',generatedAt:'2026-10-26T00:00:00Z',usage:null});await flushPromises()
    expect(w.text()).not.toContain('过时回答')
  })
  it.each(['region','configured'] as const)('cancels a pending built-in reply after settings %s changes',async(field)=>{
    let finish!:(v:any)=>void
    minimaxMocks.ask.mockReturnValueOnce(new Promise(r=>{finish=r}))
    const w=await mountPanel();await w.get('.ask-ai input').setValue('分析');await w.get('.ask-ai').trigger('submit');await flushPromises()
    minimaxMocks.getStatus.mockResolvedValue({...configuredStatus,[field]:field==='region'?'global':false})
    window.dispatchEvent(new Event('focus-ai-model-changed'));await flushPromises()
    finish({answer:'过时回答',actions:[],sources:[],model:'test',generatedAt:'2026-10-26T00:00:00Z',usage:null});await flushPromises()
    expect(w.text()).not.toContain('过时回答')
  })
  it('shows a changed-model consent prompt before transmitting existing history',async()=>{
    const w=await mountPanel();await w.get('.ask-ai input').setValue('你好');await w.get('.ask-ai').trigger('submit');await flushPromises()
    saveAiModelTarget({kind:'minimax',modelId:'MiniMax-M2.7'});await flushPromises()
    await w.get('.ask-ai input').setValue('继续');await w.get('.ask-ai').trigger('submit');await flushPromises()
    expect(minimaxMocks.ask).toHaveBeenCalledOnce();expect(w.text()).toContain('允许发送历史')
  })
  it('contains no direct execution or workspace write path in the sidebar',async()=>{
    const source=await readFile(resolve('app/components/suite/SuiteAiPanel.vue'),'utf8')
    expect(source).not.toMatch(/workspace\.(createTask|updateTask|replaceWorkspaceDocument)\(/)
    expect(source).not.toContain('requestExecution(')
  })
})
