<script setup lang="ts">
import type { AgentPlanDraftV1 } from '../../services/agent-plan-schema'

defineProps<{
  draft: AgentPlanDraftV1
  selectedCount: number
}>()

defineEmits<{ replan: [] }>()

const statusLabels: Record<AgentPlanDraftV1['status'], string> = {
  draft: '待确认',
  conflicted: '有冲突',
  failed: '执行失败',
  applied: '已执行',
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}
</script>

<template>
  <header class="agent-plan-header">
    <div class="agent-plan-title-block">
      <span class="agent-plan-kicker">AI PLAN REVIEW</span>
      <h1 class="agent-plan-heading">审阅 AI 计划</h1>
      <p>{{ draft.question }}</p>
    </div>
    <div class="agent-plan-header-side">
      <dl class="agent-plan-meta">
        <div><dt>模型</dt><dd>{{ draft.model }}</dd></div>
        <div><dt>更新</dt><dd>{{ formatTime(draft.updatedAt) }}</dd></div>
        <div><dt>状态</dt><dd>{{ statusLabels[draft.status] }}</dd></div>
        <div><dt>选择</dt><dd data-agent-selected-count>{{ selectedCount }} / {{ draft.actions.length }}</dd></div>
      </dl>
      <button type="button" data-agent-replan class="agent-control agent-quiet-button" @click="$emit('replan')">
        <UIcon name="i-lucide-refresh-cw" />重新规划
      </button>
    </div>
  </header>
</template>
