<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, toRaw, watch } from 'vue'
import { askAi, buildMiniMaxWorkspaceContext } from '../../services/minimax'
import { loadAiModelTarget, saveAiModelTarget, DEFAULT_AI_MODEL_TARGET } from '../../services/ai-model-target'
import type { AiModelTarget } from '../../services/ai-model-target'
import { MINIMAX_MODELS } from '../../services/minimax-model'
import { listModelProviders } from '../../services/model-provider'
import type { ModelProviderProfile } from '../../services/model-provider'
import { agentPlanDraftSchema } from '../../services/agent-plan-schema'
import type { AgentAction } from '../../services/agent-plan-schema'
import { describeMiniMaxAgentAction } from '../../services/minimax-agent'
import VoiceInputButton from '../workspace/VoiceInputButton.vue'
import SuitePlanFields from './SuitePlanFields.vue'
import { addTaskAttachments } from '../../services/task-attachments'
import { clipboardImages } from '../../services/clipboard-images'
import type { TaskAttachment } from '#shared/workspace'
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
const selectedIds=useState<string[]>('suite-inbox-selection',()=>[])
const inbox=computed(()=>route.path==='/inbox'); const prompt=ref(''); const summary=ref(''); const error=ref(''); const busy=ref(false); const discarded=ref(false)
const target=ref<AiModelTarget>(DEFAULT_AI_MODEL_TARGET); const providers=ref<ModelProviderProfile[]>([])
let requestGeneration=0
onBeforeUnmount(()=>{requestGeneration++})
watch([()=>route.path,target],()=>{requestGeneration++;busy.value=false;allowImages.value=false},{deep:true})
const pending=computed(()=>plan.draft.value && !['applied','discarded'].includes(plan.draft.value.status)?plan.draft.value:null)
const titles=computed(()=>new Map(workspace.tasks.value.map(t=>[t.id,t.title])))
const selectedTarget=computed({get:()=>target.value.kind==='minimax'?`minimax:${target.value.modelId}`:`custom:${target.value.profileId}`,set:(value:string)=>{const [kind,id]=value.split(':'); target.value=saveAiModelTarget(kind==='minimax'?{kind,modelId:id}:{kind:'custom',profileId:id})}})
onMounted(async()=>{plan.loadDraft();target.value=loadAiModelTarget();try{providers.value=(await listModelProviders()).profiles}catch{/* Browser preview cannot access desktop registry. */}})
watch(()=>ui.miniMaxBriefRequest.value,()=>{prompt.value='请根据重要性、截止日期和预计时长，提出今天的任务安排计划，等我确认再写入。'})
function label(action:AgentAction){return describeMiniMaxAgentAction(action,titles.value)}
function timing(action:AgentAction){const payload=action.payload as Record<string,unknown>;return [payload.dueDate,payload.dueTime,payload.estimatedMinutes?`${payload.estimatedMinutes} 分钟`:null].filter(Boolean).join(' · ')}
async function generate(){
 if(busy.value||imageBusy.value)return;error.value=''; if(pending.value){error.value='请先确认或暂存审阅现有计划，避免覆盖未处理的建议。';return}
 if(images.value.length && !allowImages.value){error.value='请先确认允许把这些图片发送给所选模型。';return}
 if(images.value.length && target.value.kind!=='custom'){error.value='图片分析请选择支持视觉的 OpenAI 兼容模型；当前内置 MiniMax 接入未启用图片输入。';return}
 const question=prompt.value.trim() || (inbox.value?'请将这些收集箱记录整理成可执行任务，建议重要性、项目归属和日期。请更新已有任务，不重复创建。':'请为今天提出可执行的日程安排，考虑任务重要性、截止日期和预计时长。不要直接执行。')
 if(inbox.value&&!selectedIds.value.length&&!images.value.length){error.value='请先选择要整理的记录，或添加图片。';return}
 busy.value=true; const generation=++requestGeneration
 const requestTarget=structuredClone(toRaw(target.value)); const requestImages=images.value.map(i=>i.dataUrl); const requestInbox=inbox.value;const requestIds=[...selectedIds.value]
 try{const document=await workspace.readLatestDocument();if(generation!==requestGeneration)return;const context=buildMiniMaxWorkspaceContext({...document,tasks:requestInbox&&!requestImages.length?document.tasks.filter(t=>requestIds.includes(t.id)):document.tasks}); const response=await askAi(context,question,requestTarget,...(requestImages.length?[requestImages]:[]))
 if(generation!==requestGeneration)return
 summary.value=response.answer
 if(response.actions.length){if(pending.value)throw new Error('已有其他待确认计划，请先审阅。');const draft=agentPlanDraftSchema.parse({version:1,id:crypto.randomUUID(),question,model:response.model,createdAt:response.generatedAt,updatedAt:response.generatedAt,status:'draft',actions:response.actions,validation:{executable:false,selectedCount:0,dangerousCount:0,estimatedMinutes:0,issueCount:0,issues:[]}});if(!plan.setDraft(draft))throw new Error(plan.error.value??'计划保存失败')}
 prompt.value=''
 images.value=[];allowImages.value=false
 }catch(e){if(generation===requestGeneration)error.value=e instanceof Error?e.message:typeof e==='string'?e:'生成失败，请重试'}finally{if(generation===requestGeneration)busy.value=false}
}
async function confirm(){error.value='';const result=await plan.requestExecution();if(['executed','already-applied','applied-cleanup-failed'].includes(result.status)){summary.value='已将确认的计划写入任务。';return}error.value=plan.error.value??'计划需进一步审阅，请检查关联、冲突或危险操作。';await router.push('/agent-plan')}
function postpone(){if(!discarded.value){discarded.value=true;return}plan.discardDraft();discarded.value=false;summary.value='已撤销这份建议，没有修改任务。'}
</script>
<template><section class="suite-ai" @paste="pasteImage"><header><h2><UIcon name="i-lucide-sparkles" />{{inbox?'AI 整理建议':'AI 计划助手'}}</h2><span>{{pending?'待你确认':'由你决定'}}</span></header><div class="suite-ai-scroll">
<p v-if="inbox" class="suite-hint">已选择 {{selectedIds.length}} 条记录</p>
<article class="suite-ai-summary"><strong>{{pending?'先审阅建议，再落入日程。':inbox?'把零散事项，整理成下一步。':'先做重要的事，让计划更从容。'}}</strong><p>{{summary || (pending?'上次计划仍在等待确认，可继续调整或执行。':'根据你的真实任务提出安排。你可以选择、调整，确认后才会写入。')}}</p></article>
<p v-if="error" class="suite-error" role="alert">{{error}}</p>
<section class="ai-image-input"><button type="button" :disabled="busy||imageBusy" @click="imageInput?.click()">添加图片 / Ctrl+V 粘贴</button><input ref="imageInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="selectImages"><div v-for="picture in images" :key="picture.id" class="ai-image-preview"><img :src="picture.dataUrl" :alt="picture.name"><button type="button" :disabled="busy||imageBusy" :aria-label="`移除图片 ${picture.name}`" @click="images=images.filter(i=>i.id!==picture.id);allowImages=false">移除</button></div><label v-if="images.length"><input v-model="allowImages" type="checkbox" :disabled="busy">允许发送以上图片给所选模型，分析新增或已完成事项；只生成建议，确认后才修改任务。</label></section>
<template v-if="pending"><h3>{{inbox?'建议整理为以下任务':'为你推荐以下日程安排'}}</h3><article v-for="action in pending.actions" :key="action.actionId" class="suite-plan-card"><input type="checkbox" :checked="action.selected" :aria-label="`选择建议：${label(action)}`" @change="plan.toggleAction(action.actionId,($event.target as HTMLInputElement).checked)"><div><strong>{{timing(action)||'待安排时间'}}</strong><p>{{label(action)}}</p><SuitePlanFields :action="action" :inbox="inbox" /><small v-if="action.dangerous">此操作需额外确认</small></div><NuxtLink to="/agent-plan" aria-label="调整建议"><UIcon name="i-lucide-pencil" /></NuxtLink></article>
<p v-if="plan.validation.value?.issues.length" class="suite-hint">有 {{plan.validation.value.issues.length}} 项需要在审阅页检查。</p><button class="suite-primary suite-ai-confirm" :disabled="plan.executing.value||!pending.actions.some(a=>a.selected)" @click="confirm">{{plan.executing.value?'正在执行…':inbox?'确认整理任务':'确认加入日程'}}</button><NuxtLink class="suite-ai-adjust" to="/agent-plan">调整计划</NuxtLink><button class="suite-text" @click="postpone">{{discarded?'再次点击撤销建议':'暂不采用'}}</button></template>
<template v-else><button class="suite-primary suite-ai-confirm" :disabled="busy" @click="generate">{{busy?'正在思考…':inbox?'生成整理建议':'生成日程建议'}}</button><p class="suite-hint">点击会将{{inbox?'所选任务及项目上下文':'工作区任务上下文'}}发送到所选模型。</p></template>
<details class="suite-ai-model"><summary>模型与连接</summary><select v-model="selectedTarget" aria-label="选择 AI 模型"><option v-for="model in MINIMAX_MODELS" :key="model.id" :value="`minimax:${model.id}`">MiniMax {{model.label}}</option><option v-for="profile in providers" :key="profile.id" :value="`custom:${profile.id}`">{{profile.name}} · {{profile.modelId}}</option></select><NuxtLink to="/settings?tab=models">管理模型 API</NuxtLink></details>
</div><form class="suite-ai-input" @submit.prevent="generate"><UIcon name="i-lucide-sparkles" /><input v-model="prompt" aria-label="AI 计划要求" placeholder="输入或说出你的待办…"><VoiceInputButton @transcript="text=>prompt=[prompt,text].filter(Boolean).join(' ')" /><button aria-label="发送计划要求" :disabled="busy"><UIcon name="i-lucide-arrow-up" /></button></form></section></template>
<style scoped>
.ai-image-input{display:grid;gap:10px;margin:14px 0;font-size:13px}.ai-image-input>button{padding:9px;border:1px dashed #afa1ed;border-radius:8px;color:#6850c8}.ai-image-preview{display:flex;align-items:center;justify-content:space-between;gap:8px}.ai-image-preview img{max-width:150px;max-height:100px;object-fit:contain;border-radius:6px}.ai-image-input label{line-height:1.6}
</style>
