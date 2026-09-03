<script setup lang="ts">
import { onMounted, ref } from 'vue'
import DashboardTopbar from '../components/dashboard/DashboardTopbar.vue'

const workspace = useWorkspace()
const confirmingEmpty = ref(false)

onMounted(() => {
  void workspace.load()
})

function deletedLabel(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

async function confirmEmptyTrash() {
  await workspace.emptyTrash()
  confirmingEmpty.value = false
}
</script>

<template>
  <main class="dashboard-page trash-page">
    <DashboardTopbar section="工作台" title="回收站" />
    <div class="dashboard-content trash-content">
      <section class="dashboard-heading">
        <div>
          <p>TRASH · 所有删除均可恢复</p>
          <h1>回收站</h1>
          <span>删除只会隐藏记录，不会立即永久清除数据。</span>
        </div>
        <div class="trash-heading-actions">
          <span class="trash-total">{{ workspace.trashCount.value }} 项</span>
          <button v-if="workspace.trashCount.value" type="button" class="empty-trash-button" data-empty-trash @click="confirmingEmpty = true"><UIcon name="i-lucide-trash-2" />清空回收站</button>
        </div>
      </section>

      <section class="trash-panel">
        <header><div><UIcon name="i-lucide-list-checks" /><h2>任务</h2></div><span>{{ workspace.trashedTasks.value.length }}</span></header>
        <article v-for="task in workspace.trashedTasks.value" :key="task.id" data-trash-task class="trash-row">
          <span class="trash-icon"><UIcon name="i-lucide-circle-dashed" /></span>
          <div><strong>{{ task.title }}</strong><small>删除于 {{ deletedLabel(task.deletedAt) }}</small></div>
          <button data-restore-task type="button" @click="workspace.restoreTask(task.id)"><UIcon name="i-lucide-undo-2" />恢复</button>
        </article>
        <p v-if="!workspace.trashedTasks.value.length" class="trash-empty">没有已删除任务</p>
      </section>

      <section v-if="workspace.trashedMilestones.value.length" class="trash-panel">
        <header><div><UIcon name="i-lucide-flag" /><h2>里程碑</h2></div><span>{{ workspace.trashedMilestones.value.length }}</span></header>
        <article v-for="milestone in workspace.trashedMilestones.value" :key="milestone.id" data-trash-milestone class="trash-row">
          <span class="trash-icon"><UIcon name="i-lucide-flag" /></span>
          <div><strong>{{ milestone.title }}</strong><small>删除于 {{ deletedLabel(milestone.deletedAt) }}</small></div>
          <button data-restore-milestone type="button" @click="workspace.restoreMilestone(milestone.id)"><UIcon name="i-lucide-undo-2" />恢复</button>
        </article>
      </section>

      <section v-if="workspace.trashedProjects.value.length" class="trash-panel">
        <header><div><UIcon name="i-lucide-folder" /><h2>项目</h2></div><span>{{ workspace.trashedProjects.value.length }}</span></header>
        <article v-for="project in workspace.trashedProjects.value" :key="project.id" class="trash-row">
          <span class="trash-icon"><i :style="{ background: project.color }" /></span>
          <div><strong>{{ project.name }}</strong><small>恢复项目时会恢复随项目一起删除的任务</small></div>
          <button type="button" @click="workspace.restoreProject(project.id)"><UIcon name="i-lucide-undo-2" />恢复</button>
        </article>
      </section>
    </div>
    <Teleport to="body">
      <div v-if="confirmingEmpty" class="dialog-backdrop" @mousedown.self="confirmingEmpty = false">
        <section class="workspace-dialog empty-trash-dialog" data-empty-trash-dialog role="alertdialog" aria-modal="true" aria-labelledby="empty-trash-title">
          <span class="danger-symbol"><UIcon name="i-lucide-trash-2" /></span>
          <h2 id="empty-trash-title">确认清空回收站？</h2>
          <p>将永久删除 {{ workspace.trashCount.value }} 项数据，此操作无法撤销。</p>
          <div class="dialog-actions">
            <button type="button" class="secondary-action" @click="confirmingEmpty = false">取消</button>
            <button type="button" class="danger-button" data-confirm-empty-trash :disabled="workspace.saving.value" @click="confirmEmptyTrash">{{ workspace.saving.value ? '清空中…' : '永久清空' }}</button>
          </div>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.trash-content{display:grid;gap:18px}.trash-heading-actions{display:flex;gap:8px;align-items:center}.trash-total{display:grid;min-width:52px;height:34px;place-items:center;border:1px solid #dddafc;border-radius:8px;background:#f4f2ff;color:#6258d7;font-size:13px;font-weight:750}.empty-trash-button{display:flex;gap:6px;align-items:center;height:34px;padding:0 12px;border:1px solid #efc7c7;border-radius:8px;background:#fff7f7;color:#b94848;font-size:13px;font-weight:700;cursor:pointer}.empty-trash-button:hover{border-color:#df9d9d;background:#fff0f0}.trash-panel{overflow:hidden;border:1px solid #e1e3e8;border-radius:11px;background:#fff;box-shadow:0 5px 18px rgb(35 39 50 / 4%)}.trash-panel>header{display:flex;align-items:center;justify-content:space-between;min-height:50px;padding:0 16px;border-bottom:1px solid #eceef1}.trash-panel>header div{display:flex;gap:8px;align-items:center}.trash-panel h2{margin:0;font-size:15px}.trash-panel>header span{color:#969aa3;font-size:12px}.trash-row{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:10px;align-items:center;min-height:62px;padding:8px 14px;border-bottom:1px solid #f0f1f3}.trash-row:last-child{border-bottom:0}.trash-icon{display:grid;width:30px;height:30px;place-items:center;border-radius:8px;background:#f3f3f6;color:#858a94}.trash-icon i{width:9px;height:9px;border-radius:50%}.trash-row>div{display:grid;gap:4px}.trash-row strong{font-size:14px}.trash-row small{color:#92969f;font-size:11px}.trash-row button{display:flex;gap:5px;align-items:center;min-height:31px;padding:0 10px;border:1px solid #dedfe5;border-radius:7px;background:#fff;color:#5d56bd;font-size:12px;cursor:pointer}.trash-row button:hover{border-color:#aaa4eb;background:#f8f7ff}.trash-empty{margin:0;padding:24px;color:#969aa2;font-size:13px;text-align:center}.empty-trash-dialog{width:min(100%,430px);padding:22px}.empty-trash-dialog h2{margin:12px 0 0;font-size:19px}.empty-trash-dialog p{margin:8px 0 0;color:#656a73;font-size:14px;line-height:1.6}.empty-trash-dialog .dialog-actions{margin-top:20px}
@media(max-width:760px){.trash-heading-actions{align-items:flex-end;flex-direction:column}.empty-trash-button{padding:0 9px}}
</style>
