<script setup lang="ts">
import { computed } from 'vue'
import { deriveUpcomingMilestones } from '#shared/workspace'
import type { WorkspaceDocument } from '#shared/workspace'

const props = withDefaults(defineProps<{
  document: WorkspaceDocument
  now?: Date
}>(), {
  now: () => new Date(),
})

const router = useRouter()
const reminders = computed(() => deriveUpcomingMilestones(props.document, props.now, 7).slice(0, 5))

function timingLabel(days: number) {
  if (days < 0) return `逾期 ${Math.abs(days)} 天`
  if (days === 0) return '今天'
  return `${days} 天后`
}

function openProject(projectId: string) {
  void router.push({ path: '/', query: { project: projectId } })
}
</script>

<template>
  <section v-if="reminders.length" data-upcoming-milestones class="upcoming-milestones" aria-labelledby="upcoming-milestones-title">
    <header>
      <UIcon name="i-lucide-flag" />
      <h2 id="upcoming-milestones-title">里程碑提醒</h2>
    </header>
    <div class="upcoming-milestone-list">
      <button
        v-for="item in reminders"
        :key="item.milestone.id"
        :data-upcoming-milestone="item.milestone.id"
        type="button"
        @click="openProject(item.project.id)"
      >
        <i :style="{ background: item.project.color }" aria-hidden="true" />
        <span class="upcoming-milestone-main"><strong>{{ item.milestone.title }}</strong><small>{{ item.project.name }}</small></span>
        <em :class="item.timing">{{ timingLabel(item.days) }}</em>
        <UIcon name="i-lucide-chevron-right" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.upcoming-milestones{margin:0 0 14px;border:1px solid #e4e5e9;border-radius:10px;background:#fff;box-shadow:0 4px 14px rgb(30 34 43 / 4%)}
.upcoming-milestones header{display:flex;align-items:center;gap:7px;padding:11px 13px 9px;color:#515866}.upcoming-milestones header :deep(svg){width:15px;height:15px;color:#7165e3}.upcoming-milestones h2{margin:0;font-size:13px;font-weight:800}.upcoming-milestone-list{display:grid;border-top:1px solid #f0f0f2}.upcoming-milestone-list button{display:grid;grid-template-columns:8px minmax(0,1fr) auto 14px;gap:9px;align-items:center;min-height:46px;padding:7px 12px;border:0;border-bottom:1px solid #f0f0f2;background:#fff;color:inherit;text-align:left;cursor:pointer}.upcoming-milestone-list button:last-child{border-bottom:0}.upcoming-milestone-list button:hover{background:#fafaff}.upcoming-milestone-list button>i{width:7px;height:7px;border-radius:999px}.upcoming-milestone-main{display:grid;gap:2px;min-width:0}.upcoming-milestone-main strong{overflow:hidden;color:#30343c;font-size:13px;line-height:17px;text-overflow:ellipsis;white-space:nowrap}.upcoming-milestone-main small{overflow:hidden;color:#626873;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.upcoming-milestone-list em{border-radius:999px;padding:3px 6px;background:#f1f2f5;color:#505661;font-size:13px;font-style:normal;font-weight:700;white-space:nowrap}.upcoming-milestone-list em.overdue{background:#fff0f0;color:#a94343}.upcoming-milestone-list :deep(svg){width:14px;height:14px;color:#a3a7af}
</style>
