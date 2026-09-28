<script setup lang="ts">
import WorkspaceInfoDialog from '../workspace/WorkspaceInfoDialog.vue'
import { materializeWorkspaceAttachments, parsePortableWorkspaceBackup } from '../../services/task-attachments'
import type { WorkspaceDocument } from '#shared/workspace'
defineProps<{ section:'data'|'updates' }>()
const workspace=useWorkspace();const error=ref('');const busy=ref(false)
const preview = ref<WorkspaceDocument | null>(null)
const acknowledged = ref(false)
const filename = ref('')
const notice = ref('')
async function chooseBackup(event: Event) {
  if (busy.value) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  preview.value = null; acknowledged.value = false; error.value = ''; notice.value = ''
  if (!file) return
  busy.value = true
  try {
    if (file.size > 200 * 1024 * 1024) throw new Error('备份超过 200 MB，请联系维护人员导入')
    preview.value = parsePortableWorkspaceBackup(JSON.parse(await file.text()))
    filename.value = file.name
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取完整备份，当前数据未改变' }
  finally { busy.value = false }
}
async function restore() {
  if (!preview.value || !acknowledged.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    await workspace.importWorkspaceBackup(preview.value)
    preview.value = null; acknowledged.value = false; notice.value = '导入完成，任务及附件已恢复。原工作区快照已保留。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '导入失败，当前数据未改变' }
  finally { busy.value = false }
}
async function backup(){busy.value=true;error.value='';try{const doc=await materializeWorkspaceAttachments(await workspace.readLatestDocument());const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`focus-workspace-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){error.value=e instanceof Error?e.message:'备份失败'}finally{busy.value=false}}
</script>
<template>
  <div>
    <section v-if="section==='data'" class="suite-card">
      <header><h2>数据与备份</h2><button :disabled="busy" @click="backup">{{busy?'处理中…':'导出工作区备份'}}</button></header>
      <p>备份包含任务、项目、里程碑和附件，不包含模型 API Key。</p>
      <div v-if="workspace.backendMode.value !== 'supabase'" class="backup-import">
        <label>导入完整工作区备份<input type="file" accept=".json,application/json" :disabled="busy" @change="chooseBackup"></label>
        <div v-if="preview" class="backup-preview">
          <strong>{{ filename }}</strong>
          <p>{{ preview.tasks.length }} 项任务 · {{ preview.projects.length }} 个项目 · {{ preview.milestones.length }} 个里程碑 · {{ preview.quarterGoals.length }} 个目标（包含回收站）</p>
          <label><input v-model="acknowledged" type="checkbox" :disabled="busy">我确认用此备份替换当前工作区（包括回收站）。系统会先保留原工作区快照；模型密钥不受影响。</label>
          <button type="button" data-confirm-import :disabled="!acknowledged || busy" @click="restore">确认导入并替换</button>
        </div>
      </div>
      <p v-if="error" role="alert">{{error}}</p>
      <p v-if="notice" role="status">{{notice}}</p>
    </section>
    <WorkspaceInfoDialog embedded :section="section" />
  </div>
</template>

<style scoped>
.backup-import,.backup-preview{display:grid;gap:12px;margin-top:16px}.backup-import>label{display:grid;gap:8px}.backup-preview{padding:16px;border:1px solid #dedbee;border-radius:10px;background:#f8f7ff}.backup-preview label{line-height:1.6}.backup-preview button{justify-self:start;padding:8px 14px;border:1px solid #756ae2;border-radius:7px;background:#6b5ce7;color:white}.backup-preview button:disabled{opacity:.5}input[type=file]{max-width:100%}[role=alert]{color:#b42318}[role=status]{color:#26754a}
</style>
