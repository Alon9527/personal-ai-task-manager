<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { z } from 'zod'
import { getTaskImportance, getTaskStatus, taskImportanceSchema, taskSchema, taskStatusSchema } from '#shared/workspace'
import type { Milestone, Project, Task } from '#shared/workspace'
import type { CreateTaskInput } from '../../data/workspace-gateway'
import { taskAttachmentSchema } from '#shared/workspace'
import type { TaskAttachment } from '#shared/workspace'
import { addTaskAttachments, isPreviewableTaskImage } from '../../services/task-attachments'
import { clipboardImages } from '../../services/clipboard-images'
import TaskDateInput from './TaskDateInput.vue'
import { normalizeTaskDateInput } from '../../utils/task-date-input'

const props = withDefaults(defineProps<{
  open: boolean
  task: Task | null
  projects: Project[]
  milestones?: Milestone[]
  defaultProjectId?: string | null
  attachmentsEnabled?: boolean
  embedded?: boolean
  defaultDate?: string
  defaultTime?: string
}>(), {
  milestones: () => [],
  defaultProjectId: null,
  attachmentsEnabled: true,
})

const emit = defineEmits<{
  save: [input: CreateTaskInput]
  close: []
}>()

const formSchema = z.object({
  title: taskSchema.shape.title,
  description: taskSchema.shape.description,
  projectId: taskSchema.shape.projectId,
  milestoneId: taskSchema.shape.milestoneId,
  priority: taskSchema.shape.priority,
  dueDate: z.union([z.literal(''), z.iso.date()]),
  startDate: z.union([z.literal(''), z.iso.date()]),
  completionDate: z.union([z.literal(''), z.iso.date()]),
  dueTime: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]),
  isFocus: z.boolean(),
  status: taskStatusSchema,
  importance: taskImportanceSchema,
  estimatedMinutes: z.union([z.literal(''), z.coerce.number().int().min(5, '预计时长至少 5 分钟').max(1440, '预计时长不能超过 24 小时')]),
  reminderLocal: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)]),
  attachments: z.array(taskAttachmentSchema).max(8),
})

const form = reactive(defaultForm())
const formId = useId()
let attachmentGeneration = 0
const validationError = ref<string | null>(null)
const attachmentInput = ref<HTMLInputElement | null>(null)
const attachmentBusy = ref(false)
const attachmentError = ref<string | null>(null)
const taskStatusOptions = [
  { value: 'inbox', label: '收集箱', icon: 'i-lucide-inbox' },
  { value: 'todo', label: '待办', icon: 'i-lucide-circle' },
  { value: 'in_progress', label: '进行中', icon: 'i-lucide-play' },
  { value: 'waiting', label: '等待中', icon: 'i-lucide-clock-3' },
  { value: 'done', label: '已完成', icon: 'i-lucide-circle-check' },
  { value: 'cancelled', label: '已取消', icon: 'i-lucide-circle-x' },
] as const
const filteredMilestones = computed(() => props.milestones.filter(milestone => milestone.projectId === form.projectId))

watch(
  () => [props.open, props.task, props.defaultProjectId] as const,
  () => {
    attachmentGeneration++
    attachmentBusy.value = false
    Object.assign(form, defaultForm(props.task))
    validationError.value = null
    attachmentError.value = null
    if (attachmentInput.value) attachmentInput.value.value = ''
  },
  { immediate: true },
)

watch(
  () => form.projectId,
  () => {
    if (form.milestoneId && !filteredMilestones.value.some(milestone => milestone.id === form.milestoneId)) {
      form.milestoneId = ''
    }
  },
)

function defaultForm(task: Task | null = null) {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    projectId: task ? (task.projectId ?? '') : (props.defaultProjectId ?? ''),
    milestoneId: task?.milestoneId ?? '',
    priority: task?.priority ?? '',
    dueDate: task?.dueDate ?? props.defaultDate ?? '',
    startDate: task?.startDate ?? '',
    completionDate: task?.completionDate ?? '',
    dueTime: task?.dueTime ?? props.defaultTime ?? '',
    isFocus: task?.isFocus ?? false,
    status: task ? getTaskStatus(task) : 'todo',
    importance: task ? getTaskImportance(task) : 'normal',
    estimatedMinutes: task?.estimatedMinutes ?? '',
    reminderLocal: toLocalDateTimeInput(task?.reminderAt ?? null),
    attachments: taskAttachmentSchema.array().parse(task?.attachments ?? []),
  }
}

function submit() {
  if (attachmentBusy.value) return
  form.startDate = normalizeTaskDateInput(form.startDate)
  form.dueDate = normalizeTaskDateInput(form.dueDate)
  form.completionDate = normalizeTaskDateInput(form.completionDate)
  const result = formSchema.safeParse({
    ...form,
    projectId: form.projectId || null,
    milestoneId: form.milestoneId || null,
    priority: form.priority || null,
  })
  if (!result.success) {
    const issue = result.error.issues[0]
    validationError.value = issue?.path[0] === 'completionDate'
      ? '完成日期无效，请输入有效日期，例如 260918 或 2026-09-18'
      : issue?.message ?? '请检查任务信息'
    return
  }
  validationError.value = null
  if (result.data.startDate && result.data.dueDate && result.data.startDate > result.data.dueDate) {
    validationError.value = '截止日期不能早于开始日期'
    return
  }
  emit('save', {
    title: result.data.title,
    description: result.data.description,
    projectId: result.data.projectId,
    milestoneId: result.data.milestoneId,
    priority: result.data.priority,
    dueDate: result.data.dueDate || null,
    startDate: result.data.startDate || null,
    completionDate: result.data.completionDate || null,
    dueTime: result.data.dueTime || null,
    isFocus: result.data.isFocus,
    status: result.data.status,
    importance: result.data.importance,
    estimatedMinutes: result.data.estimatedMinutes === '' ? null : result.data.estimatedMinutes,
    reminderAt: result.data.reminderLocal ? new Date(result.data.reminderLocal).toISOString() : null,
    snoozedUntil: null,
    attachments: result.data.attachments,
  })
}

function chooseAttachmentFiles() {
  if (!props.attachmentsEnabled) return
  attachmentInput.value?.click()
}

async function handleAttachmentFiles(event: Event) {
  if (!props.attachmentsEnabled) return
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  await attachFiles(files)
  input.value = ''
}

async function handlePaste(event: ClipboardEvent) {
  if (!props.attachmentsEnabled) return
  const files = clipboardImages(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  await attachFiles(files)
}

async function attachFiles(files: File[]) {
  if (attachmentBusy.value || !props.attachmentsEnabled) return
  if (files.length === 0) return
  const generation = attachmentGeneration
  attachmentBusy.value = true
  attachmentError.value = null
  try {
    const attachments = await addTaskAttachments(form.attachments, files)
    if (generation === attachmentGeneration && props.open) form.attachments = attachments
  }
  catch (error) {
    if (generation === attachmentGeneration) attachmentError.value = error instanceof Error ? error.message : '附件添加失败，请重试'
  }
  finally {
    if (generation === attachmentGeneration) attachmentBusy.value = false
  }
}

function removeAttachment(id: string) {
  if (attachmentBusy.value) return
  form.attachments = form.attachments.filter(attachment => attachment.id !== id)
}

function downloadAttachment(attachment: TaskAttachment) {
  const link = document.createElement('a')
  link.href = attachment.dataUrl
  link.download = attachment.name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function toLocalDateTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
</script>

<template>
  <Teleport to="body" :disabled="embedded">
    <div v-if="open" :class="embedded ? 'suite-inline-editor' : 'dialog-backdrop'" @click.self="!embedded && emit('close')">
      <section @paste="handlePaste" class="workspace-dialog task-editor" :role="embedded ? 'region' : 'dialog'" :aria-modal="embedded ? undefined : true" aria-labelledby="task-editor-title">
        <header class="dialog-header">
          <div>
            <small>TASK</small>
            <h2 id="task-editor-title">{{ task ? '编辑任务' : '新建任务' }}</h2>
          </div>
          <div class="task-header-actions"><button type="button" class="secondary-action" @click="emit('close')">取消</button><button type="submit" :form="formId" class="primary-action" :disabled="attachmentBusy">{{ task ? '保存更改' : '创建任务' }}</button></div><button type="button" aria-label="关闭" @click="emit('close')"><UIcon name="i-lucide-x" /></button>
        </header>

        <form :id="formId" v-if="embedded" class="suite-compact-form" @submit.prevent="submit">
          <label class="form-field"><span>任务标题</span><input v-model="form.title" name="title" placeholder="要推进什么？"></label>
          <fieldset class="task-status-field"><legend>状态</legend><div class="task-status-options" role="radiogroup" aria-label="任务状态"><label v-for="option in taskStatusOptions.filter(o=>!['inbox','cancelled'].includes(o.value))" :key="option.value" :class="{selected:form.status===option.value}"><input v-model="form.status" type="radio" name="status-choice" :value="option.value"><span>{{option.label}}</span></label></div></fieldset>
          <fieldset class="task-status-field"><legend>重要性</legend><div class="task-status-options" role="radiogroup" aria-label="重要性"><label :class="{selected:form.importance==='normal'}"><input v-model="form.importance" type="radio" value="normal"><span>普通</span></label><label :class="{selected:form.importance==='important'}"><input v-model="form.importance" type="radio" value="important"><span>重要</span></label></div></fieldset>
          <div class="suite-date-fields"><label class="form-field"><span>开始日期</span><TaskDateInput v-model="form.startDate" name="startDate" label="开始日期" /></label><label class="form-field"><span>截止日期</span><TaskDateInput v-model="form.dueDate" name="dueDate" label="截止日期" /></label><label class="form-field"><span>完成日期（可选）</span><TaskDateInput v-model="form.completionDate" name="completionDate" label="完成日期" /><small>可输入 260918（2026-09-18），不改变任务状态</small></label></div>
          <label class="form-field"><span>提醒</span><input v-model="form.reminderLocal" name="reminderAt" type="datetime-local"></label>
          <label class="form-field"><span>任务描述</span><textarea v-model="form.description" name="description" rows="2" placeholder="讨论背景、结果或下一步" /></label>
          <section class="suite-compact-attachments"><span>附件</span><button type="button" :disabled="!attachmentsEnabled||attachmentBusy" @click="chooseAttachmentFiles"><UIcon name="i-lucide-paperclip" />添加文件 / 图片</button><input ref="attachmentInput" type="file" multiple hidden @change="handleAttachmentFiles"><div v-for="attachment in form.attachments" :key="attachment.id"><button type="button" @click="downloadAttachment(attachment)">{{attachment.name}}</button><button type="button" :aria-label="`移除 ${attachment.name}`" @click="removeAttachment(attachment.id)">×</button></div><small v-if="attachmentError" role="alert">{{attachmentError}}</small></section>
          <details class="suite-editor-more"><summary>项目、里程碑与更多选项</summary><label class="form-field"><span>项目</span><select v-model="form.projectId"><option value="">无项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{p.name}}</option></select></label><label class="form-field"><span>里程碑</span><select v-model="form.milestoneId"><option value="">无里程碑</option><option v-for="m in filteredMilestones" :key="m.id" :value="m.id">{{m.title}}</option></select></label><label class="form-field"><span>优先级</span><select v-model="form.priority"><option value="">未设置</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label><label><input v-model="form.isFocus" type="checkbox">今日重点</label></details>
          <p v-if="validationError" role="alert" class="inline-error">{{validationError}}</p>
        </form>
        <form :id="formId" v-else @submit.prevent="submit">
          <label class="form-field form-field-wide">
            <span>任务标题</span>
            <input v-model="form.title" name="title" autofocus placeholder="要推进什么？">
          </label>
          <label class="form-field form-field-wide">
            <span>描述</span>
            <textarea v-model="form.description" name="description" rows="3" placeholder="补充背景、结果或下一步" />
          </label>
          <section class="task-attachment-field form-field-wide">
            <p v-if="!attachmentsEnabled" class="task-attachment-disabled-note">
              远端工作区暂不上传附件；切换到本机工作区后可添加文件和图片。
            </p>
            <div class="task-attachment-heading">
              <div><span>附件</span><small>支持 Ctrl+V 粘贴图片；图片可预览，其他文件可下载</small></div>
              <button type="button" data-add-attachment :disabled="!attachmentsEnabled || attachmentBusy || form.attachments.length >= 8" @click="chooseAttachmentFiles">
                <UIcon name="i-lucide-paperclip" />{{ attachmentBusy ? '正在添加…' : '添加文件或图片' }}
              </button>
            </div>
            <input ref="attachmentInput" data-attachment-input type="file" multiple hidden @change="handleAttachmentFiles">
            <div v-if="form.attachments.length" class="task-attachment-list">
              <article v-for="attachment in form.attachments" :key="attachment.id" class="task-attachment-item">
                <button type="button" class="task-attachment-preview" :aria-label="`下载 ${attachment.name}`" @click="downloadAttachment(attachment)">
                  <img v-if="isPreviewableTaskImage(attachment)" :src="attachment.dataUrl" alt="">
                  <span v-else><UIcon name="i-lucide-file" /></span>
                </button>
                <button type="button" class="task-attachment-info" @click="downloadAttachment(attachment)">
                  <strong :title="attachment.name">{{ attachment.name }}</strong>
                  <small>{{ formatAttachmentSize(attachment.size) }} · 点击下载</small>
                </button>
                <button type="button" class="task-attachment-remove" :aria-label="`移除 ${attachment.name}`" @click="removeAttachment(attachment.id)">
                  <UIcon name="i-lucide-x" />
                </button>
              </article>
            </div>
            <p v-else class="task-attachment-empty">单个不超过 5 MB，最多 8 个，附件会随任务数据一起保存。</p>
            <p v-if="attachmentError" class="task-attachment-error" role="alert">{{ attachmentError }}</p>
          </section>
          <label class="form-field">
            <span>项目</span>
            <select v-model="form.projectId" name="projectId">
              <option value="">无项目</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
          </label>
          <label class="form-field">
            <span>重要性</span>
            <select v-model="form.importance" name="importance">
              <option value="normal">普通</option>
              <option value="important">重要</option>
            </select>
          </label>
          <label class="form-field">
            <span>里程碑</span>
            <select v-model="form.milestoneId" name="milestoneId" :disabled="!form.projectId">
              <option value="">无里程碑</option>
              <option v-for="milestone in filteredMilestones" :key="milestone.id" :value="milestone.id">{{ milestone.title }}</option>
            </select>
          </label>
          <fieldset class="task-status-field form-field-wide">
            <legend>任务状态</legend>
            <div class="task-status-options" role="radiogroup" aria-label="任务状态">
              <label v-for="option in taskStatusOptions" :key="option.value" :class="{ selected: form.status === option.value }">
                <input v-model="form.status" data-task-status name="status-choice" type="radio" :value="option.value">
                <span><UIcon :name="option.icon" />{{ option.label }}</span>
              </label>
            </div>
          </fieldset>
          <label class="form-field">
            <span>细分优先级</span>
            <select v-model="form.priority" name="priority">
              <option value="">无</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
<label class="form-field"><span>开始日期</span><TaskDateInput v-model="form.startDate" name="startDate" label="开始日期" /></label><label class="form-field"><span>截止日期</span><TaskDateInput v-model="form.dueDate" name="dueDate" label="截止日期" /></label><label class="form-field"><span>完成日期（可选）</span><TaskDateInput v-model="form.completionDate" name="completionDate" label="完成日期" /><small>可输入 260918（2026-09-18），不改变任务状态</small></label>


          <label class="form-field">
            <span>提醒时间</span>
            <input v-model="form.reminderLocal" name="reminderAt" type="datetime-local">
          </label>
          <label class="focus-toggle form-field-wide">
            <input v-model="form.isFocus" name="isFocus" type="checkbox">
            <span><b>今日重点</b><small>放在优先完成分组</small></span>
          </label>
          <p v-if="validationError" role="alert" class="inline-error">{{ validationError }}</p>

        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.task-editor .suite-date-fields{grid-template-columns:minmax(0,1fr)}
.task-header-actions{display:flex;gap:8px;margin-left:auto}.task-header-actions button{width:auto;height:auto;padding:9px 14px;font-size:14px;white-space:nowrap}
.task-editor .task-status-options input[type=radio]{width:1px!important;min-width:1px!important;height:1px!important;padding:0!important;border:0!important}
.task-editor .task-status-options span [class*=icon]{border:0;padding:0;min-height:0;background:transparent;box-shadow:none}
.task-editor{max-height:calc(100dvh - 36px)}
.task-editor>form{max-height:calc(100dvh - 112px);overflow-y:auto}
.task-status-field{min-width:0;margin:0;padding:0;border:0}
.task-status-field legend{margin-bottom:7px;color:#656a73;font-size:13px;font-weight:700}
.task-status-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.task-status-options label{position:relative;min-width:0;cursor:pointer}
.task-status-options input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.task-status-options span{display:flex;min-height:42px;align-items:center;justify-content:center;gap:7px;padding:0 9px;border:1px solid #dde0e6;border-radius:8px;background:#fafbfc;color:#656b75;font-size:13px;font-weight:650;transition:border-color .15s,background .15s,color .15s}
.task-status-options label:hover span{border-color:#bcb7ec;background:#f8f7ff}
.task-status-options label.selected span{border-color:#7166df;background:#efedff;color:#554bc1;box-shadow:0 0 0 2px rgb(113 102 223 / 12%)}
.task-status-options input:focus-visible+span{outline:3px solid rgb(108 99 232 / 28%);outline-offset:2px}
.task-attachment-field{display:grid;gap:9px;padding:12px;border:1px solid #e1e3e8;border-radius:9px;background:#fafbfc}
.task-attachment-disabled-note{margin:0;padding:8px 10px;border:1px solid #e6dcae;border-radius:7px;background:#fff9df;color:#776323;font-size:12px;line-height:1.45}
.task-attachment-field:has(.task-attachment-disabled-note) .task-attachment-heading button{opacity:.5;pointer-events:none}
.task-attachment-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.task-attachment-heading>div{display:grid;gap:2px}
.task-attachment-heading span{color:#555b65;font-size:13px;font-weight:750}
.task-attachment-heading small,.task-attachment-empty{color:#8a8f98;font-size:12px}
.task-attachment-heading button{display:inline-flex;min-height:34px;align-items:center;gap:6px;padding:0 10px;border:1px solid #d6d2f2;border-radius:7px;background:#fff;color:#5f56c8;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.task-attachment-heading button:disabled{opacity:.5;cursor:not-allowed}
.task-attachment-list{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.task-attachment-item{display:grid;grid-template-columns:42px minmax(0,1fr) 30px;min-width:0;align-items:center;gap:8px;padding:7px;border:1px solid #e1e3e8;border-radius:8px;background:#fff}
.task-attachment-preview{display:grid;width:42px;height:42px;padding:0;place-items:center;overflow:hidden;border:0;border-radius:6px;background:#f0eff9;color:#665bd7;cursor:pointer}
.task-attachment-preview img{width:100%;height:100%;object-fit:cover}
.task-attachment-info{display:grid;min-width:0;gap:3px;padding:0;border:0;background:transparent;text-align:left;cursor:pointer}
.task-attachment-info strong,.task-attachment-info small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.task-attachment-info strong{color:#3b3f46;font-size:13px}
.task-attachment-info small{color:#898e97;font-size:11px}
.task-attachment-remove{display:grid;width:30px;height:30px;padding:0;place-items:center;border:0;border-radius:6px;background:transparent;color:#92969e;cursor:pointer}
.task-attachment-remove:hover{background:#fff0f0;color:#b84d4d}
.task-attachment-empty,.task-attachment-error{margin:0;line-height:1.45}
.task-attachment-error{color:#b34646;font-size:12px}
@media(max-width:760px){.task-editor{max-height:calc(100dvh - 16px)}.task-editor>form{max-height:calc(100dvh - 88px)}.task-status-options{grid-template-columns:repeat(2,minmax(0,1fr))}.task-attachment-list{grid-template-columns:1fr}.task-attachment-heading{align-items:flex-start;flex-direction:column}}
</style>
