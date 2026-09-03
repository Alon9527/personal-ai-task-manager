<script setup lang="ts">
import { reactive, watch } from 'vue'
import { z } from 'zod'
import { projectSchema, projectStatusSchema } from '#shared/workspace'
import type { Project } from '#shared/workspace'
import type { CreateProjectInput } from '../../data/workspace-gateway'

const props = defineProps<{ open: boolean, project: Project | null }>()
const emit = defineEmits<{ save: [input: CreateProjectInput], close: [] }>()
const form = reactive(defaultForm())
const validationError = ref<string | null>(null)
const schema = z.object({
  name: projectSchema.shape.name,
  description: projectSchema.shape.description,
  color: projectSchema.shape.color,
  priority: projectSchema.shape.priority,
  status: projectStatusSchema,
  targetDate: z.union([z.literal(''), z.iso.date()]),
})

watch(
  () => [props.open, props.project] as const,
  () => {
    Object.assign(form, defaultForm(props.project))
    validationError.value = null
  },
  { immediate: true },
)

function defaultForm(project: Project | null = null) {
  return {
    name: project?.name ?? '',
    description: project?.description ?? '',
    color: project?.color ?? '#8B7CF6',
    priority: project?.priority ?? '',
    status: project?.status ?? 'active',
    targetDate: project?.targetDate ?? '',
  }
}

function submit() {
  const result = schema.safeParse({
    ...form,
    priority: form.priority || null,
  })
  if (!result.success) {
    const field = result.error.issues[0]?.path[0]
    validationError.value = field === 'name'
      ? (form.name.trim() ? '项目名称不能超过 80 个字符' : '请输入项目名称')
      : field === 'description'
        ? '项目描述不能超过 4000 个字符'
        : field === 'color'
          ? '请选择有效颜色'
          : field === 'targetDate'
            ? '请选择有效的目标日期'
            : '请检查项目信息'
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
      <section class="workspace-dialog project-editor" role="dialog" aria-modal="true" aria-labelledby="project-editor-title">
        <header class="dialog-header">
          <div><small>PROJECT</small><h2 id="project-editor-title">{{ project ? '编辑项目' : '新建项目' }}</h2></div>
          <button type="button" aria-label="关闭" @click="emit('close')"><UIcon name="i-lucide-x" /></button>
        </header>
        <form @submit.prevent="submit">
          <label class="form-field form-field-wide">
            <span>项目名称</span>
            <input v-model="form.name" name="name" autofocus placeholder="例如：个人效率系统">
          </label>
          <label class="form-field form-field-wide">
            <span>项目描述</span>
            <textarea v-model="form.description" name="description" rows="3" placeholder="说明项目目标、范围或成功标准" />
          </label>
          <label class="form-field form-field-wide">
            <span>项目颜色</span>
            <div class="color-control"><input v-model="form.color" name="color" type="color"><input v-model="form.color" name="colorValue" aria-label="颜色值"></div>
          </label>
          <label class="form-field">
            <span>优先级</span>
            <select v-model="form.priority" name="priority">
              <option value="">无</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
          <label class="form-field">
            <span>项目状态</span>
            <select v-model="form.status" name="status">
              <option value="planned">计划中</option>
              <option value="active">进行中</option>
              <option value="paused">已暂停</option>
              <option value="completed">已完成</option>
            </select>
          </label>
          <label class="form-field form-field-wide">
            <span>目标日期</span>
            <input v-model="form.targetDate" name="targetDate" type="date">
          </label>
          <p v-if="validationError" role="alert" class="inline-error">{{ validationError }}</p>
          <footer class="dialog-actions form-field-wide">
            <button type="button" class="secondary-action" @click="emit('close')">取消</button>
            <button type="submit" class="primary-action">{{ project ? '保存更改' : '创建项目' }}</button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
