<script setup lang="ts">
import { computed, ref } from 'vue'
import { parsePortableWorkspaceBackup } from '../../services/task-attachments'
import type { WorkspaceDocument } from '#shared/workspace'

const workspace = useWorkspace()
const preview = ref<WorkspaceDocument | null>(null)
const filename = ref('')
const error = ref('')
const acknowledged = ref(false)
const busy = ref(false)
const required = computed(() => workspace.recoveryRequired?.value ?? false)

async function chooseBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  preview.value = null
  acknowledged.value = false
  error.value = ''
  if (!file || busy.value) return
  busy.value = true
  try {
    if (file.size > 200 * 1024 * 1024) throw new Error('备份超过 200 MB，请先联系维护人员恢复，原始数据不会被替换。')
    preview.value = parsePortableWorkspaceBackup(JSON.parse(await file.text()))
    filename.value = file.name
  }
  catch { error.value = '无法读取这份工作区 JSON 备份，原始数据未改变。请选择软件导出的有效备份。' }
  finally { busy.value = false }
}

async function restore() {
  if (!preview.value || !acknowledged.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await workspace.recoverWorkspaceDocument(preview.value)
    preview.value = null
    acknowledged.value = false
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '恢复失败，原始数据仍保留' }
  finally { busy.value = false }
}

async function retry() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await workspace.load() }
  catch { error.value = '仍无法读取工作区，请选择有效备份恢复；不会自动清空或填入演示数据。' }
  finally { busy.value = false }
}
</script>

<template>
  <div v-if="required" class="recovery-backdrop">
    <section class="recovery-panel" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
      <h2 id="recovery-title">工作区需要恢复</h2>
      <p>原始数据已保留，已停止正常写入。不会自动清空，也不会加入演示任务。</p>
      <p>请选择此前导出的工作区 JSON 备份。确认后会先保留当前原始内容，再恢复所选备份；模型密钥和设置不受影响。</p>
      <label>选择工作区备份<input type="file" accept=".json,application/json" :disabled="busy" @change="chooseBackup"></label>
      <div v-if="preview" data-recovery-preview>
        <strong>{{ filename }}</strong>
        <p>{{ preview.tasks.length }} 项任务 · {{ preview.projects.length }} 个项目 · {{ preview.milestones.length }} 个里程碑 · {{ preview.quarterGoals.length }} 个季度目标（含回收站）</p>
        <label><input v-model="acknowledged" type="checkbox" :disabled="busy">我确认使用这份备份恢复工作区，备份之后新增的内容可能不在其中</label>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer>
        <button type="button" :disabled="busy" @click="retry">重新读取</button>
        <button type="button" data-confirm-recovery :disabled="busy || !preview || !acknowledged" @click="restore">{{ busy ? '处理中…' : '确认恢复备份' }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.recovery-backdrop{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:#15132999}
.recovery-panel{width:min(100%,620px);max-height:90vh;overflow:auto;background:#fff;color:#292635;border-radius:16px;padding:28px;font-size:14px;line-height:1.7;box-shadow:0 20px 60px #0003}
h2{font-size:22px;margin:0 0 14px}p{margin:12px 0}label{display:block;margin:14px 0}input[type=file]{display:block;margin-top:8px;max-width:100%}input[type=checkbox]{margin-right:8px}footer{display:flex;justify-content:flex-end;gap:12px;margin-top:22px}button{border:1px solid #dad5eb;border-radius:8px;padding:9px 14px;cursor:pointer}button[data-confirm-recovery]{background:#7152e8;color:white}button:disabled{opacity:.5;cursor:default}[role=alert]{color:#b42318}
</style>
