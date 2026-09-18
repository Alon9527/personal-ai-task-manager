<script setup lang="ts">
import { computed } from 'vue'
import { deriveProjectProgress, getTaskStatus } from '#shared/workspace'

const props = defineProps<{ today: string }>()
const workspace = useWorkspace()
const ui = useWorkspaceUi()
const schedule = computed(() => workspace.tasks.value
  .filter(task => task.dueDate === props.today && !['done', 'cancelled'].includes(getTaskStatus(task)))
  .sort((a, b) => (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99'))
  .slice(0, 4))
const projects = computed(() => workspace.projects.value
  .filter(project => project.name !== '收集箱')
  .slice(0, 3)
  .map(project => ({ ...project, progress: deriveProjectProgress(project, workspace.milestones.value, workspace.tasks.value) })))
</script>

<template>
  <section class="focus-overview" aria-label="今日安排与项目进度">
    <article class="focus-overview-card">
      <header><h2>今日安排</h2><NuxtLink to="/calendar">查看日程 <UIcon name="i-lucide-chevron-right" /></NuxtLink></header>
      <div v-if="schedule.length" class="focus-timeline">
        <button v-for="task in schedule" :key="task.id" @click="ui.openEditTask(task.id)">
          <time>{{ task.dueTime ?? '全天' }}</time><span><strong>{{ task.title }}</strong><small>{{ task.estimatedMinutes ? `预计 ${task.estimatedMinutes} 分钟` : '未设置时长' }}</small></span>
        </button>
      </div>
      <div v-else class="focus-overview-empty"><UIcon name="i-lucide-calendar-check" /><p>今天还没有安排，留一点从容。</p><button @click="ui.openNewTask()">安排一件事</button></div>
    </article>
    <article class="focus-overview-card">
      <header><h2>项目进度</h2><button @click="ui.openNewProject">新建项目 <UIcon name="i-lucide-plus" /></button></header>
      <div v-if="projects.length" class="focus-project-summaries">
        <NuxtLink v-for="project in projects" :key="project.id" :to="{ path: '/project', query: { project: project.id } }">
          <span class="focus-project-caption"><i :style="{ background: project.color }" /><strong>{{ project.name }}</strong><b>{{ project.progress }}%</b></span>
          <span class="focus-segment-progress" role="progressbar" :aria-label="`${project.name}完成度`" :aria-valuenow="project.progress" :aria-valuemin="0" :aria-valuemax="100"><i :style="{ width: `${project.progress}%` }" /></span>
        </NuxtLink>
      </div>
      <div v-else class="focus-overview-empty"><UIcon name="i-lucide-folder-plus" /><p>创建项目，让每一步都有方向。</p><button @click="ui.openNewProject">创建项目</button></div>
    </article>
  </section>
</template>
