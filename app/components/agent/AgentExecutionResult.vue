<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspaceDocument } from '#shared/workspace'
import type { AgentActionResult } from '../../services/agent-plan-executor'

const props = defineProps<{
  results: AgentActionResult[]
  document: WorkspaceDocument
}>()

const emit = defineEmits<{
  open: [result: AgentActionResult]
}>()

const groups = computed(() => [
  { key: 'created', title: '已新建', results: props.results.filter(item => item.outcome === 'created') },
  { key: 'updated', title: '已更新', results: props.results.filter(item => item.outcome === 'updated') },
  { key: 'completed', title: '完成状态已调整', results: props.results.filter(item => item.outcome === 'completed' || item.outcome === 'reopened') },
  { key: 'deleted', title: '已移入回收站', results: props.results.filter(item => item.outcome === 'deleted') },
].filter(group => group.results.length > 0))

function labelFor(result: AgentActionResult) {
  if (result.entityType === 'project') {
    return props.document.projects.find(item => item.id === result.entityId)?.name ?? '项目记录'
  }
  if (result.entityType === 'milestone') {
    return props.document.milestones.find(item => item.id === result.entityId)?.title ?? '里程碑记录'
  }
  return props.document.tasks.find(item => item.id === result.entityId)?.title ?? '任务记录'
}

function outcomeLabel(result: AgentActionResult) {
  if (result.outcome === 'created') return '新建成功'
  if (result.outcome === 'updated') return '更新成功'
  if (result.outcome === 'completed') return '已完成'
  if (result.outcome === 'reopened') return '已恢复未完成'
  return '已移入回收站'
}

function entityLabel(result: AgentActionResult) {
  return result.entityType === 'project' ? '项目' : result.entityType === 'milestone' ? '里程碑' : '任务'
}
</script>

<template>
  <section data-agent-execution-results class="agent-execution-results" aria-labelledby="agent-execution-heading">
    <header class="agent-execution-results__header">
      <div>
        <span class="agent-plan-kicker">APPLIED CHANGES</span>
        <h2 id="agent-execution-heading" class="agent-plan-heading">实际写入结果</h2>
      </div>
      <span class="agent-result-count">{{ results.length }} 项</span>
    </header>

    <section v-for="group in groups" :key="group.key" class="agent-result-group">
      <h3>{{ group.title }}</h3>
      <button
        v-for="result in group.results"
        :key="result.actionId"
        type="button"
        :data-agent-result="result.actionId"
        class="agent-result-row"
        @click="emit('open', result)"
      >
        <span class="agent-result-icon" aria-hidden="true"><UIcon name="i-lucide-check" /></span>
        <span class="agent-result-copy">
          <strong>{{ labelFor(result) }}</strong>
          <small>{{ entityLabel(result) }} · {{ outcomeLabel(result) }} · {{ result.type }}</small>
          <code>{{ result.entityId }}</code>
        </span>
        <UIcon class="agent-result-open" name="i-lucide-arrow-up-right" aria-hidden="true" />
      </button>
    </section>
  </section>
</template>
