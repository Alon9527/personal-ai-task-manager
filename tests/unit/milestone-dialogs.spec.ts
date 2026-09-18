import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import MilestoneEditorDialog from '../../app/components/workspace/MilestoneEditorDialog.vue'
import MilestoneActionsMenu from '../../app/components/workspace/MilestoneActionsMenu.vue'
import WorkspaceOverlays from '../../app/components/workspace/WorkspaceOverlays.vue'
import { useWorkspaceUi } from '../../app/composables/useWorkspaceUi'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import { createWorkspaceModel } from '../../app/models/workspace-model'

const workspaceHarness = vi.hoisted(() => ({ current: undefined as unknown }))
vi.mock('../../app/composables/useWorkspace', () => ({
  useWorkspace: () => workspaceHarness.current,
}))

const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const MILESTONE_ID = '20000000-0000-4000-8000-000000000001'

const projects = [{ id: PROJECT_ID, name: '官网改版' }] as never
const milestone = {
  id: MILESTONE_ID,
  ownerId: '00000000-0000-4000-8000-000000000001',
  projectId: PROJECT_ID,
  title: '首页评审',
  description: '',
  targetDate: null,
  status: 'planned',
  progressMode: 'auto',
  progress: 0,
  sortOrder: 0,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  deletedAt: null,
} as const

describe('milestone editors', () => {
  it('disables automatic numeric progress and submits every field', async () => {
    const wrapper = await mountSuspended(MilestoneEditorDialog, {
      props: { open: true, milestone: null, projects, defaultProjectId: PROJECT_ID },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.get('[name="title"]').setValue('  完成首页评审  ')
    await wrapper.get('[name="description"]').setValue('确认视觉与交互')
    await wrapper.get('[name="targetDate"]').setValue('2026-08-16')
    await wrapper.get('[name="status"]').setValue('planned')
    await wrapper.get('[name="progressMode"]').setValue('auto')
    expect(wrapper.get('[name="progress"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      projectId: PROJECT_ID,
      title: '完成首页评审',
      description: '确认视觉与交互',
      targetDate: '2026-08-16',
      status: 'planned',
      progressMode: 'auto',
      progress: 0,
    })
  })

  it('allows a validated manual progress value', async () => {
    const wrapper = await mountSuspended(MilestoneEditorDialog, {
      props: { open: true, milestone: null, projects, defaultProjectId: PROJECT_ID },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.get('[name="title"]').setValue('视觉验收')
    await wrapper.get('[name="progressMode"]').setValue('manual')
    await wrapper.get('[name="progress"]').setValue(42)
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ progressMode: 'manual', progress: 42 })
  })

  it('initializes an existing milestone and submits its edited values', async () => {
    const existing = { ...milestone, progressMode: 'manual' as const, progress: 37, status: 'blocked' as const }
    const wrapper = await mountSuspended(MilestoneEditorDialog, {
      props: { open: true, milestone: existing, projects },
      global: { stubs: { Teleport: true } },
    })

    expect((wrapper.get('[name="projectId"]').element as HTMLSelectElement).value).toBe(PROJECT_ID)
    expect((wrapper.get('[name="title"]').element as HTMLInputElement).value).toBe('首页评审')
    expect((wrapper.get('[name="progress"]').element as HTMLInputElement).value).toBe('37')
    await wrapper.get('[name="title"]').setValue('  首页验收  ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      projectId: PROJECT_ID,
      title: '首页验收',
      description: '',
      targetDate: null,
      status: 'blocked',
      progressMode: 'manual',
      progress: 37,
    })
  })

  it('clears milestone validation when the dialog is reopened', async () => {
    const wrapper = await mountSuspended(MilestoneEditorDialog, {
      props: { open: true, milestone: null, projects, defaultProjectId: PROJECT_ID },
      global: { stubs: { Teleport: true } },
    })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('exposes edit, reorder, status, and delete actions', async () => {
    const wrapper = await mountSuspended(MilestoneActionsMenu, {
      props: { milestone, first: false, last: false },
    })

    await wrapper.get('[data-action="edit"]').trigger('click')
    await wrapper.get('[data-action="start"]').trigger('click')
    await wrapper.get('[data-action="move-up"]').trigger('click')
    await wrapper.get('[data-action="delete"]').trigger('click')

    expect(wrapper.emitted('edit')).toHaveLength(1)
    expect(wrapper.emitted('start')).toHaveLength(1)
    expect(wrapper.emitted('move-up')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })

  it.each([
    ['planned', 'start', 'plan'],
    ['blocked', 'start', 'block'],
    ['completed', 'start', 'complete'],
  ] as const)('shows valid actions for %s milestones', async (status, visibleAction, hiddenAction) => {
    const wrapper = await mountSuspended(MilestoneActionsMenu, {
      props: { milestone: { ...milestone, status }, first: true, last: true },
    })

    expect(wrapper.find(`[data-action="${visibleAction}"]`).exists()).toBe(true)
    expect(wrapper.find(`[data-action="${hiddenAction}"]`).exists()).toBe(false)
    expect(wrapper.get('[data-action="move-up"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-action="move-down"]').attributes('disabled')).toBeDefined()
  })
})

describe('milestone overlay wiring', () => {
  afterEach(() => {
    workspaceHarness.current = undefined
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('dispatches create, update, and real milestone deletion', async () => {
    const input = {
      projectId: PROJECT_ID,
      title: '首页评审',
      description: '',
      targetDate: null,
      status: 'planned' as const,
      progressMode: 'auto' as const,
      progress: 0,
    }
    const createMilestone = vi.fn().mockResolvedValue(undefined)
    const updateMilestone = vi.fn().mockResolvedValue(undefined)
    const deleteMilestone = vi.fn().mockResolvedValue(undefined)
    const workspace = {
      backendMode: ref('local'),
      tasks: ref([{ id: '30000000-0000-4000-8000-000000000001', projectId: PROJECT_ID, milestoneId: MILESTONE_ID, title: '关联任务' }]),
      projects: ref([{ id: PROJECT_ID, name: '官网改版' }]),
      milestones: ref([milestone]),
      quarterGoals: ref([]),
      saving: ref(false),
      error: ref(null),
      lastDeleted: ref(null),
      createMilestone,
      updateMilestone,
      deleteMilestone,
    }
    const ui = useWorkspaceUi()
    ui.taskEditor.value = { open: false, taskId: null, defaultProjectId: null }
    ui.projectEditor.value = { open: false, projectId: null }
    ui.milestoneEditor.value = { open: true, milestoneId: null, defaultProjectId: PROJECT_ID }
    ui.deleteRequest.value = null
    workspaceHarness.current = workspace

    const wrapper = await mountSuspended(WorkspaceOverlays, {
      global: {
        stubs: {
          TaskEditorDialog: true,
          ProjectEditorDialog: true,
          MilestoneEditorDialog: defineComponent({
            emits: ['save'],
            template: '<button data-save-milestone @click="$emit(\'save\', input)">save</button>',
            setup: () => ({ input }),
          }),
          QuarterGoalEditorDialog: true,
          DeleteConfirmDialog: defineComponent({
            props: ['kind', 'affectedTaskCount'],
            emits: ['confirm'],
            template: '<button data-confirm-overlay-delete :data-kind="kind" :data-count="affectedTaskCount" @click="$emit(\'confirm\')">delete</button>',
          }),
          WorkspaceCommandPalette: true,
          WorkspaceInfoDialog: true,
        },
      },
    })

    await wrapper.get('[data-save-milestone]').trigger('click')
    await flushPromises()
    expect(createMilestone).toHaveBeenCalledExactlyOnceWith(input)
    expect(ui.milestoneEditor.value.open).toBe(false)

    ui.milestoneEditor.value = { open: true, milestoneId: MILESTONE_ID, defaultProjectId: null }
    await wrapper.get('[data-save-milestone]').trigger('click')
    await flushPromises()
    expect(updateMilestone).toHaveBeenCalledExactlyOnceWith(MILESTONE_ID, input)

    ui.deleteRequest.value = { kind: 'milestone', id: MILESTONE_ID }
    await flushPromises()
    expect(wrapper.get('[data-confirm-overlay-delete]').attributes('data-kind')).toBe('milestone')
    expect(wrapper.get('[data-confirm-overlay-delete]').attributes('data-count')).toBe('1')
    await wrapper.get('[data-confirm-overlay-delete]').trigger('click')
    await flushPromises()
    expect(deleteMilestone).toHaveBeenCalledExactlyOnceWith(MILESTONE_ID)
    expect(ui.deleteRequest.value).toBeNull()
    wrapper.unmount()
  })

  it('renders refresh errors beside clickable undo for the full eight-second window', async () => {
    vi.useFakeTimers()
    const gateway = new LocalWorkspaceGateway(localStorage, () => '2026-08-13T08:00:00.000Z')
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject({ name: '官网改版', color: '#3366FF' })
    const item = await gateway.createMilestone({
      projectId: project.id, title: '持久删除', description: '', targetDate: null,
      status: 'planned', progressMode: 'auto', progress: 0,
    })
    const model = createWorkspaceModel(gateway)
    await model.load()
    const originalLoad = gateway.loadWorkspace.bind(gateway)
    const loadSpy = vi.spyOn(gateway, 'loadWorkspace').mockRejectedValueOnce(new Error('refresh unavailable'))
      .mockImplementation(originalLoad)
    await model.deleteMilestone(item.id)
    workspaceHarness.current = model
    const ui = useWorkspaceUi()
    ui.closeTaskEditor()
    ui.closeProjectEditor()
    ui.closeMilestoneEditor()
    ui.closeQuarterGoalEditor()
    ui.closeDelete()

    const wrapper = await mountSuspended(WorkspaceOverlays, {
      global: { stubs: {
        TaskEditorDialog: true, ProjectEditorDialog: true, MilestoneEditorDialog: true,
        QuarterGoalEditorDialog: true, DeleteConfirmDialog: true,
        WorkspaceCommandPalette: true, WorkspaceInfoDialog: true,
      } },
    })

    expect(wrapper.text()).toContain('refresh unavailable')
    expect(wrapper.text()).toContain('撤销')
    expect(model.milestones.value.map(milestone => milestone.id)).not.toContain(item.id)
    vi.advanceTimersByTime(7_999)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('撤销')
    await wrapper.get('[data-dismiss-error]').trigger('click')
    expect(model.error.value).toBeNull()
    loadSpy.mockRejectedValueOnce(new Error('restore refresh unavailable'))
    await wrapper.get('.undo-action').trigger('click')
    await flushPromises()
    expect(model.milestones.value.map(milestone => milestone.id)).toContain(item.id)
    expect(model.lastDeleted.value).toBeNull()
    expect(wrapper.text()).toContain('restore refresh unavailable')
    expect(wrapper.text()).not.toContain('撤销')
    wrapper.unmount()
  })

  it('rolls back a persist failure and renders no undo action', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject({ name: '官网改版', color: '#3366FF' })
    const item = await gateway.createMilestone({
      projectId: project.id, title: '未持久删除', description: '', targetDate: null,
      status: 'planned', progressMode: 'auto', progress: 0,
    })
    const model = createWorkspaceModel(gateway)
    await model.load()
    vi.spyOn(gateway, 'deleteMilestone').mockRejectedValueOnce(new Error('persist unavailable'))

    await expect(model.deleteMilestone(item.id)).rejects.toThrow('persist unavailable')

    expect(model.milestones.value.map(milestone => milestone.id)).toContain(item.id)
    expect(model.lastDeleted.value).toBeNull()
  })
})

const Harness = defineComponent({
  setup() {
    return { ui: useWorkspaceUi() }
  },
  template: '<div />',
})

describe('milestone workspace UI state', () => {
  it('opens new and existing milestones and coordinates deletion', async () => {
    const wrapper = await mountSuspended(Harness)
    const ui = (wrapper.vm as unknown as { ui: ReturnType<typeof useWorkspaceUi> }).ui

    ui.openNewMilestone(PROJECT_ID)
    expect(ui.milestoneEditor.value).toEqual({ open: true, milestoneId: null, defaultProjectId: PROJECT_ID })
    ui.openEditMilestone(MILESTONE_ID)
    expect(ui.milestoneEditor.value).toEqual({ open: true, milestoneId: MILESTONE_ID, defaultProjectId: null })
    ui.closeMilestoneEditor()
    expect(ui.milestoneEditor.value).toEqual({ open: false, milestoneId: null, defaultProjectId: null })

    ui.askDeleteMilestone(MILESTONE_ID)
    expect(ui.deleteRequest.value).toEqual({ kind: 'milestone', id: MILESTONE_ID })
    ui.closeDelete()
  })
})
