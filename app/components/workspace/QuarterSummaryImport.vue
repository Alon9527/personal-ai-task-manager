<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { parseOfficeDocument } from '../../services/document-import'
import { suggestQuarterGoals, quarterSuggestionSchema } from '../../services/quarter-import'
import type { QuarterSuggestion } from '../../services/quarter-import'
import { loadAiModelTarget } from '../../services/ai-model-target'
const workspace = useWorkspace()
const text = ref(''); const year = ref(new Date().getFullYear()); const sourceName = ref('手动粘贴总结')
const input = ref<HTMLInputElement | null>(null); const busy = ref(false); const error = ref(''); const message = ref(''); const warnings = ref<string[]>([])
const suggestions = ref<(QuarterSuggestion & { selected: boolean, applied: boolean })[]>([])
let alive = true
onBeforeUnmount(() => { alive = false })
function failure(e: unknown) { return e instanceof Error ? e.message : typeof e === 'string' ? e : '操作失败，请重试' }
async function importWord(event: Event) {
 const el = event.target as HTMLInputElement; const file = el.files?.[0]; if (!file || busy.value) return
 busy.value = true; error.value = ''; suggestions.value = []; message.value = ''
 try { if (!file.name.toLowerCase().endsWith('.docx')) throw new Error('请选择 .docx 年终总结')
 const parsed = await parseOfficeDocument(file); if (!alive) return
 text.value = parsed.rows.map(row => row.join(' ')).join('\n'); sourceName.value = parsed.sourceName; warnings.value = parsed.warnings
 message.value = '已在本机提取文本，尚未发送给模型或创建季度目标。'
 } catch(e) { if(alive) error.value=failure(e) } finally { if(alive) busy.value=false; el.value='' }
}
async function generate() {
 if(busy.value)return
 busy.value=true;error.value='';suggestions.value=[];message.value=''
 try {const result=await suggestQuarterGoals(text.value,year.value,loadAiModelTarget());if(!alive)return;suggestions.value=result.map(g=>({...g,selected:false,applied:false}));if(!result.length)message.value='未找到该年份有明确原文依据的未来目标，请检查目标年份和导入内容。'}
 catch(e){if(alive)error.value=failure(e)}finally{if(alive)busy.value=false}
}
async function confirm() {
 if(busy.value)return
 busy.value=true;error.value='';let added=0
 try {
 const latest=await workspace.readLatestDocument()
 const seen=new Set(latest.quarterGoals.filter(g=>!g.deletedAt).map(g=>`${g.quarter}:${g.title.trim().toLocaleLowerCase()}`))
 for(const candidate of suggestions.value.filter(g=>g.selected&&!g.applied)) {
 if(!alive)break
 const goal=quarterSuggestionSchema.parse(candidate);const key=`${goal.quarter}:${goal.title.toLocaleLowerCase()}`
 if(seen.has(key)){candidate.applied=true;candidate.selected=false;continue}
 await workspace.createQuarterGoal({quarter:goal.quarter,title:goal.title,description:`${goal.description}\n\n来源：${sourceName.value}\n原文依据：${goal.evidence}`,progress:0,status:'active'})
 candidate.applied=true;candidate.selected=false;seen.add(key);added++
 }
 message.value=`已添加 ${added} 项季度目标，已存在的同季度同名目标不会重复添加。`
 }catch(e){error.value=`${failure(e)}；此前已成功添加 ${added} 项，不会自动重试。`}finally{busy.value=false}
}
</script>
<template><details class="quarter-summary-import"><summary>从年终总结导入今年目标</summary><p>支持本机 Word（.docx）或粘贴文本。先预览、再生成建议，勾选确认后才加入季度追踪。</p>
<button :disabled="busy" @click="input?.click()">导入年终总结 Word</button><input ref="input" type="file" accept=".docx" hidden @change="importWord">
<label>目标年份<input v-model.number="year" type="number" min="2000" max="2100" :disabled="busy||suggestions.length>0"></label>
<label>总结文本（最多 20000 字，可删去无关部分）<textarea v-model="text" rows="7" :disabled="busy||suggestions.length>0" /></label>
<p v-for="warning in warnings" :key="warning">{{warning}}</p><p>生成建议会把上方文本发送给当前所选模型。文档中的往年成绩不会自动算作今年目标。</p>
<button :disabled="busy||!text.trim()||text.length>20000||suggestions.length>0" @click="generate">{{busy?'正在处理…':'发送文本给当前模型，生成季度建议'}}</button>
<p v-if="error" role="alert">{{error}}</p><p v-if="message" role="status">{{message}}</p>
<article v-for="(goal,index) in suggestions" :key="index"><label><input v-model="goal.selected" type="checkbox" :disabled="busy||goal.applied">{{goal.applied?'已处理':'选择此目标'}}</label><input v-model="goal.title" aria-label="目标标题" :disabled="busy||goal.applied"><select v-model="goal.quarter" aria-label="目标季度" :disabled="busy||goal.applied"><option v-for="q in 4" :key="q" :value="`${year}-Q${q}`">{{year}} 年 Q{{q}}</option></select><textarea v-model="goal.description" aria-label="衡量与行动建议" :disabled="busy||goal.applied"/><blockquote>原文依据：{{goal.evidence}}</blockquote></article>
<div v-if="suggestions.length"><button :disabled="busy||!suggestions.some(g=>g.selected&&!g.applied)" @click="confirm">确认添加所选季度目标</button><button :disabled="busy" @click="suggestions=[]">结束本次审阅</button></div></details></template>
<style scoped>
.quarter-summary-import{border:1px solid #e3e0ef;border-radius:12px;padding:16px;margin-bottom:20px;font-size:14px;background:#fff}.quarter-summary-import summary{cursor:pointer;font-weight:700}.quarter-summary-import p{line-height:1.6;color:#626978}.quarter-summary-import label{display:grid;gap:8px;margin:12px 0}.quarter-summary-import input,.quarter-summary-import textarea,.quarter-summary-import select{border:1px solid #d8dbe4;padding:9px;border-radius:7px;max-width:100%;min-width:0}.quarter-summary-import input[type=checkbox]{width:auto}.quarter-summary-import textarea{width:100%;box-sizing:border-box}.quarter-summary-import button{padding:9px 14px;border-radius:7px;background:#ede9ff;color:#5945b7;margin:4px}.quarter-summary-import button:disabled{opacity:.5}.quarter-summary-import article{padding:12px;border:1px solid #e2dff1;margin:12px 0;border-radius:8px}.quarter-summary-import blockquote{font-size:13px;color:#717987;white-space:pre-wrap;overflow-wrap:anywhere}.quarter-summary-import [role=alert]{color:#b42318}
</style>
