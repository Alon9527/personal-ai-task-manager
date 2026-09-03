<script setup lang="ts">
import { computed } from 'vue'
import TaskEditorDialog from './TaskEditorDialog.vue'
import ProjectEditorDialog from './ProjectEditorDialog.vue'
import MilestoneEditorDialog from './MilestoneEditorDialog.vue'
import DeleteConfirmDialog from './DeleteConfirmDialog.vue'
import QuarterGoalEditorDialog from './QuarterGoalEditorDialog.vue'
import WorkspaceCommandPalette from './WorkspaceCommandPalette.vue'
import WorkspaceInfoDialog from './WorkspaceInfoDialog.vue'
import DataBridgeDialog from './DataBridgeDialog.vue'
import type { CreateMilestoneInput, CreateProjectInput, CreateQuarterGoalInput, CreateTaskInput } from '../../data/workspace-gateway'

const workspace = useWorkspace()
const ui = useWorkspaceUi()
const selectedTask = computed(() => workspace.tasks.value.find(task => task.id === ui.taskEditor.value.taskId) ?? null)
const selectedProject = computed(() => workspace.projects.value.find(project => project.id === ui.projectEditor.value.projectId) ?? null)
const selectedMilestone = computed(() => workspace.milestones.value.find(milestone => milestone.id === ui.milestoneEditor.value.milestoneId) ?? null)
const selectedQuarterGoal = computed(() => workspace.quarterGoals.value.find(goal => goal.id === ui.quarterGoalEditor.value.goalId) ?? null)
const deleteRecord = computed(() => {
  const request = ui.deleteRequest.value
  if (!request) return null
  if (request.kind === 'task') {
    const task = workspace.tasks.value.find(item => item.id === request.id)
    return task ? { ...request, name: task.title, affectedTaskCount: 0, affectedMilestoneCount: 0 } : null
  }
  if (request.kind === 'milestone') {
    const milestone = workspace.milestones.value.find(item => item.id === request.id)
    return milestone
      ? { ...request, name: milestone.title, affectedTaskCount: workspace.tasks.value.filter(task => task.milestoneId === milestone.id).length, affectedMilestoneCount: 0 }
      : null
  }
  if (request.kind === 'quarter-goal') {
    const goal = workspace.quarterGoals.value.find(item => item.id === request.id)
    return goal ? { ...request, name: goal.title, affectedTaskCount: 0, affectedMilestoneCount: 0 } : null
  }
  const project = workspace.projects.value.find(item => item.id === request.id)
  return project
    ? {
        ...request,
        name: project.name,
        affectedTaskCount: workspace.tasks.value.filter(task => task.projectId === project.id).length,
        affectedMilestoneCount: workspace.milestones.value.filter(milestone => milestone.projectId === project.id).length,
      }
    : null
})

async function saveTask(input: CreateTaskInput) {
  if (selectedTask.value) await workspace.updateTask(selectedTask.value.id, input)
  else await workspace.createTask(input)
  ui.closeTaskEditor()
}

async function saveProject(input: CreateProjectInput) {
  if (selectedProject.value) await workspace.updateProject(selectedProject.value.id, input)
  else await workspace.createProject(input)
  ui.closeProjectEditor()
}

async function saveMilestone(input: CreateMilestoneInput) {
  if (selectedMilestone.value) await workspace.updateMilestone(selectedMilestone.value.id, input)
  else await workspace.createMilestone(input)
  ui.closeMilestoneEditor()
}

async function saveQuarterGoal(input: CreateQuarterGoalInput) {
  if (selectedQuarterGoal.value) await workspace.updateQuarterGoal(selectedQuarterGoal.value.id, input)
  else await workspace.createQuarterGoal(input)
  ui.closeQuarterGoalEditor()
}

async function confirmDelete() {
  const request = ui.deleteRequest.value
  if (!request) return
  if (request.kind === 'task') await workspace.deleteTask(request.id)
  else if (request.kind === 'milestone') await workspace.deleteMilestone(request.id)
  else if (request.kind === 'quarter-goal') await workspace.deleteQuarterGoal(request.id)
  else await workspace.deleteProject(request.id)
  ui.closeDelete()
}
</script>

<template>
  <TaskEditorDialog
    :open="ui.taskEditor.value.open"
    :task="selectedTask"
    :projects="workspace.projects.value"
    :milestones="workspace.milestones.value"
    :default-project-id="ui.taskEditor.value.defaultProjectId"
    :attachments-enabled="workspace.backendMode.value !== 'supabase'"
    @save="saveTask"
    @close="ui.closeTaskEditor"
  />
  <ProjectEditorDialog
    :open="ui.projectEditor.value.open"
    :project="selectedProject"
    @save="saveProject"
    @close="ui.closeProjectEditor"
  />
  <MilestoneEditorDialog
    :open="ui.milestoneEditor.value.open"
    :milestone="selectedMilestone"
    :projects="workspace.projects.value"
    :default-project-id="ui.milestoneEditor.value.defaultProjectId"
    @save="saveMilestone"
    @close="ui.closeMilestoneEditor"
  />
  <QuarterGoalEditorDialog
    :open="ui.quarterGoalEditor.value.open"
    :goal="selectedQuarterGoal"
    :default-quarter="ui.quarterGoalEditor.value.defaultQuarter"
    :saving="workspace.saving.value"
    @save="saveQuarterGoal"
    @close="ui.closeQuarterGoalEditor"
  />
  <DeleteConfirmDialog
    v-if="deleteRecord"
    :open="true"
    :kind="deleteRecord.kind"
    :name="deleteRecord.name"
    :affected-task-count="deleteRecord.affectedTaskCount"
    :affected-milestone-count="deleteRecord.affectedMilestoneCount"
    @confirm="confirmDelete"
    @close="ui.closeDelete"
  />
  <DataBridgeDialog
    :open="ui.dataBridgeDialog.value.open"
    :initial-tab="ui.dataBridgeDialog.value.tab"
    @close="ui.closeDataBridge"
  />
  <WorkspaceCommandPalette />
  <WorkspaceInfoDialog />
  <div v-if="workspace.error.value" class="workspace-toast" role="status">
    <UIcon name="i-lucide-circle-alert" /><span>{{ workspace.error.value }}</span>
    <button type="button" class="toast-close error-toast-close" data-dismiss-error aria-label="关闭错误提示" @click="workspace.dismissError"><UIcon name="i-lucide-x" /></button>
  </div>
  <div v-if="workspace.lastDeleted.value" class="workspace-toast undo-toast" :class="{ 'with-error': workspace.error.value }" role="status">
    <UIcon name="i-lucide-trash-2" />
    <span>“{{ workspace.lastDeleted.value.label }}”已移入回收站</span>
    <button type="button" class="undo-action" @click="workspace.undoLastDelete">撤销</button>
    <button type="button" class="toast-close" data-dismiss-undo aria-label="关闭撤销提示" @click="workspace.dismissLastDelete"><UIcon name="i-lucide-x" /></button>
  </div>
</template>

<style>
.dialog-backdrop{position:fixed;z-index:100;inset:0;display:grid;place-items:center;padding:18px;background:rgb(15 17 22 / 46%);backdrop-filter:blur(3px)}
.workspace-dialog{width:min(100%,560px);overflow:hidden;border:1px solid #dfe1e6;border-radius:11px;background:#fff;box-shadow:0 24px 80px rgb(20 24 34 / 24%);color:#24272d}
.workspace-dialog.project-editor,.workspace-dialog.delete-dialog{width:min(100%,420px)}
.dialog-header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid #eceef1}
.dialog-header small{color:#8378e8;font-size:11px;font-weight:800;letter-spacing:.14em}
.dialog-header h2,.delete-dialog h2{margin:3px 0 0;font-size:17px;letter-spacing:-.02em}
.dialog-header>button{display:grid;width:30px;height:30px;place-items:center;border:0;border-radius:7px;background:transparent;color:#868a92;cursor:pointer}
.workspace-dialog form{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:18px 20px 20px}
.form-field{display:grid;gap:6px}.form-field-wide{grid-column:1/-1}.form-field>span{color:#656a73;font-size:12px;font-weight:650}
.form-field input,.form-field select,.form-field textarea,.color-control input[aria-label="颜色值"]{width:100%;border:1px solid #dfe1e6;border-radius:7px;outline:0;background:#fff;color:#30333a;font:inherit;font-size:14px}
.form-field input,.form-field select{height:36px;padding:0 10px}.form-field textarea{resize:vertical;padding:9px 10px;line-height:1.5}
.form-field input:focus,.form-field select:focus,.form-field textarea:focus{border-color:#9189eb;box-shadow:0 0 0 3px #efedff}
.focus-toggle{display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid #e5e6ea;border-radius:8px;background:#fafafd;font-size:13px}
.focus-toggle>span{display:grid;gap:2px}.focus-toggle small{color:#8c9098}.inline-error{grid-column:1/-1;margin:0;color:#b94444;font-size:13px}
.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}.dialog-actions button{min-height:34px;padding:0 13px;border-radius:7px;font-size:13px;cursor:pointer}
.secondary-action{border:1px solid #dfe1e5;background:#fff;color:#666b74}.primary-action{border:1px solid #6258d7;background:#6b61df;color:#fff}.danger-button{border:1px solid #d65656;background:#d65656;color:#fff}
.color-control{display:grid;grid-template-columns:42px 1fr;gap:8px}.color-control input[type="color"]{height:36px;padding:3px}
.delete-dialog{padding:22px}.delete-dialog>h2{margin-top:12px}.delete-dialog>p{margin:8px 0 0;color:#666b74;font-size:14px;line-height:1.55}.danger-symbol{display:grid;width:36px;height:36px;place-items:center;border-radius:9px;background:#ffeded;color:#c84e4e}.cascade-note{padding:9px 10px;border-radius:7px;background:#fff6e8;color:#9b6624!important}.delete-dialog .dialog-actions{margin-top:20px}
.action-menu{position:absolute;z-index:30;right:4px;top:calc(100% - 4px);display:grid;width:168px;padding:5px;border:1px solid #dedfe4;border-radius:8px;background:#fff;box-shadow:0 14px 36px rgb(22 27 38 / 18%)}
.action-menu button{display:flex;gap:8px;align-items:center;min-height:31px;padding:0 9px;border:0;border-radius:5px;background:transparent;color:#4d5159;font-size:13px;text-align:left;cursor:pointer}.action-menu button:hover{background:#f2f3f5}.action-menu button:disabled{opacity:.36;cursor:not-allowed}.action-menu .danger-action{color:#c34f4f}.action-divider{height:1px;margin:4px 3px;background:#eceef1}
.task-menu-wrap,.project-menu-wrap{position:relative}.task-menu-toggle,.project-menu-toggle{display:grid;width:26px;height:26px;place-items:center;border:0;border-radius:6px;background:transparent;color:#8d9199;cursor:pointer}.task-menu-toggle:hover,.project-menu-toggle:hover{background:#f0f1f3;color:#4d5158}
.project-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 26px;align-items:center}.project-row .project-link{min-width:0}.project-row .action-menu{right:0;top:32px}
.mode-badge{display:inline-flex;gap:5px;align-items:center;margin-left:6px;padding:4px 7px;border:1px solid #cae8d9;border-radius:999px;background:#f0faf5;color:#367b5d;font-size:11px}.mode-badge>span{width:5px;height:5px;border-radius:50%;background:#43a577}
.empty-state{display:grid;place-items:center;min-height:92px;padding:18px;color:#92969e;font-size:13px;text-align:center}.empty-state button{margin-top:8px;border:0;background:transparent;color:#665bd7;cursor:pointer}.loading-panel{display:grid;place-items:center;min-height:260px;color:#858a93;font-size:14px}.workspace-toast{position:fixed;z-index:120;right:24px;bottom:24px;display:flex;gap:8px;align-items:center;max-width:360px;padding:11px 13px;border:1px solid #efc8c8;border-radius:9px;background:#fff6f6;color:#a83f3f;font-size:13px;box-shadow:0 12px 30px rgb(35 22 22 / 16%)}
.progress-input{display:grid;grid-template-columns:minmax(0,1fr) 48px;gap:8px;align-items:center}.progress-input strong{display:grid;height:36px;place-items:center;border:1px solid #dedfe5;border-radius:7px;background:#f7f7fb;color:#6258d7;font-size:13px}.goal-action-menu{width:180px}
.undo-toast{border-color:#d9d5ff;background:#f8f7ff;color:#4f49a8}.undo-toast span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.undo-toast button{border:0;background:transparent;color:#6157d0;cursor:pointer}.undo-action{margin-left:auto;font-weight:750}.toast-close{display:grid;width:24px;height:24px;flex:0 0 auto;place-items:center;border-radius:6px!important;color:#8b87b5!important}.toast-close:hover{background:#ece9ff}
.workspace-toast>span{min-width:0}.error-toast-close{margin-left:auto;color:#a83f3f!important}.undo-toast.with-error{bottom:78px}
@media(max-width:760px){.workspace-dialog form{grid-template-columns:1fr}.form-field-wide{grid-column:auto}.task-menu-toggle{display:grid}.action-menu{position:fixed;right:14px;bottom:76px;top:auto;width:190px}.workspace-toast{right:14px;bottom:78px;left:14px}.undo-toast.with-error{bottom:136px}}
</style>
