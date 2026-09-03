import type { QuarterKey } from '#shared/workspace'
import { getCurrentQuarter } from '../utils/today-view'
type DeleteRequest = { kind: 'project' | 'milestone' | 'task' | 'quarter-goal', id: string } | null

export function useWorkspaceUi() {
  const taskEditor = useState<{ open: boolean, taskId: string | null, defaultProjectId: string | null }>(
    'workspace-task-editor',
    () => ({ open: false, taskId: null, defaultProjectId: null }),
  )
  const projectEditor = useState<{ open: boolean, projectId: string | null }>('workspace-project-editor', () => ({ open: false, projectId: null }))
  const milestoneEditor = useState<{ open: boolean, milestoneId: string | null, defaultProjectId: string | null }>(
    'workspace-milestone-editor',
    () => ({ open: false, milestoneId: null, defaultProjectId: null }),
  )
  const quarterGoalEditor = useState<{ open: boolean, goalId: string | null, defaultQuarter: QuarterKey }>('workspace-quarter-goal-editor', () => ({ open: false, goalId: null, defaultQuarter: getCurrentQuarter(new Date()) }))
  const deleteRequest = useState<DeleteRequest>('workspace-delete-request', () => null)
  const searchPalette = useState<{ open: boolean, query: string }>('workspace-search-palette', () => ({ open: false, query: '' }))
  const workspaceInfoOpen = useState<boolean>('workspace-info-open', () => false)
  const miniMaxBriefRequest = useState<number>('minimax-brief-request', () => 0)
  const dataBridgeDialog = useState<{ open: boolean, tab: 'import' | 'feishu' }>('workspace-data-bridge', () => ({ open: false, tab: 'import' }))

  function openNewTask(defaultProjectId: string | null = null) {
    taskEditor.value = { open: true, taskId: null, defaultProjectId }
  }

  function openEditTask(taskId: string) {
    taskEditor.value = { open: true, taskId, defaultProjectId: null }
  }

  function openNewProject() {
    projectEditor.value = { open: true, projectId: null }
  }

  function openEditProject(projectId: string) {
    projectEditor.value = { open: true, projectId }
  }

  function openNewMilestone(defaultProjectId: string | null = null) {
    milestoneEditor.value = { open: true, milestoneId: null, defaultProjectId }
  }

  function openEditMilestone(milestoneId: string) {
    milestoneEditor.value = { open: true, milestoneId, defaultProjectId: null }
  }

  function openNewQuarterGoal(defaultQuarter: QuarterKey) {
    quarterGoalEditor.value = { open: true, goalId: null, defaultQuarter }
  }

  function openEditQuarterGoal(goalId: string) {
    quarterGoalEditor.value = { open: true, goalId, defaultQuarter: quarterGoalEditor.value.defaultQuarter }
  }

  function askDeleteTask(id: string) {
    deleteRequest.value = { kind: 'task', id }
  }

  function askDeleteProject(id: string) {
    deleteRequest.value = { kind: 'project', id }
  }

  function askDeleteMilestone(id: string) {
    deleteRequest.value = { kind: 'milestone', id }
  }

  function askDeleteQuarterGoal(id: string) {
    deleteRequest.value = { kind: 'quarter-goal', id }
  }

  function closeTaskEditor() {
    taskEditor.value = { open: false, taskId: null, defaultProjectId: null }
  }

  function closeProjectEditor() {
    projectEditor.value = { open: false, projectId: null }
  }

  function closeMilestoneEditor() {
    milestoneEditor.value = { open: false, milestoneId: null, defaultProjectId: null }
  }

  function closeQuarterGoalEditor() {
    quarterGoalEditor.value = { open: false, goalId: null, defaultQuarter: quarterGoalEditor.value.defaultQuarter }
  }

  function closeDelete() {
    deleteRequest.value = null
  }

  function openSearch(query = '') {
    searchPalette.value = { open: true, query }
  }

  function closeSearch() {
    searchPalette.value = { open: false, query: '' }
  }

  function openWorkspaceInfo() {
    workspaceInfoOpen.value = true
  }

  function closeWorkspaceInfo() {
    workspaceInfoOpen.value = false
  }

  function openDataImport() {
    dataBridgeDialog.value = { open: true, tab: 'import' }
  }

  function openFeishuLinks() {
    dataBridgeDialog.value = { open: true, tab: 'feishu' }
  }

  function closeDataBridge() {
    dataBridgeDialog.value = { ...dataBridgeDialog.value, open: false }
  }

  function requestMiniMaxBrief() {
    miniMaxBriefRequest.value += 1
  }

  return {
    taskEditor,
    projectEditor,
    milestoneEditor,
    quarterGoalEditor,
    deleteRequest,
    searchPalette,
    workspaceInfoOpen,
    miniMaxBriefRequest,
    dataBridgeDialog,
    openNewTask,
    openEditTask,
    openNewProject,
    openEditProject,
    openNewMilestone,
    openEditMilestone,
    openNewQuarterGoal,
    openEditQuarterGoal,
    askDeleteTask,
    askDeleteProject,
    askDeleteMilestone,
    askDeleteQuarterGoal,
    closeTaskEditor,
    closeProjectEditor,
    closeMilestoneEditor,
    closeQuarterGoalEditor,
    closeDelete,
    openSearch,
    closeSearch,
    openWorkspaceInfo,
    closeWorkspaceInfo,
    openDataImport,
    openFeishuLinks,
    closeDataBridge,
    requestMiniMaxBrief,
  }
}
