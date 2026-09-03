import { beforeEach, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import type { Milestone, Project, Task, WorkspaceDocument } from '../../shared/workspace'
import { createDemoWorkspace, DEMO_PROJECT_IDS } from '../../app/data/demo-workspace'
import ProjectProgressPanel from '../../app/components/projects/ProjectProgressPanel.vue'
import TodayPage from '../../app/pages/index.vue'

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const PROJECT_ID = '10000000-0000-4000-8000-000000000002'
const FIRST_MILESTONE_ID = '40000000-0000-4000-8000-000000000001'
const SECOND_MILESTONE_ID = '40000000-0000-4000-8000-000000000002'
const COMPLETED_MILESTONE_ID = '40000000-0000-4000-8000-000000000003'
const UNDATED_MILESTONE_ID = '40000000-0000-4000-8000-000000000004'
const TODAY_MILESTONE_ID = '40000000-0000-4000-8000-000000000005'
const CREATED_AT = '2026-08-01T00:00:00.000Z'

const project: Project = {
  id: PROJECT_ID,
  ownerId: OWNER_ID,
  name: '官网改版',
  description: '',
  color: '#7165e3',
  priority: 'high',
  status: 'active',
  targetDate: '2026-08-31',
  sortOrder: 0,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  deletedAt: null,
}

function milestone(id: string, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    title: id,
    description: '',
    targetDate: null,
    status: 'planned',
    progressMode: 'auto',
    progress: 0,
    sortOrder: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function task(id: string, milestoneId: string, completed = false): Task {
  return {
    id,
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    milestoneId,
    title: id,
    description: '',
    priority: null,
    dueDate: null,
    dueTime: null,
    isFocus: false,
    status: completed ? 'done' : 'todo',
    importance: 'normal',
    estimatedMinutes: null,
    reminderAt: null,
    snoozedUntil: null,
    lastRemindedAt: null,
    sortOrder: 0,
    completedAt: completed ? '2026-08-02T00:00:00.000Z' : null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  }
}

const milestones = [
  milestone(FIRST_MILESTONE_ID, {
    title: '完成首页评审',
    targetDate: '2026-08-12',
    status: 'in_progress',
    sortOrder: 4,
  }),
  milestone(SECOND_MILESTONE_ID, {
    title: '上线准备',
    targetDate: '2026-08-20',
    progressMode: 'manual',
    progress: 50,
    sortOrder: 0,
  }),
  milestone(COMPLETED_MILESTONE_ID, {
    title: '更早但已完成',
    targetDate: '2026-08-10',
    status: 'completed',
    sortOrder: 3,
  }),
  milestone(UNDATED_MILESTONE_ID, {
    title: '未设日期节点',
    targetDate: null,
    sortOrder: 1,
  }),
  milestone(TODAY_MILESTONE_ID, {
    title: '今天交付',
    targetDate: '2026-08-13',
    sortOrder: 2,
  }),
]
const tasks = [
  task('50000000-0000-4000-8000-000000000001', FIRST_MILESTONE_ID, true),
  task('50000000-0000-4000-8000-000000000002', FIRST_MILESTONE_ID),
  task('50000000-0000-4000-8000-000000000003', SECOND_MILESTONE_ID),
]

describe('project progress panel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    const ui = useWorkspaceUi()
    ui.closeMilestoneEditor()
    ui.closeDelete()
  })

  it('renders calculated progress, next and overdue milestone state, rows, and linked task counts', async () => {
    const wrapper = await mountSuspended(ProjectProgressPanel, {
      props: { project, milestones, tasks, now: new Date('2026-08-13T08:00:00+08:00') },
    })

    expect(wrapper.get('[data-project-progress]').text()).toContain('40%')
    expect(wrapper.get('[data-next-milestone] .next-milestone-title').text()).toBe('完成首页评审')
    expect(wrapper.get('[data-next-milestone]').text()).not.toContain('更早但已完成')
    expect(wrapper.get('[data-next-milestone]').text()).toContain('已逾期')
    expect(wrapper.findAll('[data-milestone-row]')).toHaveLength(5)
    const overdueRow = wrapper.findAll('[data-milestone-row]').find(row => row.text().includes('完成首页评审'))
    const todayRow = wrapper.findAll('[data-milestone-row]').find(row => row.text().includes('今天交付'))
    expect(overdueRow?.text()).toContain('已逾期')
    expect(todayRow?.text()).not.toContain('已逾期')
    expect(wrapper.findAll('[data-linked-task-count]').map(item => item.text())).toEqual([
      expect.stringContaining('1 个关联任务'),
      expect.stringContaining('0 个关联任务'),
      expect.stringContaining('0 个关联任务'),
      expect.stringContaining('0 个关联任务'),
      expect.stringContaining('2 个关联任务'),
    ])
    expect(wrapper.findAll('[data-milestone-progress]').map(item => item.text())).toEqual(['50%', '0%', '0%', '100%', '50%'])
  })

  it('dispatches status, reorder, and delete through the rendered milestone menus', async () => {
    const wrapper = await mountSuspended(ProjectProgressPanel, {
      props: { project, milestones, tasks, now: new Date('2026-08-13T08:00:00+08:00') },
    })
    const workspace = useWorkspace()
    const ui = useWorkspaceUi()
    const updateMilestone = vi.spyOn(workspace, 'updateMilestone').mockResolvedValue(undefined)
    const reorderMilestones = vi.spyOn(workspace, 'reorderMilestones').mockResolvedValue(undefined)

    await wrapper.get('[aria-label="完成首页评审操作菜单"]').trigger('click')
    await wrapper.get('[data-action="block"]').trigger('click')
    await flushPromises()
    expect(updateMilestone).toHaveBeenCalledExactlyOnceWith(FIRST_MILESTONE_ID, { status: 'blocked' })

    await wrapper.get('[aria-label="上线准备操作菜单"]').trigger('click')
    await wrapper.get('[data-action="move-down"]').trigger('click')
    await flushPromises()
    expect(reorderMilestones).toHaveBeenCalledExactlyOnceWith(PROJECT_ID, [
      UNDATED_MILESTONE_ID,
      SECOND_MILESTONE_ID,
      TODAY_MILESTONE_ID,
      COMPLETED_MILESTONE_ID,
      FIRST_MILESTONE_ID,
    ])

    await wrapper.get('[aria-label="上线准备操作菜单"]').trigger('click')
    await wrapper.get('[data-action="delete"]').trigger('click')
    expect(ui.deleteRequest.value).toEqual({ kind: 'milestone', id: SECOND_MILESTONE_ID })
  })

  it('opens the real create and edit state through a keyboard-friendly milestone menu', async () => {
    const wrapper = await mountSuspended(ProjectProgressPanel, {
      props: { project, milestones, tasks, now: new Date('2026-08-13T08:00:00+08:00') },
    })
    const ui = useWorkspaceUi()

    const createButton = wrapper.get('[data-new-milestone]')
    expect(createButton.element.tagName).toBe('BUTTON')
    await createButton.trigger('click')
    expect(ui.milestoneEditor.value).toMatchObject({ open: true, defaultProjectId: PROJECT_ID })

    const menuButton = wrapper.get(`[aria-label="完成首页评审操作菜单"]`)
    expect(menuButton.attributes('aria-expanded')).toBe('false')
    await menuButton.trigger('click')
    expect(menuButton.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[role="menu"]').exists()).toBe(true)
    await wrapper.get('[data-action="edit"]').trigger('click')
    expect(ui.milestoneEditor.value).toMatchObject({ open: true, milestoneId: FIRST_MILESTONE_ID })
  })
})

describe('selected project integration', () => {
  beforeEach(() => {
    localStorage.clear()
    const document: WorkspaceDocument = createDemoWorkspace()
    document.milestones = milestones
    document.tasks = document.tasks.map((item, index) => item.projectId === PROJECT_ID && index < 2
      ? { ...item, milestoneId: FIRST_MILESTONE_ID }
      : item)
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(document))
  })

  it('embeds tracking below the selected project heading without replacing the filtered task board', async () => {
    const wrapper = await mountSuspended(TodayPage, { route: `/?project=${DEMO_PROJECT_IDS.personal}` })

    await vi.waitFor(() => expect(wrapper.find('[data-project-progress]').exists()).toBe(true))
    const heading = wrapper.get('.today-heading')
    const panel = wrapper.get('[data-project-progress]')
    const taskBoard = wrapper.get('.task-board')
    expect(heading.text()).toContain('个人效率系统')
    expect(heading.element.compareDocumentPosition(panel.element))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(panel.element.compareDocumentPosition(taskBoard.element))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(wrapper.findAll('[data-task-row]')).toHaveLength(4)
    expect(wrapper.text()).not.toContain('把季度目标拆成可追踪的关键结果')
  })
})
