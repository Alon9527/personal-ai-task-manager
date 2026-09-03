<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { deriveAnnualReview } from '#shared/workspace'
import type { QuarterKey } from '#shared/workspace'
import DashboardTopbar from '../components/dashboard/DashboardTopbar.vue'
import EmptyDashboardState from '../components/dashboard/EmptyDashboardState.vue'
import MetricCard from '../components/dashboard/MetricCard.vue'

const route = useRoute()
const workspace = useWorkspace()
const ui = useWorkspaceUi()

const queryYear = Array.isArray(route.query.year) ? route.query.year[0] : route.query.year
const selectedYear = ref(/^\d{4}$/.test(queryYear ?? '') ? Number(queryYear) : 2026)

const yearOptions = computed(() => {
  const years = new Set<number>([2026])
  workspace.tasks.value.forEach((task) => {
    const year = Number(task.dueDate?.slice(0, 4) ?? task.createdAt.slice(0, 4))
    if (Number.isInteger(year)) years.add(year)
  })
  workspace.quarterGoals.value.forEach((goal) => {
    const year = Number(goal.quarter.slice(0, 4))
    if (Number.isInteger(year)) years.add(year)
  })
  return [...years].sort((left, right) => right - left)
})

const review = computed(() =>
  deriveAnnualReview(workspace.document.value, selectedYear.value),
)

const selectedYearGoals = computed(() =>
  workspace.quarterGoals.value.filter(goal =>
    goal.quarter.startsWith(`${selectedYear.value}-`),
  ),
)

const trendPoints = computed(() =>
  review.value.quarterTrend.map((point, index) => ({
    ...point,
    x: 40 + index * 106,
    y: 130 - point.progress * 1.05,
  })),
)

const trendPolyline = computed(() =>
  trendPoints.value.map(point => `${point.x},${point.y}`).join(' '),
)

onMounted(() => {
  void workspace.load()
})

function milestoneDate(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '日期待确认'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function createGoalQuarter() {
  return `${selectedYear.value}-Q3` as QuarterKey
}

defineExpose({ workspace, ui })
</script>

<template>
  <main data-review-dashboard class="dashboard-page review-page">
    <DashboardTopbar section="复盘" title="年终总结" />

    <div class="dashboard-content">
      <section class="dashboard-heading review-heading">
        <div>
          <p>ANNUAL REVIEW · 从真实行动中看见成长</p>
          <h1>{{ selectedYear }} 年终总结</h1>
          <span>数据随任务和季度目标实时变化，这里不保存额外的总结副本。</span>
        </div>
        <label class="quarter-picker">
          <span>回顾年份</span>
          <select v-model="selectedYear" data-year-select aria-label="选择总结年份">
            <option v-for="year in yearOptions" :key="year" :value="year">{{ year }} 年</option>
          </select>
        </label>
      </section>

      <section class="dashboard-metric-grid review-metric-grid" aria-label="年度概览">
        <MetricCard
          data-metric="completed-tasks"
          label="完成任务"
          :value="review.completedTaskCount"
          :hint="`共 ${review.annualTaskCount} 项`"
          tone="violet"
          icon="i-lucide-list-checks"
        />
        <MetricCard
          data-metric="completion-rate"
          label="完成率"
          :value="`${review.completionRate}%`"
          hint="年度执行"
          tone="teal"
          icon="i-lucide-gauge"
        />
        <MetricCard
          data-metric="goal-progress"
          label="目标进度"
          :value="`${review.averageGoalProgress}%`"
          hint="季度平均"
          tone="orange"
          icon="i-lucide-goal"
        />
        <MetricCard
          data-metric="milestones"
          label="年度里程碑"
          :value="review.milestoneCount"
          hint="值得记住"
          tone="neutral"
          icon="i-lucide-milestone"
        />
      </section>

      <section class="review-overview-grid">
        <article class="dashboard-panel review-trend-panel">
          <header class="review-panel-heading">
            <div>
              <p>QUARTERLY TREND</p>
              <h2>季度目标趋势</h2>
            </div>
            <span>年度平均 {{ review.averageGoalProgress }}%</span>
          </header>

          <div class="review-chart-wrap">
            <svg
              viewBox="0 0 400 160"
              role="img"
              :aria-label="`${selectedYear} 年四季度目标平均进度趋势`"
            >
              <line v-for="level in [25, 50, 75, 100]" :key="level" x1="40" x2="358" :y1="130 - level * 1.05" :y2="130 - level * 1.05" />
              <polyline :points="trendPolyline" />
              <g
                v-for="point in trendPoints"
                :key="point.quarter"
                data-quarter-trend-point
                :transform="`translate(${point.x} ${point.y})`"
              >
                <circle r="5" />
                <text y="-12" text-anchor="middle">{{ point.progress }}%</text>
                <text :y="145 - point.y" text-anchor="middle" class="quarter-label">
                  {{ point.quarter.slice(-2) }}
                </text>
              </g>
            </svg>
          </div>

          <div v-if="selectedYearGoals.length === 0" data-empty-review-goals class="review-inline-empty">
            <div><UIcon name="i-lucide-goal" /><span>这一年还没有季度目标，趋势暂时为 0。</span></div>
            <button data-create-review-goal type="button" @click="ui.openNewQuarterGoal(createGoalQuarter())">
              创建季度目标
            </button>
          </div>
        </article>

        <article class="dashboard-panel review-distribution-panel">
          <header class="review-panel-heading">
            <div>
              <p>PROJECT MIX</p>
              <h2>项目完成分布</h2>
            </div>
          </header>

          <div v-if="review.projectDistribution.length" class="project-distribution-list">
            <div
              v-for="project in review.projectDistribution"
              :key="project.projectId"
              data-project-distribution
              class="project-distribution-row"
            >
              <header>
                <span><i :style="{ background: project.color }" />{{ project.name }}</span>
                <strong>{{ project.completed }}/{{ project.total }}</strong>
              </header>
              <div class="distribution-track" role="progressbar" :aria-valuenow="project.completionRate" aria-valuemin="0" aria-valuemax="100">
                <span :style="{ width: `${project.completionRate}%`, background: project.color }" />
              </div>
              <small>{{ project.completionRate }}% 已完成</small>
            </div>
          </div>
          <div v-else data-empty-review-tasks class="review-side-empty">
            <span><UIcon name="i-lucide-list-todo" /></span>
            <h3>这一年还没有任务</h3>
            <p>创建任务后，项目投入与完成率会自动出现在这里。</p>
            <button data-create-review-task type="button" @click="ui.openNewTask()">创建任务</button>
          </div>
        </article>
      </section>

      <article data-milestone-timeline class="dashboard-panel milestone-panel">
        <header class="review-panel-heading">
          <div>
            <p>MILESTONES</p>
            <h2>年度里程碑</h2>
          </div>
          <span>{{ review.milestoneCount }} 个重要节点</span>
        </header>

        <div v-if="review.milestones.length" class="milestone-timeline">
          <div v-for="milestone in review.milestones" :key="`${milestone.kind}-${milestone.id}`" class="milestone-row">
            <span class="milestone-symbol" :class="milestone.kind">
              <UIcon :name="milestone.kind === 'goal' ? 'i-lucide-goal' : 'i-lucide-circle-check-big'" />
            </span>
            <i />
            <div>
              <small>{{ milestone.kind === 'goal' ? '季度目标' : '完成任务' }}</small>
              <strong>{{ milestone.title }}</strong>
            </div>
            <time :datetime="milestone.date">{{ milestoneDate(milestone.date) }}</time>
          </div>
        </div>
        <EmptyDashboardState
          v-else
          icon="i-lucide-milestone"
          title="里程碑正在路上"
          description="完成任务或季度目标后，这里会按时间记录你的关键进展。"
          action-label="添加任务"
          @action="ui.openNewTask()"
        />
      </article>
    </div>
  </main>
</template>
