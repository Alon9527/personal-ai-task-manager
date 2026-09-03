<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  open: boolean
  kind: 'project' | 'milestone' | 'task' | 'quarter-goal'
  name: string
  affectedTaskCount?: number
  affectedMilestoneCount?: number
}>()

const emit = defineEmits<{ confirm: [], close: [] }>()

const entityLabel = computed(() => ({
  project: '项目',
  milestone: '里程碑',
  task: '任务',
  'quarter-goal': '季度目标',
})[props.kind])

const projectCascadeText = computed(() => {
  const milestones = props.affectedMilestoneCount ?? 0
  const tasks = props.affectedTaskCount ?? 0
  if (milestones && tasks) return `${milestones} 个里程碑和 ${tasks} 项任务也会移入回收数据。`
  if (milestones) return `${milestones} 个里程碑也会移入回收数据。`
  if (tasks) return `${tasks} 项任务也会移入回收数据。`
  return ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @click.self="emit('close')">
      <section class="workspace-dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title">
        <span class="danger-symbol"><UIcon name="i-lucide-trash-2" /></span>
        <h2 id="delete-dialog-title">{{ entityLabel }}移入回收数据？</h2>
        <p>“{{ name }}”{{ entityLabel }}将从当前工作区隐藏，底层数据仍可恢复。</p>
        <p v-if="kind === 'quarter-goal'" class="cascade-note">
          季度目标会移入回收数据，不会被物理删除。
        </p>
        <p v-if="kind === 'milestone'" class="cascade-note">
          <template v-if="affectedTaskCount">{{ affectedTaskCount }} 项关联任务会保留，并取消里程碑关联。</template>
          <template v-else>关联任务（如有）会保留，并取消里程碑关联。</template>
        </p>
        <p v-if="kind === 'project' && projectCascadeText" class="cascade-note">
          {{ projectCascadeText }}
        </p>
        <footer class="dialog-actions">
          <button type="button" class="secondary-action" @click="emit('close')">取消</button>
          <button type="button" data-confirm-delete class="danger-button" @click="emit('confirm')">确认删除</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
