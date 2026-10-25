<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { loadAiModelTarget, DEFAULT_AI_MODEL_TARGET, customTargetInfo } from '../../services/ai-model-target'
import type { AiModelTarget } from '../../services/ai-model-target'
import { supportsMiniMaxImages } from '../../services/minimax-model'
import { getMiniMaxStatus } from '../../services/minimax'
import type { MiniMaxStatus } from '../../services/minimax'
import { listModelProviders } from '../../services/model-provider'
import type { ModelProviderProfile } from '../../services/model-provider'
import VoiceInputButton from '../workspace/VoiceInputButton.vue'
import { addTaskAttachments } from '../../services/task-attachments'
import { clipboardImages } from '../../services/clipboard-images'
import type { TaskAttachment } from '#shared/workspace'
import { useAgentConversation } from '../../composables/useAgentConversation'
import AgentConversation from '../agent/AgentConversation.vue'
import GoalContextPicker from '../agent/GoalContextPicker.vue'

const props = defineProps<{ contextMode?: boolean }>()
const route=useRoute(), plan=useAgentPlan(), ui=useWorkspaceUi(), chat=useAgentConversation()
const busy=computed(()=>chat.busy.value || plan.executing.value)
const selectedIds=useState<string[]>('suite-inbox-selection',()=>[])
const inbox=computed(()=>route.path==='/inbox')
const prompt=ref(''), error=ref(''), loading=ref(true)
const promptInput=ref<HTMLInputElement|null>(null)
const target=ref<AiModelTarget>(DEFAULT_AI_MODEL_TARGET), providers=ref<ModelProviderProfile[]>([])
const status=ref<MiniMaxStatus|null>(null)
const images=ref<TaskAttachment[]>([]), imageInput=ref<HTMLInputElement|null>(null)
const imageBusy=ref(false), allowImages=ref(false)
const pending=computed(()=>chat.pending.value)
const ready=computed(()=>!loading.value && (target.value.kind==='custom'
  ? customTargetInfo(target.value.profileId,providers.value).ready
  : Boolean(status.value?.available && status.value.configured && status.value.region)))
const unavailable=computed(()=>target.value.kind==='custom'
  ? '所选模型 API 不可用或需要 API Key，请前往设置检查。'
  : !status.value?.available ? '请使用 Windows 桌面版配置模型。'
  : !status.value.configured ? '尚未配置模型，请前往设置。'
  : '请在设置中确认 API Key 对应的服务区域。')
let requestGeneration=0, refreshGeneration=0, disposed=false, connectionSnapshot=''
function invalidate(){requestGeneration++;chat.cancel();allowImages.value=false;error.value=''}
async function refresh(){
  const revision=++refreshGeneration
  try {
    const saved=loadAiModelTarget()
    if(JSON.stringify(saved)!==JSON.stringify(target.value)){invalidate();target.value=saved}
    const [s,p]=await Promise.allSettled([getMiniMaxStatus(),listModelProviders()])
    if(disposed || revision!==refreshGeneration)return
    status.value=s.status==='fulfilled'?s.value:null
    providers.value=p.status==='fulfilled'?p.value.profiles:[]
    const selected=target.value.kind==='custom'?providers.value.find(v=>v.id===(target.value as {profileId:string}).profileId):status.value
    const fingerprint=JSON.stringify([target.value,selected])
    if(connectionSnapshot && connectionSnapshot!==fingerprint) invalidate()
    connectionSnapshot=fingerprint
    const failure=target.value.kind==='minimax'?s:p
    if(failure.status==='rejected')error.value=failure.reason instanceof Error?failure.reason.message:'无法读取模型配置，请前往设置。'
  }catch(cause){error.value=cause instanceof Error?cause.message:'无法读取模型配置。'}
  finally{if(!disposed && revision===refreshGeneration)loading.value=false}
}
function changed(){loading.value=true;void refresh()}
function storageChanged(event:StorageEvent){if(!event.key || event.key==='personal-ai-model-selection:v2')changed()}
onMounted(()=>{
  chat.load();void refresh()
  window.addEventListener('focus-ai-model-changed',changed)
  window.addEventListener('storage',storageChanged)
  window.addEventListener('focus',refresh)
  const state=window.history.state
  if(typeof state?.agentReplanQuestion==='string' && state.agentReplanNonce){
    prompt.value=state.agentReplanQuestion
    const next={...state};delete next.agentReplanQuestion;delete next.agentReplanNonce
    window.history.replaceState(next,'',window.location.href)
    void nextTick(()=>promptInput.value?.focus())
  }
})
onBeforeUnmount(()=>{disposed=true;refreshGeneration++;invalidate();window.removeEventListener('focus-ai-model-changed',changed);window.removeEventListener('storage',storageChanged);window.removeEventListener('focus',refresh)})
watch(()=>route.path,()=>{invalidate();void refresh()},{flush:'sync'})
watch(()=>ui.miniMaxBriefRequest.value,()=>{if(ready.value)void chat.generateBrief(target.value);else error.value='请先在设置中配置可用模型。'})
async function addImages(files:File[]){
  if(imageBusy.value || busy.value || !files.length)return
  if(files.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type))){error.value='图片分析支持 PNG、JPEG、WebP';return}
  if(images.value.length+files.length>4 || images.value.reduce((n,f)=>n+f.size,0)+files.reduce((n,f)=>n+f.size,0)>8*1024*1024){error.value='一次最多 4 张图片，总大小不超过 8 MB';return}
  imageBusy.value=true;const generation=requestGeneration
  try{const result=await addTaskAttachments(images.value,files);if(generation===requestGeneration){images.value=result;allowImages.value=false}}
  catch(cause){error.value=cause instanceof Error?cause.message:'图片添加失败'}
  finally{imageBusy.value=false}
}
function pasteImage(event:ClipboardEvent){const files=clipboardImages(event.clipboardData);if(files.length){event.preventDefault();void addImages(files)}}
async function selectImages(event:Event){const input=event.target as HTMLInputElement;await addImages(Array.from(input.files??[]));input.value=''}
async function generate(mode:'plan'|'message'='plan'){
  if(busy.value||imageBusy.value)return
  error.value=''
  if(!ready.value){error.value=unavailable.value;return}
  if(mode==='message'&&!prompt.value.trim()&&!images.value.length)return
  if(mode==='plan'&&pending.value){error.value='请先审阅现有计划；也可以在下方继续提问，原计划不会被覆盖。';return}
  if(images.value.length&&!allowImages.value){error.value='请先确认允许把这些图片发送给所选模型。';return}
  if(images.value.length&&target.value.kind==='minimax'&&!supportsMiniMaxImages(target.value.modelId)){error.value='当前 MiniMax 模型不支持图片分析，请在设置中切换 M3.1 Flash、M3 或支持视觉的 OpenAI 兼容模型。';return}
  const question=prompt.value.trim() || (images.value.length?'请分析这些图片中的待办或已完成事项，提出新增任务或更新已有任务的建议；无法明确匹配时先询问。等我确认后再修改任务。':inbox.value?'请将这些收集箱记录整理成可执行任务，建议重要性、项目归属和日期。请更新已有任务，不重复创建。':'请为今天提出可执行的日程安排，考虑任务重要性、截止日期和预计时长。不要直接执行。')
  if(mode==='plan'&&inbox.value&&!selectedIds.value.length&&!images.value.length){error.value='请先选择要整理的记录，或添加图片。';return}
  const submitted=prompt.value
  const sent=await chat.send({question,target:target.value,images:images.value.map(i=>i.dataUrl),taskIds:inbox.value&&selectedIds.value.length&&!images.value.length?[...selectedIds.value]:undefined})
  if(sent){if(prompt.value===submitted)prompt.value='';images.value=[];allowImages.value=false}
}
async function generateBrief(){error.value='';if(ready.value&&!imageBusy.value)await chat.generateBrief(target.value)}
</script>
<template>
  <section class="suite-ai chat-first-panel" data-minimax-panel @paste="pasteImage">
    <AgentConversation :show-error="false" :title="inbox?'AI 整理助手':'AI 助手'">
      <template #shortcuts>
        <div class="chat-shortcuts">
          <span v-if="loading" role="status">正在读取本机配置…</span>
          <div v-else-if="!ready" class="chat-setup" data-model-unavailable><span>{{ unavailable }}</span> <NuxtLink to="/settings?tab=models">前往设置</NuxtLink></div>
          <template v-else>
            <button type="button" data-generate-minimax-brief :disabled="busy||imageBusy" @click="generateBrief"><UIcon name="i-lucide-file-text" />生成今日简报</button>
            <button v-if="!props.contextMode" type="button" data-generate-plan :disabled="busy||imageBusy" @click="generate('plan')">{{inbox?'整理所选记录':'生成日程建议'}}</button>
          </template>
          <small v-if="inbox">已选择 {{selectedIds.length}} 条记录</small>
        </div>
      </template>
      <template #composer>
        <div class="suite-ai-composer">
          <p v-if="busy" data-ai-composer-status class="suite-ai-feedback" role="status">正在等待处理…本地模型首次加载可能较慢。</p>
          <p v-if="error||chat.error.value" data-ai-composer-error class="suite-error suite-ai-feedback" role="alert">{{error||chat.error.value}}</p>
          <GoalContextPicker />
          <section v-if="images.length" class="ai-image-input">
            <div class="image-strip"><div v-for="picture in images" :key="picture.id" class="ai-image-preview"><img :src="picture.dataUrl" :alt="picture.name"><button type="button" :disabled="busy||imageBusy" :aria-label="`移除图片 ${picture.name}`" @click="images=images.filter(i=>i.id!==picture.id);allowImages=false">移除</button></div></div>
            <label><input v-model="allowImages" type="checkbox" :disabled="busy">允许发送这些图片给所选模型，确认后才修改任务。</label>
          </section>
          <form class="suite-ai-input" :class="{'ask-ai':props.contextMode}" :aria-busy="busy" @submit.prevent="generate('message')">
            <input ref="promptInput" v-model="prompt" :disabled="busy" aria-label="AI 计划要求" placeholder="输入问题，或描述要调整的任务…" maxlength="1000">
            <div class="composer-actions"><button type="button" aria-label="添加图片" :disabled="busy||imageBusy" @click="imageInput?.click()"><UIcon name="i-lucide-image" /></button><VoiceInputButton @transcript="text=>prompt=[prompt,text].filter(Boolean).join(' ')" /><button type="submit" aria-label="发送计划要求" :disabled="busy||imageBusy||!ready||(!prompt.trim()&&!images.length)"><UIcon name="i-lucide-arrow-up" /></button></div>
          </form>
          <input ref="imageInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="selectImages">
          <small class="composer-privacy">点击发送才调用模型 · 确认后才修改任务或目标</small>
        </div>
      </template>
    </AgentConversation>
  </section>
</template>
<style scoped>
.chat-first-panel{height:100dvh;min-height:0;overflow:hidden;position:sticky;top:0;background:linear-gradient(160deg,#f4f0ff,#faf8ff)}
.chat-shortcuts{display:flex;flex-wrap:wrap;gap:8px;padding:0 18px 12px;font-size:12px;flex:0 0 auto}.chat-shortcuts>button{display:flex;align-items:center;gap:5px;border:1px solid #e1d8fa;border-radius:7px;background:#fff;padding:7px 10px;color:#624bc4;cursor:pointer}.chat-shortcuts small{flex-basis:100%;color:#777b8d}.chat-setup{line-height:1.6}.chat-setup a{color:#7750ff;text-decoration:underline}
.suite-ai-composer{flex:0 0 auto;min-height:0;border-top:1px solid #e9e3f6;padding:10px 16px 12px;background:#faf8ff}.suite-ai-input{display:block;padding:10px;margin:8px 0 0;border:1px solid #ded8eb;border-radius:12px;background:white}.suite-ai-input>input{width:100%;min-height:34px;font-size:13px;padding:2px 4px}.composer-actions{display:flex;align-items:center;gap:10px;margin-top:4px}.composer-actions>button{display:flex;align-items:center;justify-content:center;border:0;border-radius:7px;padding:6px;background:transparent;color:#73718a;font-size:19px;cursor:pointer}.composer-actions>button[type=submit]{margin-left:auto;background:#7750ff;color:#fff;width:32px;height:32px}.composer-privacy{display:block;text-align:center;color:#9390a5;font-size:10px;margin-top:6px}.suite-ai-feedback{margin:0 0 8px;font-size:12px;line-height:1.5;overflow-wrap:anywhere;max-height:80px;overflow:auto}.suite-error{color:#b94148}
.ai-image-input{font-size:11px;margin-top:8px;color:#6f6980}.ai-image-input label{display:flex;align-items:start;gap:6px;line-height:1.4}.image-strip{display:flex;gap:8px;overflow-x:auto;margin-bottom:5px}.ai-image-preview{display:flex;gap:4px;align-items:center;flex:0 0 auto}.ai-image-preview img{width:42px;height:36px;object-fit:cover;border-radius:5px}.ai-image-preview button{background:none;border:0;color:#a34d60;font-size:11px}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,input:focus-visible{outline:2px solid #7750ff;outline-offset:2px}
@media(max-width:1100px){.suite-shell .chat-first-panel{height:85dvh;min-height:480px}}
</style>
