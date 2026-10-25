<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { aiErrorMessage, createAiGeneration, isPendingAiPlan, saveAiProposal } from '../../services/ai-generation'
import { loadAiModelTarget, saveAiModelTarget, DEFAULT_AI_MODEL_TARGET } from '../../services/ai-model-target'
import type { AiModelTarget } from '../../services/ai-model-target'
import { MINIMAX_MODELS, supportsMiniMaxImages } from '../../services/minimax-model'
import { listModelProviders } from '../../services/model-provider'
import type { ModelProviderProfile } from '../../services/model-provider'
import type { AgentAction } from '../../services/agent-plan-schema'
import { describeMiniMaxAgentAction } from '../../services/minimax-agent'
import VoiceInputButton from '../workspace/VoiceInputButton.vue'
import SuitePlanFields from './SuitePlanFields.vue'
import { addTaskAttachments } from '../../services/task-attachments'
import { clipboardImages } from '../../services/clipboard-images'
import type { TaskAttachment } from '#shared/workspace'
import { useAgentConversation } from '../../composables/useAgentConversation'
import AgentConversation from '../agent/AgentConversation.vue'
const images = ref<TaskAttachment[]>([])
const imageInput = ref<HTMLInputElement | null>(null)
const imageBusy = ref(false)
const allowImages = ref(false)
async function addImages(files: File[]) {
 if (imageBusy.value || busy.value || !files.length) return
 if (files.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type))) {error.value='图片分析支持 PNG、JPEG、WebP';return}
 if (images.value.length+files.length>4 || images.value.reduce((n,f)=>n+f.size,0)+files.reduce((n,f)=>n+f.size,0)>8*1024*1024) {error.value='一次最多 4 张图片，总大小不超过 8 MB';return}
 imageBusy.value=true; const generation=requestGeneration
 try {const result=await addTaskAttachments(images.value,files);if(generation===requestGeneration){images.value=result;allowImages.value=false}}
 catch(e){error.value=e instanceof Error?e.message:'图片添加失败'}finally{imageBusy.value=false}
}
function pasteImage(event:ClipboardEvent){const files=clipboardImages(event.clipboardData);if(files.length){event.preventDefault();void addImages(files)}}
async function selectImages(event:Event){const input=event.target as HTMLInputElement;await addImages(Array.from(input.files??[]));input.value=''}
const workspace=useWorkspace(); const route=useRoute(); const router=useRouter(); const plan=useAgentPlan(); const ui=useWorkspaceUi()
const chat = useAgentConversation()
const busy = chat.busy
const selectedIds=useState<string[]>('suite-inbox-selection',()=>[])
const inbox=computed(()=>route.path==='/inbox'); const prompt=ref(''); const summary=ref(''); const error=ref(''); const discarded=ref(false)
const target=ref<AiModelTarget>(DEFAULT_AI_MODEL_TARGET); const providers=ref<ModelProviderProfile[]>([])
let requestGeneration=0
onBeforeUnmount(()=>{requestGeneration++;chat.cancel()})
watch([()=>route.path,target],()=>{requestGeneration++;chat.cancel();allowImages.value=false;summary.value='';error.value='';discarded.value=false},{deep:true,flush:'sync'})
const pending=computed(()=>isPendingAiPlan(plan.draft.value)?plan.draft.value:null)
const titles=computed(()=>new Map(workspace.tasks.value.map(t=>[t.id,t.title])))
const selectedTarget=computed({get:()=>target.value.kind==='minimax'?`minimax:${target.value.modelId}`:`custom:${target.value.profileId}`,set:(value:string)=>{const [kind,id]=value.split(':'); target.value=saveAiModelTarget(kind==='minimax'?{kind,modelId:id}:{kind:'custom',profileId:id})}})
onMounted(async()=>{plan.loadDraft();target.value=loadAiModelTarget();try{providers.value=(await listModelProviders()).profiles}catch{/* Browser preview cannot access desktop registry. */}})
watch(()=>ui.miniMaxBriefRequest.value,()=>{prompt.value='请根据重要性、截止日期和预计时长，提出今天的任务安排计划，等我确认再写入。'})
function label(action:AgentAction){return describeMiniMaxAgentAction(action,titles.value)}
function timing(action:AgentAction){const payload=action.payload as Record<string,unknown>;return [payload.dueDate,payload.dueTime,payload.estimatedMinutes?`${payload.estimatedMinutes} 分钟`:null].filter(Boolean).join(' · ')}
async function generate(mode: 'plan' | 'message' = 'plan'){
 if(busy.value||imageBusy.value)return;error.value=''
 if(mode==='message'&&!prompt.value.trim()&&!images.value.length)return
 if(mode==='plan'&&pending.value){error.value='请先审阅现有计划；也可以在下方继续提问，原计划不会被覆盖。';return}
 if(images.value.length && !allowImages.value){error.value='请先确认允许把这些图片发送给所选模型。';return}
 if(images.value.length && target.value.kind==='minimax' && !supportsMiniMaxImages(target.value.modelId)){error.value='当前 MiniMax 模型不支持图片分析，请切换 M3.1 Flash、M3 或支持视觉的 OpenAI 兼容模型。';return}
 const question=prompt.value.trim() || (images.value.length?'请分析这些图片中的待办或已完成事项，提出新增任务或更新已有任务的建议；无法明确匹配时先询问。等我确认后再修改任务。':inbox.value?'请将这些收集箱记录整理成可执行任务，建议重要性、项目归属和日期。请更新已有任务，不重复创建。':'请为今天提出可执行的日程安排，考虑任务重要性、截止日期和预计时长。不要直接执行。')
 if(mode==='plan'&&inbox.value&&!selectedIds.value.length&&!images.value.length){error.value='请先选择要整理的记录，或添加图片。';return}
 const submittedPrompt=prompt.value
 const sent=await chat.send({question,target:target.value,images:images.value.map(i=>i.dataUrl),taskIds:inbox.value&&selectedIds.value.length&&!images.value.length?[...selectedIds.value]:undefined})
 if(sent){
   if(prompt.value===submittedPrompt)prompt.value=''
   images.value=[];allowImages.value=false
 }
}
async function confirm(){await chat.confirm()}
function postpone(){if(!discarded.value){discarded.value=true;return}plan.discardDraft();discarded.value=false;summary.value='已撤销这份建议，没有修改任务。'}
</script>
<template><section class="suite-ai" @paste="pasteImage"><header><h2><UIcon name="i-lucide-sparkles" />{{inbox?'AI 整理建议':'AI 计划助手'}}</h2><span>{{pending?'待你确认':'由你决定'}}</span></header><div class="suite-ai-scroll">
<p v-if="inbox" class="suite-hint">已选择 {{selectedIds.length}} 条记录</p>
<article v-if="!chat.log.messages.value.length" class="suite-ai-summary"><strong>{{inbox?'把零散事项，整理成下一步。':'先做重要的事，让计划更从容。'}}</strong><p>根据你的真实任务提出安排。你可以选择、调整，确认后才会写入。</p></article>
<AgentConversation :show-error="false" />
<section class="ai-image-input"><button type="button" :disabled="busy||imageBusy" @click="imageInput?.click()">添加图片 / Ctrl+V 粘贴</button><input ref="imageInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="selectImages"><div v-for="picture in images" :key="picture.id" class="ai-image-preview"><img :src="picture.dataUrl" :alt="picture.name"><button type="button" :disabled="busy||imageBusy" :aria-label="`移除图片 ${picture.name}`" @click="images=images.filter(i=>i.id!==picture.id);allowImages=false">移除</button></div><label v-if="images.length"><input v-model="allowImages" type="checkbox" :disabled="busy">允许发送以上图片给所选模型，分析新增或已完成事项；只生成建议，确认后才修改任务。</label></section>
<template v-if="!pending"><button class="suite-primary suite-ai-confirm" :disabled="busy||imageBusy" @click="generate('plan')">{{busy?'正在思考…':inbox?'生成整理建议':'生成日程建议'}}</button><p class="suite-hint">点击会将{{inbox?'所选任务及项目上下文':'工作区任务上下文'}}发送到所选模型。</p></template>
<details class="suite-ai-model"><summary>模型与连接</summary><select v-model="selectedTarget" aria-label="选择 AI 模型"><option v-for="model in MINIMAX_MODELS" :key="model.id" :value="`minimax:${model.id}`">MiniMax {{model.label}}</option><option v-for="profile in providers" :key="profile.id" :value="`custom:${profile.id}`">{{profile.name}} · {{profile.modelId}}</option></select><NuxtLink to="/settings?tab=models">管理模型 API</NuxtLink></details>
</div><div class="suite-ai-composer">
<p v-if="busy" data-ai-composer-status class="suite-ai-feedback" role="status">正在等待模型回复…本地模型首次加载可能较慢。</p>
<p v-if="error||chat.error.value" data-ai-composer-error class="suite-error suite-ai-feedback" role="alert">{{error||chat.error.value}}</p>
<form class="suite-ai-input" :aria-busy="busy" @submit.prevent="generate('message')"><UIcon name="i-lucide-sparkles" /><input v-model="prompt" aria-label="AI 计划要求" placeholder="输入问题或待办…" maxlength="1000"><VoiceInputButton @transcript="text=>prompt=[prompt,text].filter(Boolean).join(' ')" /><button type="submit" aria-label="发送计划要求" :disabled="busy||imageBusy||(!prompt.trim()&&!images.length)"><UIcon name="i-lucide-arrow-up" /></button></form>
</div></section></template>
<style scoped>
.ai-image-input{display:grid;gap:10px;margin:14px 0;font-size:13px}.ai-image-input>button{padding:9px;border:1px dashed #afa1ed;border-radius:8px;color:#6850c8}.ai-image-preview{display:flex;align-items:center;justify-content:space-between;gap:8px}.ai-image-preview img{max-width:150px;max-height:100px;object-fit:contain;border-radius:6px}.ai-image-input label{line-height:1.6}
.suite-ai-composer{flex:0 0 auto;min-height:0}.suite-ai-feedback{margin:8px 20px;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.suite-ai-conversation{max-height:28dvh;overflow:auto;margin:8px 20px;padding:10px;border:1px solid #e7e0f5;border-radius:10px;background:#fff}.suite-ai-conversation p{display:grid;gap:4px;margin:0 0 12px;font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.suite-ai-conversation p:last-child{margin-bottom:0}.suite-ai-conversation strong{font-size:12px;color:#7961ba}.suite-ai-conversation .user{padding:8px;background:#f5f1ff;border-radius:8px}.suite-ai-input button:disabled{opacity:.5;cursor:not-allowed}
</style>
