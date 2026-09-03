<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { WorkspaceDocument } from '#shared/workspace'
import type { AgentAction } from '../../services/agent-plan-schema'

const props = defineProps<{
  actions: AgentAction[]
  document: WorkspaceDocument
  confirmationToken: string
  executing: boolean
}>()

const emit = defineEmits<{
  cancel: [confirmationToken: string]
  confirm: [confirmationToken: string]
}>()

const panel = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const submitted = ref(false)
let returnFocus: HTMLElement | null = null

const selectedDeletes = computed(() => props.actions.filter(action =>
  action.selected && action.dangerous && action.type.startsWith('delete')))

const selectedProjectIds = computed(() => activeTargetIds('deleteProject', props.document.projects))
const selectedMilestoneIds = computed(() => activeTargetIds('deleteMilestone', props.document.milestones))
const selectedTaskIds = computed(() => activeTargetIds('deleteTask', props.document.tasks))

const projectCascadeMilestones = computed(() => new Set(props.document.milestones
  .filter(item => item.deletedAt === null
    && selectedProjectIds.value.has(item.projectId)
    && !selectedMilestoneIds.value.has(item.id))
  .map(item => item.id)).size)

const projectCascadeTasks = computed(() => new Set(props.document.tasks
  .filter(item => item.deletedAt === null
    && item.projectId !== null
    && selectedProjectIds.value.has(item.projectId)
    && !selectedTaskIds.value.has(item.id))
  .map(item => item.id)).size)

const milestoneUnlinkTasks = computed(() => new Set(props.document.tasks
  .filter(item => item.deletedAt === null
    && item.milestoneId !== null
    && selectedMilestoneIds.value.has(item.milestoneId)
    && !(item.projectId !== null && selectedProjectIds.value.has(item.projectId))
    && !selectedTaskIds.value.has(item.id))
  .map(item => item.id)).size)

const namedRecords = computed(() => {
  const seen = new Set<string>()
  const records: Array<{ key: string, kind: string, name: string }> = []
  for (const action of selectedDeletes.value) {
    const targetId = action.targetId
    if (!targetId) continue
    const kind = action.type === 'deleteProject' ? 'project' : action.type === 'deleteMilestone' ? 'milestone' : 'task'
    const key = `${kind}:${targetId}`
    if (seen.has(key)) continue
    const record = kind === 'project'
      ? props.document.projects.find(item => item.id === targetId && item.deletedAt === null)
      : kind === 'milestone'
        ? props.document.milestones.find(item => item.id === targetId && item.deletedAt === null)
        : props.document.tasks.find(item => item.id === targetId && item.deletedAt === null)
    if (!record) continue
    seen.add(key)
    records.push({
      key,
      kind: kind === 'project' ? '项目' : kind === 'milestone' ? '里程碑' : '任务',
      name: 'name' in record ? record.name : record.title,
    })
  }
  return records
})

const visibleNames = computed(() => namedRecords.value.slice(0, 6))
const remainingNames = computed(() => Math.max(0, namedRecords.value.length - visibleNames.value.length))

onMounted(() => {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  cancelButton.value?.focus()
})

watch(() => props.executing, (executing) => {
  if (!executing && !submitted.value) cancelButton.value?.focus()
}, { flush: 'post' })

onBeforeUnmount(() => returnFocus?.focus())

function activeTargetIds(
  type: AgentAction['type'],
  records: Array<{ id: string, deletedAt: string | null }>,
) {
  const active = new Set(records.filter(record => record.deletedAt === null).map(record => record.id))
  return new Set(selectedDeletes.value
    .filter(action => action.type === type && action.targetId && active.has(action.targetId))
    .map(action => action.targetId!))
}

function cancel() {
  if (props.executing || submitted.value) return
  emit('cancel', props.confirmationToken)
}

function confirm() {
  if (props.executing || submitted.value || selectedDeletes.value.length === 0) return
  submitted.value = true
  emit('confirm', props.confirmationToken)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }
  if (event.key !== 'Tab') return
  const controls = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
  if (controls.length === 0) return
  const first = controls[0]!
  const last = controls.at(-1)!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
  else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div class="agent-safety-dialog-backdrop" @mousedown.self.prevent>
    <section
      ref="panel"
      data-agent-delete-confirm
      class="agent-safety-dialog agent-safety-dialog__panel is-danger"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-delete-title"
      aria-describedby="agent-delete-description"
      @keydown="handleKeydown"
    >
      <header class="agent-safety-dialog__header">
        <span class="agent-safety-dialog__symbol is-danger" aria-hidden="true">!</span>
        <div>
          <span class="agent-plan-kicker">FINAL CHECK</span>
          <h2 id="agent-delete-title" class="agent-plan-heading">确认移入回收站</h2>
        </div>
      </header>

      <div class="agent-safety-dialog__scroll">
        <p id="agent-delete-description">以下记录将移入回收站，之后仍然可以恢复。</p>
        <dl class="agent-delete-counts">
          <div><dt>项目</dt><dd data-agent-delete-count="project">{{ selectedProjectIds.size }}</dd></div>
          <div><dt>里程碑</dt><dd data-agent-delete-count="milestone">{{ selectedMilestoneIds.size }}</dd></div>
          <div><dt>任务</dt><dd data-agent-delete-count="task">{{ selectedTaskIds.size }}</dd></div>
        </dl>

        <ul class="agent-safety-dialog__list agent-delete-name-list" aria-label="将移入回收站的记录">
          <li v-for="record in visibleNames" :key="record.key" data-agent-delete-name>
            <span>{{ record.kind }}</span><strong>{{ record.name }}</strong>
          </li>
        </ul>
        <p v-if="remainingNames > 0" data-agent-delete-more class="agent-safety-dialog__meta">另 {{ remainingNames }} 项</p>

        <section class="agent-delete-impact" aria-labelledby="agent-delete-impact-title">
          <h3 id="agent-delete-impact-title">关联影响（已去重）</h3>
          <p>
            项目下的 <strong data-agent-project-cascade-milestones>{{ projectCascadeMilestones }}</strong> 个有效里程碑和
            <strong data-agent-project-cascade-tasks>{{ projectCascadeTasks }}</strong> 个有效任务会一同移入回收站。
          </p>
          <p>
            里程碑关联的 <strong data-agent-milestone-unlink>{{ milestoneUnlinkTasks }}</strong> 个其他有效任务只会解除里程碑关联，不会移入回收站。
          </p>
          <p>单独选择的任务只影响任务本身。</p>
        </section>
      </div>

      <footer class="agent-safety-dialog__actions">
        <button ref="cancelButton" type="button" data-agent-delete-cancel class="agent-control agent-quiet-button" :disabled="executing" @click="cancel">取消</button>
        <button
          type="button"
          data-agent-delete-confirm-button
          class="agent-control agent-danger-button"
          :disabled="executing || submitted || selectedDeletes.length === 0"
          @click="confirm"
        >
          {{ executing ? '执行中…' : '确认移入回收站' }}
        </button>
      </footer>
    </section>
  </div>
</template>
