<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { z } from 'zod'
import { quarterGoalStatusSchema, quarterKeySchema } from '#shared/workspace'
import type { QuarterGoal, QuarterKey } from '#shared/workspace'
import type { CreateQuarterGoalInput } from '../../data/workspace-gateway'

const props = defineProps<{
  open: boolean
  goal: QuarterGoal | null
  defaultQuarter: QuarterKey
  saving: boolean
}>()

const emit = defineEmits<{
  save: [input: CreateQuarterGoalInput]
  close: []
}>()

const formSchema = z.object({
  quarter: quarterKeySchema,
  title: z.string().trim().min(1, '请输入目标标题').max(160, '目标标题不能超过 160 个字符'),
  description: z.string().max(4000, '目标说明不能超过 4000 个字符'),
  progress: z.coerce.number().int('进度必须是整数').min(0, '进度必须在 0 到 100 之间').max(100, '进度必须在 0 到 100 之间'),
  status: quarterGoalStatusSchema,
})

const form = reactive(defaultForm())
const validationError = ref<string | null>(null)
const quarterOptions = computed<QuarterKey[]>(() => {
  const currentYear = new Date().getFullYear()
  const options = new Set<QuarterKey>([props.defaultQuarter])
  if (props.goal) options.add(props.goal.quarter)
  for (let year = currentYear - 1; year <= currentYear + 1; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) options.add(`${year}-Q${quarter}` as QuarterKey)
  }
  return [...options].sort()
})

watch(
  () => [props.open, props.goal, props.defaultQuarter] as const,
  () => {
    Object.assign(form, defaultForm(props.goal))
    validationError.value = null
  },
  { immediate: true },
)

function defaultForm(goal: QuarterGoal | null = null) {
  return {
    quarter: goal?.quarter ?? props.defaultQuarter,
    title: goal?.title ?? '',
    description: goal?.description ?? '',
    progress: goal?.progress ?? 0,
    status: goal?.status ?? 'active',
  }
}

function submit() {
  const result = formSchema.safeParse(form)
  if (!result.success) {
    validationError.value = result.error.issues[0]?.message ?? '请检查目标信息'
    return
  }
  validationError.value = null
  emit('save', result.data)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @click.self="emit('close')">
      <section
        class="workspace-dialog quarter-goal-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quarter-goal-dialog-title"
      >
        <header class="dialog-header">
          <div>
            <small>QUARTER GOAL</small>
            <h2 id="quarter-goal-dialog-title">{{ goal ? '编辑季度目标' : '创建季度目标' }}</h2>
          </div>
          <button type="button" aria-label="关闭" @click="emit('close')"><UIcon name="i-lucide-x" /></button>
        </header>

        <form @submit.prevent="submit">
          <label class="form-field">
            <span>季度</span>
            <select v-model="form.quarter" name="quarter" aria-label="季度">
              <option v-for="quarter in quarterOptions" :key="quarter" :value="quarter">{{ quarter }}</option>
            </select>
          </label>
          <label class="form-field">
            <span>状态</span>
            <select v-model="form.status" name="status" aria-label="目标状态">
              <option value="active">进行中</option>
              <option value="completed">已完成</option>
              <option value="paused">已暂停</option>
            </select>
          </label>
          <label class="form-field form-field-wide">
            <span>目标标题</span>
            <input v-model="form.title" name="title" aria-label="目标标题" autofocus placeholder="这个季度最重要的结果是什么？">
          </label>
          <label class="form-field form-field-wide">
            <span>目标说明</span>
            <textarea v-model="form.description" name="description" aria-label="目标说明" rows="3" placeholder="写下结果标准和关键背景" />
          </label>
          <label class="form-field form-field-wide">
            <span>当前进度</span>
            <div class="progress-input">
              <input v-model.number="form.progress" name="progress" aria-label="进度" type="number" min="0" max="100" step="1">
              <strong>{{ form.progress }}%</strong>
            </div>
          </label>
          <p v-if="validationError" role="alert" class="inline-error">{{ validationError }}</p>
          <footer class="dialog-actions form-field-wide">
            <button type="button" class="secondary-action" :disabled="saving" @click="emit('close')">取消</button>
            <button type="submit" class="primary-action" :disabled="saving">
              {{ saving ? '保存中…' : goal ? '保存更改' : '创建目标' }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
