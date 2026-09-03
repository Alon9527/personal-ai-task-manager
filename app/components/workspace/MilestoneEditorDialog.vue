<script setup lang="ts">
import { reactive, watch } from 'vue'
import { z } from 'zod'
import { milestoneProgressModeSchema, milestoneSchema, milestoneStatusSchema } from '#shared/workspace'
import type { Milestone, Project } from '#shared/workspace'
import type { CreateMilestoneInput } from '../../data/workspace-gateway'

const props = withDefaults(defineProps<{
  open: boolean
  milestone: Milestone | null
  projects: Project[]
  defaultProjectId?: string | null
}>(), {
  defaultProjectId: null,
})

const emit = defineEmits<{
  save: [input: CreateMilestoneInput]
  close: []
}>()

const schema = z.object({
  projectId: milestoneSchema.shape.projectId,
  title: milestoneSchema.shape.title,
  description: milestoneSchema.shape.description,
  targetDate: z.union([z.literal(''), z.iso.date()]),
  status: milestoneStatusSchema,
  progressMode: milestoneProgressModeSchema,
  progress: milestoneSchema.shape.progress,
})

const form = reactive(defaultForm())
const validationError = ref<string | null>(null)

watch(
  () => [props.open, props.milestone, props.defaultProjectId] as const,
  () => {
    Object.assign(form, defaultForm(props.milestone))
    validationError.value = null
  },
  { immediate: true },
)

watch(
  () => form.progressMode,
  mode => {
    if (mode === 'auto') form.progress = 0
  },
)

function defaultForm(milestone: Milestone | null = null) {
  return {
    projectId: milestone?.projectId ?? props.defaultProjectId ?? props.projects[0]?.id ?? '',
    title: milestone?.title ?? '',
    description: milestone?.description ?? '',
    targetDate: milestone?.targetDate ?? '',
    status: milestone?.status ?? 'planned',
    progressMode: milestone?.progressMode ?? 'auto',
    progress: milestone?.progressMode === 'manual' ? milestone.progress : 0,
  }
}

function submit() {
  const result = schema.safeParse({
    ...form,
    progress: form.progressMode === 'auto' ? 0 : form.progress,
  })
  if (!result.success) {
    const field = result.error.issues[0]?.path[0]
    validationError.value = field === 'projectId'
      ? '请选择所属项目'
      : field === 'title'
        ? (form.title.trim() ? '里程碑标题不能超过 160 个字符' : '请输入里程碑标题')
        : field === 'description'
          ? '里程碑描述不能超过 4000 个字符'
          : field === 'targetDate'
            ? '请选择有效的目标日期'
            : field === 'progress'
              ? '进度必须是 0 到 100 的整数'
              : '请检查里程碑信息'
    return
  }
  validationError.value = null
  emit('save', {
    ...result.data,
    targetDate: result.data.targetDate || null,
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @click.self="emit('close')">
      <section class="workspace-dialog milestone-editor" role="dialog" aria-modal="true" aria-labelledby="milestone-editor-title">
        <header class="dialog-header">
          <div><small>MILESTONE</small><h2 id="milestone-editor-title">{{ milestone ? '编辑里程碑' : '新建里程碑' }}</h2></div>
          <button type="button" aria-label="关闭" @click="emit('close')"><UIcon name="i-lucide-x" /></button>
        </header>
        <form @submit.prevent="submit">
          <label class="form-field form-field-wide">
            <span>所属项目</span>
            <select v-model="form.projectId" name="projectId">
              <option value="">请选择项目</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
          </label>
          <label class="form-field form-field-wide">
            <span>里程碑标题</span>
            <input v-model="form.title" name="title" autofocus placeholder="例如：完成首页评审">
          </label>
          <label class="form-field form-field-wide">
            <span>描述</span>
            <textarea v-model="form.description" name="description" rows="3" placeholder="说明交付结果或验收标准" />
          </label>
          <label class="form-field">
            <span>目标日期</span>
            <input v-model="form.targetDate" name="targetDate" type="date">
          </label>
          <label class="form-field">
            <span>状态</span>
            <select v-model="form.status" name="status">
              <option value="planned">计划中</option>
              <option value="in_progress">进行中</option>
              <option value="blocked">受阻</option>
              <option value="completed">已完成</option>
            </select>
          </label>
          <label class="form-field">
            <span>进度方式</span>
            <select v-model="form.progressMode" name="progressMode">
              <option value="auto">根据任务自动计算</option>
              <option value="manual">手动填写</option>
            </select>
          </label>
          <label class="form-field">
            <span>进度</span>
            <div class="progress-input">
              <input v-model.number="form.progress" name="progress" type="number" min="0" max="100" step="1" :disabled="form.progressMode === 'auto'">
              <strong>{{ form.progress }}%</strong>
            </div>
          </label>
          <p v-if="validationError" role="alert" class="inline-error">{{ validationError }}</p>
          <footer class="dialog-actions form-field-wide">
            <button type="button" class="secondary-action" @click="emit('close')">取消</button>
            <button type="submit" class="primary-action">{{ milestone ? '保存更改' : '创建里程碑' }}</button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
