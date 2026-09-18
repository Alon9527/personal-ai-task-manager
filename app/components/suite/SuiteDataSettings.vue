<script setup lang="ts">
import WorkspaceInfoDialog from '../workspace/WorkspaceInfoDialog.vue'
import { workspaceDocumentSchema } from '#shared/workspace'
defineProps<{ section:'data'|'updates' }>()
const workspace=useWorkspace();const error=ref('');const busy=ref(false)
async function backup(){busy.value=true;error.value='';try{const doc=workspaceDocumentSchema.parse(await workspace.readLatestDocument());const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`focus-workspace-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){error.value=e instanceof Error?e.message:'备份失败'}finally{busy.value=false}}
</script>
<template><div><section v-if="section==='data'" class="suite-card"><header><h2>数据与备份</h2><button :disabled="busy" @click="backup">{{busy?'导出中…':'导出工作区备份'}}</button></header><p>备份包含任务、项目、里程碑和附件，不包含模型 API Key。</p><p v-if="error" role="alert">{{error}}</p></section><WorkspaceInfoDialog embedded :section="section" /></div></template>
