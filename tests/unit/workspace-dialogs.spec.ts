import { mountSuspended } from '@nuxt/test-utils/runtime'
import TaskEditorDialog from '../../app/components/workspace/TaskEditorDialog.vue'
import ProjectEditorDialog from '../../app/components/workspace/ProjectEditorDialog.vue'
import DeleteConfirmDialog from '../../app/components/workspace/DeleteConfirmDialog.vue'

const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_PROJECT_ID = '10000000-0000-4000-8000-000000000002'
const MILESTONE_ID = '20000000-0000-4000-8000-000000000001'
const OTHER_MILESTONE_ID = '20000000-0000-4000-8000-000000000002'

const projects = [
  { id: PROJECT_ID, name: '官网改版' },
  { id: OTHER_PROJECT_ID, name: '移动端' },
] as never

const milestones = [
  { id: MILESTONE_ID, projectId: PROJECT_ID, title: '首页评审' },
  { id: OTHER_MILESTONE_ID, projectId: OTHER_PROJECT_ID, title: '移动端发布' },
] as never

const existingProject = {
  id: PROJECT_ID,
  ownerId: '00000000-0000-4000-8000-000000000001',
  name: 'Existing project',
  color: '#224466',
  description: 'Existing description',
  priority: 'medium',
  status: 'paused',
  targetDate: '2026-09-15',
  sortOrder: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  deletedAt: null,
} as const

const existingTask = {
  id: '30000000-0000-4000-8000-000000000001',
  ownerId: '00000000-0000-4000-8000-000000000001',
  projectId: PROJECT_ID,
  milestoneId: MILESTONE_ID,
  title: 'Existing task',
  description: 'Existing task description',
  priority: 'high',
  dueDate: '2026-09-16',
  dueTime: '09:30',
  isFocus: true,
  status: 'in_progress',
  importance: 'important',
  estimatedMinutes: 45,
  reminderAt: '2026-09-16T01:00:00.000Z',
  snoozedUntil: null,
  lastRemindedAt: null,
  sortOrder: 0,
  completedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  deletedAt: null,
} as const

describe('workspace editors', () => {
  it('submits a normalized task payload', async () => {
    const wrapper = await mountSuspended(TaskEditorDialog, {
      props: { open: true, task: null, projects: [], milestones: [] },
      global: { stubs: { Teleport: true } },
    })
    expect(wrapper.findAll('[data-task-status]')).toHaveLength(6)
    expect(wrapper.get('[data-add-attachment]').text()).toContain('添加文件或图片')
    await wrapper.get('[name="title"]').setValue('  写实施计划  ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      title: '写实施计划',
      isFocus: false,
      projectId: null,
    })
  })

  it('filters milestones by project, clears a stale selection, and submits both ids', async () => {
    const wrapper = await mountSuspended(TaskEditorDialog, {
      props: { open: true, task: null, projects, milestones },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.get('[name="projectId"]').setValue(PROJECT_ID)
    expect(wrapper.get('[name="milestoneId"]').findAll('option').map(option => option.text())).toEqual([
      '无里程碑',
      '首页评审',
    ])
    await wrapper.get('[name="milestoneId"]').setValue(MILESTONE_ID)
    await wrapper.get('[name="projectId"]').setValue(OTHER_PROJECT_ID)
    expect((wrapper.get('[name="milestoneId"]').element as HTMLSelectElement).value).toBe('')

    await wrapper.get('[name="projectId"]').setValue(PROJECT_ID)
    await wrapper.get('[name="milestoneId"]').setValue(MILESTONE_ID)
    await wrapper.get('[name="title"]').setValue('  完成首页评审  ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      title: '完成首页评审',
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
    })
  })

  it('submits every v3 project field', async () => {
    const wrapper = await mountSuspended(ProjectEditorDialog, {
      props: { open: true, project: null },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.get('[name="name"]').setValue('  官网改版  ')
    await wrapper.get('[name="description"]').setValue('统一产品叙事')
    await wrapper.get('[name="colorValue"]').setValue('#123456')
    await wrapper.get('[name="priority"]').setValue('high')
    await wrapper.get('[name="status"]').setValue('active')
    await wrapper.get('[name="targetDate"]').setValue('2026-08-31')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      name: '官网改版',
      description: '统一产品叙事',
      color: '#123456',
      priority: 'high',
      status: 'active',
      targetDate: '2026-08-31',
    })
  })

  it('initializes and submits updates for an existing project', async () => {
    const wrapper = await mountSuspended(ProjectEditorDialog, {
      props: { open: true, project: existingProject as never },
      global: { stubs: { Teleport: true } },
    })

    expect((wrapper.get('[name="name"]').element as HTMLInputElement).value).toBe('Existing project')
    expect((wrapper.get('[name="description"]').element as HTMLTextAreaElement).value).toBe('Existing description')
    expect((wrapper.get('[name="priority"]').element as HTMLSelectElement).value).toBe('medium')
    expect((wrapper.get('[name="status"]').element as HTMLSelectElement).value).toBe('paused')
    expect((wrapper.get('[name="targetDate"]').element as HTMLInputElement).value).toBe('2026-09-15')

    await wrapper.get('[name="name"]').setValue('Updated project')
    await wrapper.get('[name="status"]').setValue('active')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      name: 'Updated project',
      description: 'Existing description',
      color: '#224466',
      priority: 'medium',
      status: 'active',
      targetDate: '2026-09-15',
    })
  })

  it('initializes and submits updates for an existing task', async () => {
    const wrapper = await mountSuspended(TaskEditorDialog, {
      props: {
        open: true,
        task: existingTask as never,
        projects,
        milestones,
      },
      global: { stubs: { Teleport: true } },
    })

    expect((wrapper.get('[name="title"]').element as HTMLInputElement).value).toBe('Existing task')
    expect((wrapper.get('[name="projectId"]').element as HTMLSelectElement).value).toBe(PROJECT_ID)
    expect((wrapper.get('[name="milestoneId"]').element as HTMLSelectElement).value).toBe(MILESTONE_ID)
    expect((wrapper.get('[data-task-status][value="in_progress"]').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.get('[name="estimatedMinutes"]').element as HTMLInputElement).value).toBe('45')

    await wrapper.get('[name="title"]').setValue('Updated task')
    await wrapper.get('[name="estimatedMinutes"]').setValue('60')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      title: 'Updated task',
      description: 'Existing task description',
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      priority: 'high',
      dueDate: '2026-09-16',
      dueTime: '09:30',
      isFocus: true,
      status: 'in_progress',
      importance: 'important',
      estimatedMinutes: 60,
      reminderAt: '2026-09-16T01:00:00.000Z',
      snoozedUntil: null,
    })
  })

  it('rejects an empty project name', async () => {
    const wrapper = await mountSuspended(ProjectEditorDialog, {
      props: { open: true, project: null },
      global: { stubs: { Teleport: true } },
    })
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('请输入项目名称')
  })

  it('clears project validation when the dialog is reopened', async () => {
    const wrapper = await mountSuspended(ProjectEditorDialog, {
      props: { open: true, project: null },
      global: { stubs: { Teleport: true } },
    })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('clears task validation when the dialog is reopened', async () => {
    const wrapper = await mountSuspended(TaskEditorDialog, {
      props: { open: true, task: null, projects: [], milestones: [] },
      global: { stubs: { Teleport: true } },
    })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('states the cascade impact before deleting a project', async () => {
    const wrapper = await mountSuspended(DeleteConfirmDialog, {
      props: { open: true, kind: 'project', name: '个人效率系统', affectedTaskCount: 4, affectedMilestoneCount: 2 },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('2 个里程碑和 4 项任务也会移入回收数据')
    await wrapper.get('[data-confirm-delete]').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('describes milestone deletion as unlinking rather than deleting tasks', async () => {
    const wrapper = await mountSuspended(DeleteConfirmDialog, {
      props: { open: true, kind: 'milestone', name: '首页评审', affectedTaskCount: 2 },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('里程碑')
    expect(wrapper.text()).toContain('2 项关联任务会保留，并取消里程碑关联')
    expect(wrapper.text()).not.toContain('2 项任务也会移入回收数据')
  })
})
