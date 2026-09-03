<script setup lang="ts">
import { computed } from 'vue'
import { deriveProjectProgress } from '#shared/workspace'
import type { Milestone, Project, Task } from '#shared/workspace'
import MilestoneRow from './MilestoneRow.vue'

const props = withDefaults(defineProps<{
  project: Project
  milestones: Milestone[]
  tasks: Task[]
  now?: Date
}>(), {
  now: () => new Date(),
})

const ui = useWorkspaceUi()
const projectMilestones = computed(() => props.milestones
  .filter(milestone => milestone.deletedAt === null && milestone.projectId === props.project.id)
  .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)))
const progress = computed(() => deriveProjectProgress(props.project, props.milestones, props.tasks))
const nextMilestone = computed(() => [...projectMilestones.value]
  .filter(milestone => milestone.status !== 'completed')
  .sort((left, right) => (left.targetDate ?? '9999-12-31').localeCompare(right.targetDate ?? '9999-12-31')
    || left.sortOrder - right.sortOrder)[0] ?? null)
const nextIsOverdue = computed(() => nextMilestone.value?.targetDate
  ? dateValue(nextMilestone.value.targetDate) < localDateValue(props.now)
  : false)

function formatTargetDate(value: string | null) {
  if (!value) return '未设日期'
  const [, month, day] = value.split('-').map(Number)
  return `${month}月${day}日`
}

function dateValue(value: string) {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

function localDateValue(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}
</script>

<template>
  <section data-project-progress class="project-progress-panel" aria-labelledby="project-progress-title">
    <header class="project-progress-header">
      <div class="project-progress-summary">
        <span class="project-progress-kicker">项目进度</span>
        <div>
          <h2 id="project-progress-title">总体完成度</h2>
          <strong>{{ progress }}%</strong>
        </div>
        <span class="project-progress-bar" aria-hidden="true"><i :style="{ width: `${progress}%` }" /></span>
      </div>

      <div data-next-milestone class="next-milestone">
        <span>下一个里程碑</span>
        <template v-if="nextMilestone">
          <strong class="next-milestone-title">{{ nextMilestone.title }}</strong>
          <small>{{ formatTargetDate(nextMilestone.targetDate) }}</small>
          <em v-if="nextIsOverdue">已逾期</em>
        </template>
        <strong v-else class="next-milestone-title">暂无待推进里程碑</strong>
      </div>
    </header>

    <div class="project-milestones-heading">
      <div>
        <h2>里程碑</h2>
        <span>{{ projectMilestones.length }} 项</span>
      </div>
      <button data-new-milestone type="button" @click="ui.openNewMilestone(project.id)">
        <UIcon name="i-lucide-plus" />
        新增里程碑
      </button>
    </div>

    <div v-if="projectMilestones.length" class="milestone-list">
      <MilestoneRow
        v-for="milestone in projectMilestones"
        :key="milestone.id"
        :milestone="milestone"
        :milestones="projectMilestones"
        :tasks="tasks"
        :now="now"
      />
    </div>
    <div v-else class="project-milestones-empty">
      <span>还没有里程碑，用一个明确节点开始追踪项目。</span>
      <button type="button" @click="ui.openNewMilestone(project.id)">创建首个里程碑</button>
    </div>
  </section>
</template>
