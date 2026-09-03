<script setup lang="ts">
defineProps<{
  selectedCount: number
  totalCount: number
  estimatedMinutes: number
  issueCount: number
  dangerousCount: number
  executing: boolean
  disabled: boolean
  disabledReason: string
}>()

defineEmits<{
  discard: []
  replan: []
  confirm: []
}>()
</script>

<template>
  <footer class="agent-plan-footer">
    <div class="agent-footer-summary agent-plan-meta">
      <strong data-agent-selected-count>{{ selectedCount }} / {{ totalCount }}</strong>
      <span data-agent-estimate>{{ estimatedMinutes }} 分钟</span>
      <span>{{ issueCount }} 个问题</span>
      <span :class="{ 'has-danger': dangerousCount > 0 }">{{ dangerousCount }} 项移入回收站</span>
    </div>
    <p id="agent-confirm-reason" data-agent-confirm-reason class="agent-confirm-reason">{{ disabledReason }}</p>
    <div class="agent-footer-actions">
      <button type="button" class="agent-control agent-quiet-button" @click="$emit('discard')">放弃计划</button>
      <button type="button" class="agent-control agent-quiet-button" @click="$emit('replan')">重新规划</button>
      <button
        type="button"
        data-confirm-agent-plan
        class="agent-control agent-primary-button"
        :disabled="disabled || executing"
        aria-describedby="agent-confirm-reason"
        @click="$emit('confirm')"
      >
        {{ executing ? '执行中…' : `确认执行 ${selectedCount} 项` }}
      </button>
    </div>
  </footer>
</template>
