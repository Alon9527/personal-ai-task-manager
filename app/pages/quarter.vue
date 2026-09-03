<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  deriveQuarterMetrics,
  goalsForQuarter,
  quarterKeySchema,
} from '#shared/workspace'
import type { QuarterGoal, QuarterGoalStatus, QuarterKey } from '#shared/workspace'
import DashboardTopbar from '../components/dashboard/DashboardTopbar.vue'
import EmptyDashboardState from '../components/dashboard/EmptyDashboardState.vue'
import MetricCard from '../components/dashboard/MetricCard.vue'
import QuarterGoalActionsMenu from '../components/workspace/QuarterGoalActionsMenu.vue'
import { getCurrentQuarter } from '../utils/today-view'

const route = useRoute()
const workspace = useWorkspace()
const ui = useWorkspaceUi()
const now = ref(new Date())
const currentQuarter = getCurrentQuarter(now.value)
const openMenuId = ref<string | null>(null)

const queryQuarter = Array.isArray(route.query.quarter)
  ? route.query.quarter[0]
  : route.query.quarter
const selectedQuarter = ref<QuarterKey>(
  quarterKeySchema.safeParse(queryQuarter).success
    ? queryQuarter as QuarterKey
    : currentQuarter,
)

const quarterOptions = computed<QuarterKey[]>(() => {
  const quarters = new Set<QuarterKey>([currentQuarter])
  workspace.quarterGoals.value.forEach(goal => quarters.add(goal.quarter))
  return [...quarters].sort()
})

const goals = computed(() =>
  goalsForQuarter(workspace.document.value, selectedQuarter.value),
)

const quarterMetrics = computed(() =>
  deriveQuarterMetrics(workspace.document.value, selectedQuarter.value, now.value),
)

const riskGoalIds = computed(() => new Set(quarterMetrics.value.riskGoalIds))

onMounted(() => {
  now.value = new Date()
  if (!workspace.ready.value) void workspace.load()
})

function quarterLabel(quarter: QuarterKey) {
  const [year, number] = quarter.split('-Q')
  return `${year} 年第 ${number} 季度`
}

function statusLabel(status: QuarterGoalStatus) {
  if (status === 'completed') return '已完成'
  if (status === 'paused') return '已暂停'
  return '进行中'
}

function updatedLabel(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '刚刚更新'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(date)
}

async function setStatus(goal: QuarterGoal, status: QuarterGoalStatus) {
  openMenuId.value = null
  await workspace.updateQuarterGoal(goal.id, { status })
}

async function adjustProgress(goal: QuarterGoal, change: number) {
  const progress = Math.min(100, Math.max(0, goal.progress + change))
  if (progress === goal.progress) return
  await workspace.updateQuarterGoal(goal.id, { progress })
}

async function moveGoal(id: string, direction: -1 | 1) {
  const ids = goals.value.map(goal => goal.id)
  const index = ids.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ids.length) return
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
  openMenuId.value = null
  await workspace.reorderQuarterGoals(selectedQuarter.value, ids)
}
</script>

<template>
  <main data-quarter-dashboard class="dashboard-page quarter-page">
    <DashboardTopbar
      section="规划"
      title="季度追踪"
      action-label="新建目标"
      action-icon="i-lucide-plus"
      @action="ui.openNewQuarterGoal(selectedQuarter)"
    />

    <div class="dashboard-content">
      <section class="dashboard-heading quarter-heading">
        <div>
          <p>QUARTERLY TRACKER · 聚焦关键结果</p>
          <h1>季度追踪</h1>
          <span>用目标进度对照季度节奏，及时调整资源和下一步行动。</span>
        </div>
        <label class="quarter-picker">
          <span>查看季度</span>
          <select v-model="selectedQuarter" data-quarter-select aria-label="选择季度">
            <option v-for="quarter in quarterOptions" :key="quarter" :value="quarter">
              {{ quarterLabel(quarter) }}
            </option>
          </select>
        </label>
      </section>

      <section class="dashboard-metric-grid quarter-metric-grid" aria-label="季度概览">
        <MetricCard
          data-metric="quarter-progress"
          label="整体进度"
          :value="`${quarterMetrics.averageProgress}%`"
          hint="目标平均值"
          tone="violet"
          icon="i-lucide-chart-no-axes-combined"
        />
        <MetricCard
          data-metric="total-goals"
          label="季度目标"
          :value="quarterMetrics.totalGoals"
          hint="当前季度"
          tone="neutral"
          icon="i-lucide-goal"
        />
        <MetricCard
          data-metric="completed-goals"
          label="已完成"
          :value="quarterMetrics.completedGoals"
          hint="关键结果"
          tone="teal"
          icon="i-lucide-circle-check-big"
        />
        <MetricCard
          data-metric="remaining-days"
          label="剩余时间"
          :value="`${quarterMetrics.remainingDays} 天`"
          hint="保持节奏"
          tone="orange"
          icon="i-lucide-hourglass"
        />
      </section>

      <section class="quarter-section-heading">
        <div>
          <h2>{{ quarterLabel(selectedQuarter) }}目标</h2>
          <span>{{ goals.length }} 项关键结果</span>
        </div>
        <button type="button" @click="ui.openNewQuarterGoal(selectedQuarter)">
          <UIcon name="i-lucide-plus" />添加目标
        </button>
      </section>

      <div v-if="workspace.loading.value" class="dashboard-panel dashboard-loading">
        <UIcon name="i-lucide-loader-circle" />正在加载季度目标…
      </div>
      <section v-else-if="goals.length" class="quarter-goal-grid">
        <article
          v-for="(goal, index) in goals"
          :key="goal.id"
          data-quarter-goal
          class="quarter-goal-card"
          :class="{
            risk: riskGoalIds.has(goal.id),
            paused: goal.status === 'paused',
            completed: goal.status === 'completed',
          }"
        >
          <header>
            <span class="goal-status" :class="goal.status">
              <i />{{ statusLabel(goal.status) }}
            </span>
            <div class="task-menu-wrap">
              <button
                type="button"
                data-goal-menu-toggle
                class="task-menu-toggle"
                :aria-expanded="openMenuId === goal.id"
                :aria-label="`${goal.title} 操作菜单`"
                @click="openMenuId = openMenuId === goal.id ? null : goal.id"
              >
                <UIcon name="i-lucide-ellipsis" />
              </button>
              <QuarterGoalActionsMenu
                v-if="openMenuId === goal.id"
                :goal="goal"
                :first="index === 0"
                :last="index === goals.length - 1"
                @edit="openMenuId = null; ui.openEditQuarterGoal(goal.id)"
                @complete="setStatus(goal, 'completed')"
                @activate="setStatus(goal, 'active')"
                @pause="setStatus(goal, 'paused')"
                @move-up="moveGoal(goal.id, -1)"
                @move-down="moveGoal(goal.id, 1)"
                @delete="openMenuId = null; ui.askDeleteQuarterGoal(goal.id)"
              />
            </div>
          </header>

          <div class="quarter-goal-copy">
            <h3>{{ goal.title }}</h3>
            <p>{{ goal.description || '还没有补充目标说明。' }}</p>
          </div>

          <p v-if="riskGoalIds.has(goal.id)" class="goal-risk-note">
            <UIcon name="i-lucide-triangle-alert" />落后季度节奏，建议收缩范围或加快推进
          </p>

          <div class="goal-progress-heading">
            <span>目标进度</span>
            <strong>{{ goal.progress }}%</strong>
          </div>
          <div
            class="goal-progress-track"
            role="progressbar"
            :aria-label="`${goal.title}进度`"
            :aria-valuenow="goal.progress"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span :style="{ width: `${goal.progress}%` }" />
          </div>

          <footer>
            <span>更新于 {{ updatedLabel(goal.updatedAt) }}</span>
            <div class="goal-progress-actions">
              <button type="button" :disabled="goal.progress === 0" @click="adjustProgress(goal, -10)">−10</button>
              <button type="button" :disabled="goal.progress === 100" @click="adjustProgress(goal, 10)">+10</button>
              <button type="button" class="goal-edit-button" @click="ui.openEditQuarterGoal(goal.id)">
                <UIcon name="i-lucide-pencil" />编辑
              </button>
            </div>
          </footer>
        </article>
      </section>
      <div v-else class="dashboard-panel">
        <EmptyDashboardState
          data-empty-quarter-goals
          icon="i-lucide-goal"
          title="这个季度还没有目标"
          description="从一项真正重要的关键结果开始，进度会自动汇总到季度指标。"
          action-label="创建季度目标"
          @action="ui.openNewQuarterGoal(selectedQuarter)"
        />
      </div>
    </div>
  </main>
</template>
