<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { z } from 'zod'
import { getTaskImportance, getTaskStatus, taskImportanceSchema, taskSchema, taskStatusSchema } from '#shared/workspace'
import type { Milestone, Project, Task } from '#shared/workspace'
import type { CreateTaskInput } from '../../data/workspace-gateway'
import { taskAttachmentSchema } from '#shared/workspace'
import type { TaskAttachment } from '#shared/workspace'
import { addTaskAttachments, isPreviewableTaskImage } from '../../services/task-attachments'

const props = withDefaults(defineProps<{
  open: boolean
  task: Task | null
  projects: Project[]
  milestones?: Milestone[]
  defaultProjectId?: string | null
  attachmentsEnabled?: boolean
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
  dueTime: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]),
  isFocus: z.boolean(),
  status: taskStatusSchema,
  importance: taskImportanceSchema,
  estimatedMinutes: z.union([z.literal(''), z.coerce.number().int().min(5, '预计时长至少 5 分钟').max(1440, '预计时长不能超过 24 小时')]),
  reminderLocal: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)]),
  attachments: z.array(taskAttachmentSchema).max(8),
})

const form = reactive(defaultForm())
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
    dueDate: task?.dueDate ?? '',
    dueTime: task?.dueTime ?? '',
    isFocus: task?.isFocus ?? false,
    status: task ? getTaskStatus(task) : 'todo',
    importance: task ? getTaskImportance(task) : 'normal',
    estimatedMinutes: task?.estimatedMinutes ?? '',
    reminderLocal: toLocalDateTimeInput(task?.reminderAt ?? null),
    attachments: structuredClone(task?.attachments ?? []),
  }
}

function submit() {
  const result = formSchema.safeParse({
    ...form,
    projectId: form.projectId || null,
    milestoneId: form.milestoneId || null,
    priority: form.priority || null,
  })
  if (!result.success) {
    validationError.value = result.error.issues[0]?.message ?? '请检查任务信息'
    return
  }
  validationError.value = null
  emit('save', {
    title: result.data.title,
    description: result.data.description,
    projectId: result.data.projectId,
    milestoneId: result.data.milestoneId,
    priority: result.data.priority,
    dueDate: result.data.dueDate || null,
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
  if (files.length === 0) return
  attachmentBusy.value = true
  attachmentError.value = null
  try {
    form.attachments = await addTaskAttachments(form.attachments, files)
  }
  catch (error) {
    attachmentError.value = error instanceof Error ? error.message : '附件添加失败，请重试'
  }
  finally {
    attachmentBusy.value = false
    input.value = ''
  }
}

function removeAttachment(id: string) {
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
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @click.self="emit('close')">
      <section class="workspace-dialog task-editor" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
        <header class="dialog-header">
          <div>
            <small>TASK</small>
            <h2 id="task-editor-title">{{ task ? '编辑任务' : '新建任务' }}</h2>
          </div>
          <button type="button" aria-label="关闭" @click="emit('close')"><UIcon name="i-lucide-x" /></button>
        </header>

        <form @submit.prevent="submit">
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
              <div><span>附件</span><small>图片可预览，其他文件可下载</small></div>
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
          <label class="form-field">
            <span>日期</span>
            <input v-model="form.dueDate" name="dueDate" type="date">
          </label>
          <label class="form-field">
            <span>时间</span>
            <input v-model="form.dueTime" name="dueTime" type="time">
          </label>
          <label class="form-field">
            <span>预计时长（分钟）</span>
            <input v-model.number="form.estimatedMinutes" name="estimatedMinutes" type="number" min="5" max="1440" step="5" placeholder="例如 30">
          </label>
          <label class="form-field">
            <span>提醒时间</span>
            <input v-model="form.reminderLocal" name="reminderAt" type="datetime-local">
          </label>
          <label class="focus-toggle form-field-wide">
            <input v-model="form.isFocus" name="isFocus" type="checkbox">
            <span><b>今日重点</b><small>放在优先完成分组</small></span>
          </label>
          <p v-if="validationError" role="alert" class="inline-error">{{ validationError }}</p>
          <footer class="dialog-actions form-field-wide">
            <button type="button" class="secondary-action" @click="emit('close')">取消</button>
            <button type="submit" class="primary-action">{{ task ? '保存更改' : '创建任务' }}</button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
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
