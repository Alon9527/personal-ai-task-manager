<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { workspaceDocumentSchema } from '#shared/workspace'
import type { WorkspaceDocument } from '#shared/workspace'
import { bulkTaskPatchSchema, editSelectedTasks } from '../../services/inbox-bulk-edit'
import type { BulkTaskPatch } from '../../services/inbox-bulk-edit'
import { normalizeTaskDateInput } from '../../utils/task-date-input'
import TaskDateInput from './TaskDateInput.vue'

const props = defineProps<{ taskIds: string[] }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const workspace = useWorkspace(), ui = useWorkspaceUi()
// Keep the selection stable while project changes remove rows from the inbox.
const ids = [...new Set(props.taskIds)]
const editorId = crypto.randomUUID(), titleId = useId()
const base = shallowRef<WorkspaceDocument | null>(null)
const panel = ref<HTMLElement | null>(null), error = ref(''), saving = ref(false)
const locked = computed(() => saving.value || Boolean(workspace.updateLocked?.value))
const projects = computed(() => base.value?.projects.filter(p => !p.deletedAt) ?? [])
const enabled = reactive({ projectId: false, priority: false, importance: false, startDate: false, dueDate: false, completionDate: false, isFocus: false })
const values = reactive({ projectId: '', priority: '', importance: 'normal', startDate: '', dueDate: '', completionDate: '', isFocus: false })
const dates = [{ key: 'startDate', label: '开始日期' }, { key: 'dueDate', label: '截止日期' }, { key: 'completionDate', label: '完成日期（不改变状态）' }] as const
const hasChanges = computed(() => Object.values(enabled).some(Boolean))
let disposed = false
let previousFocus: HTMLElement | null = null
onMounted(async () => {
  ui.setEmbeddedEditorActive(editorId, true)
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  try { const snapshot = await workspace.readLatestDocument(); if (!disposed) base.value = workspaceDocumentSchema.parse(snapshot) }
  catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : '无法读取任务，请关闭后重试' }
  await nextTick(); if (!disposed) panel.value?.focus()
})
onBeforeUnmount(() => { disposed = true; ui.setEmbeddedEditorActive(editorId, false); if (previousFocus?.isConnected) previousFocus.focus() })
function close() { if (!saving.value) emit('close') }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
  if (event.key !== 'Tab') return
  const controls = Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') ?? []).filter(el => el.getClientRects().length)
  const first = controls[0], last = controls.at(-1)
  if (!first) { event.preventDefault(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) { event.preventDefault(); first.focus() }
}
async function save() {
  if (locked.value || !base.value || !hasChanges.value) return
  saving.value = true; error.value = ''
  try {
    const raw: Record<string, unknown> = {}
    for (const key of Object.keys(enabled) as Array<keyof typeof enabled>) {
      if (!enabled[key]) continue
      raw[key] = ['startDate', 'dueDate', 'completionDate'].includes(key)
        ? normalizeTaskDateInput(String(values[key])) || null : values[key] === '' ? null : values[key]
    }
    const parsed = bulkTaskPatchSchema.safeParse(raw)
    if (!parsed.success) throw new Error('请检查日期和所选值；日期可输入 260918 或 2026-09-18')
    const patch: BulkTaskPatch = parsed.data
    const next = editSelectedTasks(base.value, ids, patch)
    await workspace.replaceWorkspaceDocument(next, base.value)
    emit('saved'); emit('close')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '批量保存失败，请重试' }
  finally { saving.value = false }
}
</script>
<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="close" @keydown="keydown">
      <section ref="panel" data-bulk-editor class="workspace-dialog bulk-task-editor" role="dialog" aria-modal="true" :aria-labelledby="titleId" :aria-busy="saving" tabindex="-1">
        <header class="dialog-header"><div><h2 :id="titleId">统一编辑 {{ ids.length }} 项任务</h2><small>只修改勾选的字段，其余内容保持各自原值。</small></div><button aria-label="关闭批量编辑" :disabled="saving" @click="close">×</button></header>
        <form @submit.prevent="save">
          <p v-if="!base && !error" role="status">正在读取所选任务…</p>
          <fieldset :disabled="locked || !base">
            <div class="bulk-field"><label><input v-model="enabled.projectId" data-enable-field="projectId" type="checkbox">项目</label><select v-model="values.projectId" data-bulk-project aria-label="统一项目" :disabled="!enabled.projectId"><option value="">无项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></div>
            <small v-if="enabled.projectId">变更项目时，不属于新项目的里程碑关联会清除。</small>
            <div class="bulk-field"><label><input v-model="enabled.priority" data-enable-field="priority" type="checkbox">优先级</label><select v-model="values.priority" aria-label="统一优先级" :disabled="!enabled.priority"><option value="">无</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div>
            <div class="bulk-field"><label><input v-model="enabled.importance" data-enable-field="importance" type="checkbox">重要性</label><select v-model="values.importance" aria-label="统一重要性" :disabled="!enabled.importance"><option value="normal">普通</option><option value="important">重要</option></select></div>
            <div v-for="date in dates" :key="date.key" class="bulk-field"><label><input v-model="enabled[date.key]" :data-enable-field="date.key" type="checkbox">{{date.label}}</label><fieldset :disabled="!enabled[date.key]"><TaskDateInput v-model="values[date.key]" :name="date.key" :label="`统一${date.label}`" /></fieldset></div>
            <small>勾选日期字段后留空，表示清除该日期。</small>
            <div class="bulk-field"><label><input v-model="enabled.isFocus" data-enable-field="isFocus" type="checkbox">今日重点</label><label><input v-model="values.isFocus" type="checkbox" :disabled="!enabled.isFocus">设为今日重点</label></div>
          </fieldset>
          <p v-if="error" role="alert" class="bulk-error">{{ error }}</p>
          <footer><button type="button" class="secondary-action" :disabled="saving" @click="close">取消</button><button type="submit" class="primary-action" :disabled="locked || !base || !hasChanges">{{saving ? '正在保存…' : `应用到 ${ids.length} 项任务`}}</button></footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.bulk-task-editor form{grid-template-columns:minmax(0,1fr)}
.bulk-task-editor{width:min(600px,100%);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden}.bulk-task-editor .dialog-header{flex-shrink:0}.bulk-task-editor .dialog-header small{display:block;margin-top:6px;font-size:12px;color:#7d8291}.bulk-task-editor form{padding:20px;min-height:0;overflow:auto;display:grid;gap:12px}.bulk-task-editor fieldset{padding:0;margin:0;min-width:0;border:0}.bulk-task-editor form>fieldset{display:grid;gap:12px}.bulk-field{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,1.4fr);align-items:center;gap:12px;font-size:13px}.bulk-field label{display:flex;align-items:center;gap:8px}.bulk-field select{width:100%;padding:8px;border:1px solid #dde0e8;border-radius:7px;background:white}.bulk-field input[type=checkbox]{width:16px;height:16px;accent-color:#7750ff}.bulk-task-editor small{font-size:12px;color:#777e8f}.bulk-task-editor footer{display:flex;justify-content:flex-end;gap:10px}.bulk-error{color:#b33e48;font-size:13px}.bulk-task-editor :disabled{opacity:.5}.bulk-task-editor :focus-visible{outline:2px solid #7750ff;outline-offset:2px}@media(max-width:480px){.bulk-field{grid-template-columns:1fr;gap:6px}}
</style>
