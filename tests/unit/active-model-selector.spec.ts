import { mountSuspended } from '@nuxt/test-utils/runtime'
import { expect,it } from 'vitest'
import ActiveModelSelector from '../../app/components/agent/ActiveModelSelector.vue'
import { loadAiModelTarget } from '../../app/services/ai-model-target'
it('activates a custom profile in settings without writing a credential', async()=>{
 const id='10000000-0000-4000-8000-000000000001'
 const w=await mountSuspended(ActiveModelSelector,{props:{profiles:[{id,name:'本机模型',modelId:'gemma',isLocal:true,hasCredential:false}] as any}})
 await w.get('select').setValue(`custom:${id}`)
 expect(loadAiModelTarget()).toEqual({kind:'custom',profileId:id})
 expect(w.find('input[type=password]').exists()).toBe(false)
 w.unmount()
})
