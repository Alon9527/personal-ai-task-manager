<script setup lang="ts">
import { computed, ref } from 'vue'
import { deriveMilestoneProgress } from '#shared/workspace'
import type { Milestone, MilestoneStatus, Task } from '#shared/workspace'
import MilestoneActionsMenu from '../workspace/MilestoneActionsMenu.vue'

const props = defineProps<{
  milestone: Milestone
  milestones: Milestone[]
  tasks: Task[]
  now: Date
}>()

const workspace = useWorkspace()
const ui = useWorkspaceUi()
const menuOpen = ref(false)
const menuButton = ref<HTMLButtonElement | null>(null)

const linkedTasks = computed(() => props.tasks.filter(task =>
  task.deletedAt === null && task.milestoneId === props.milestone.id,
))
const progress = computed(() => deriveMilestoneProgress(props.milestone, props.tasks))
const index = computed(() => props.milestones.findIndex(item => item.id === props.milestone.id))
const overdue = computed(() => props.milestone.status !== 'completed'
  && props.milestone.targetDate !== null
  && dateValue(props.milestone.targetDate) < localDateValue(props.now))

const statusLabels: Record<MilestoneStatus, string> = {
  planned: '计划中',
  in_progress: '进行中',
  blocked: '受阻',
  completed: '已完成',
}

function formatTargetDate(value: string | null) {
  if (!value) return '未设目标日期'
  const [, month, day] = value.split('-').map(Number)
  return `${month}月${day}日`
}

function closeMenu() {
  menuOpen.value = false
}

function closeMenuFromKeyboard() {
  closeMenu()
  menuButton.value?.focus()
}

function editMilestone() {
  closeMenu()
  ui.openEditMilestone(props.milestone.id)
}

function deleteMilestone() {
  closeMenu()
  ui.askDeleteMilestone(props.milestone.id)
}

async function updateStatus(status: MilestoneStatus) {
  closeMenu()
  await workspace.updateMilestone(props.milestone.id, {
    status,
    ...(status === 'completed' ? { progress: 100 } : {}),
  })
}

async function moveMilestone(offset: -1 | 1) {
  closeMenu()
  const currentIndex = index.value
  const targetIndex = currentIndex + offset
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= props.milestones.length) return
  const orderedIds = props.milestones.map(item => item.id)
  ;[orderedIds[currentIndex], orderedIds[targetIndex]] = [orderedIds[targetIndex]!, orderedIds[currentIndex]!]
  await workspace.reorderMilestones(props.milestone.projectId, orderedIds)
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
  <article data-milestone-row class="milestone-row">
    <div class="milestone-row-main">
      <button type="button" class="milestone-row-title" @click="editMilestone">
        <span class="milestone-status-dot" :class="`is-${milestone.status}`" />
        {{ milestone.title }}
      </button>
      <div class="milestone-row-meta">
        <span>{{ statusLabels[milestone.status] }}</span>
        <span>{{ formatTargetDate(milestone.targetDate) }}</span>
        <span>{{ milestone.progressMode === 'auto' ? '按任务自动计算' : '手动进度' }}</span>
        <strong v-if="overdue" class="milestone-overdue">已逾期</strong>
      </div>
    </div>

    <span data-linked-task-count class="milestone-linked-count">
      <UIcon name="i-lucide-list-checks" />
      {{ linkedTasks.length }} 个关联任务
    </span>

    <div class="milestone-progress-cell">
      <strong data-milestone-progress>{{ progress }}%</strong>
      <span class="milestone-progress-track" aria-hidden="true"><i :style="{ width: `${progress}%` }" /></span>
    </div>

    <div class="milestone-menu-wrap" @keydown.esc.stop="closeMenuFromKeyboard">
      <button
        ref="menuButton"
        type="button"
        class="milestone-menu-toggle"
        :aria-expanded="menuOpen"
        :aria-label="`${milestone.title}操作菜单`"
        @click="menuOpen = !menuOpen"
      >
        <UIcon name="i-lucide-ellipsis" />
      </button>
      <MilestoneActionsMenu
        v-if="menuOpen"
        :milestone="milestone"
        :first="index === 0"
        :last="index === milestones.length - 1"
        @edit="editMilestone"
        @plan="updateStatus('planned')"
        @start="updateStatus('in_progress')"
        @block="updateStatus('blocked')"
        @complete="updateStatus('completed')"
        @move-up="moveMilestone(-1)"
        @move-down="moveMilestone(1)"
        @delete="deleteMilestone"
      />
    </div>
  </article>
</template>
