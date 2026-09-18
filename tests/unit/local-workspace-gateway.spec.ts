import { beforeEach, describe, expect, it } from 'vitest'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import { deriveWorkspace } from '../../shared/workspace'

const NOW = '2026-07-22T08:00:00.000Z'

describe('LocalWorkspaceGateway', () => {
  beforeEach(() => localStorage.clear())

  it('persists an optional completion date independently of task status and completion timestamp', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    const task = await gateway.createTask({ title: '完成日期验收', description: '', projectId: null, milestoneId: null, priority: null, dueDate: null, dueTime: null, isFocus: false, status: 'in_progress', completionDate: '2026-09-18' })
    expect(task).toMatchObject({ completionDate: '2026-09-18', status: 'in_progress', completedAt: null })
    await gateway.updateTask(task.id, { completionDate: '2026-09-19' })
    await gateway.updateTask(task.id, { title: '保留完成日期' })
    const reopened = new LocalWorkspaceGateway(localStorage, () => NOW)
    expect((await reopened.loadWorkspace()).tasks.find(item => item.id === task.id)).toMatchObject({ completionDate: '2026-09-19', status: 'in_progress', completedAt: null })
    expect(await reopened.setTaskCompleted(task.id, true)).toMatchObject({ completionDate: '2026-09-19', completedAt: NOW })
    expect(await reopened.updateTask(task.id, { completionDate: null })).toMatchObject({ completionDate: null, status: 'done', completedAt: NOW })
    expect((await new LocalWorkspaceGateway(localStorage).loadWorkspace()).tasks.find(item => item.id === task.id)?.completionDate).toBeNull()
  })

  it('persists project and task CRUD across instances', async () => {
    const first = new LocalWorkspaceGateway(localStorage, () => NOW)
    const project = await first.createProject({ name: '新项目', color: '#3366FF' })
    const task = await first.createTask({
      title: '新任务',
      description: '',
      projectId: project.id,
      priority: null,
      dueDate: null,
      dueTime: null,
      isFocus: false,
    })
    await first.updateTask(task.id, { title: '已编辑任务' })
    await first.setTaskCompleted(task.id, true)

    const second = new LocalWorkspaceGateway(localStorage, () => '2026-07-22T09:00:00.000Z')
    const saved = await second.loadWorkspace()
    const savedTask = saved.tasks.find(item => item.id === task.id)

    expect(saved.projects.find(item => item.id === project.id)?.name).toBe('新项目')
    expect(savedTask?.title).toBe('已编辑任务')
    expect(savedTask?.completedAt).toBe(NOW)
  })

  it('soft-deletes a task without removing its stored record', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    const task = (await gateway.loadWorkspace()).tasks[0]!

    await gateway.deleteTask(task.id)

    expect((await gateway.loadWorkspace()).tasks.some(item => item.id === task.id)).toBe(false)
    const deleted = (await gateway.loadWorkspace({ includeDeleted: true })).tasks.find(item => item.id === task.id)
    expect(deleted?.deletedAt).toBe(NOW)
  })

  it('soft-deletes a project and its active tasks atomically', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    const document = await gateway.loadWorkspace()
    const project = document.projects.find(item => item.name === '个人效率系统')!

    await gateway.deleteProject(project.id)
    const saved = await gateway.loadWorkspace({ includeDeleted: true })

    expect(saved.projects.find(item => item.id === project.id)?.deletedAt).toBe(NOW)
    expect(saved.tasks.filter(item => item.projectId === project.id).every(item => item.deletedAt === NOW)).toBe(true)
  })

  it('persists project and task ordering', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    const initial = deriveWorkspace(await gateway.loadWorkspace())
    const reversedProjects = initial.projects.map(item => item.id).reverse()
    const reversedFocus = initial.focusTasks.map(item => item.id).reverse()

    await gateway.reorderProjects(reversedProjects)
    await gateway.reorderTasks('focus', reversedFocus)
    const saved = deriveWorkspace(await gateway.loadWorkspace())

    expect(saved.projects.map(item => item.id)).toEqual(reversedProjects)
    expect(saved.focusTasks.map(item => item.id)).toEqual(reversedFocus)
  })

  it('backs up invalid local data before reseeding', async () => {
    localStorage.setItem('personal-ai-workspace:v1', '{invalid')
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)

    const document = await gateway.loadWorkspace()

    expect(document.projects.length).toBeGreaterThan(0)
    expect(localStorage.getItem(`personal-ai-workspace:backup:${NOW}`)).toBe('{invalid')
  })

  it('permanently removes every soft-deleted record when emptying the trash', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    const initial = await gateway.loadWorkspace()
    const project = initial.projects.find(item => item.name === '个人效率系统')!
    const standaloneTask = initial.tasks.find(item => item.projectId !== project.id)!
    const goal = initial.quarterGoals[0]!

    await gateway.deleteProject(project.id)
    await gateway.deleteTask(standaloneTask.id)
    await gateway.deleteQuarterGoal(goal.id)
    await gateway.emptyTrash()

    const saved = await gateway.loadWorkspace({ includeDeleted: true })
    expect(saved.projects.some(item => item.id === project.id)).toBe(false)
    expect(saved.tasks.some(item => item.id === standaloneTask.id || item.projectId === project.id)).toBe(false)
    expect(saved.quarterGoals.some(item => item.id === goal.id)).toBe(false)
    expect(saved.projects.length + saved.tasks.length + saved.quarterGoals.length).toBeGreaterThan(0)
  })

  it('clears all workspace records without touching AI and UI preferences', async () => {
    localStorage.setItem('personal-ai-minimax-model:v1', 'MiniMax-M2.7')
    localStorage.setItem('personal-ai-ui-scale:v4', '1.1')
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    expect((await gateway.loadWorkspace()).tasks.length).toBeGreaterThan(0)

    await gateway.clearWorkspaceData()

    expect(await gateway.loadWorkspace({ includeDeleted: true })).toEqual({
      version: 3,
      projects: [],
      milestones: [],
      tasks: [],
      quarterGoals: [],
    })
    expect(localStorage.getItem('personal-ai-minimax-model:v1')).toBe('MiniMax-M2.7')
    expect(localStorage.getItem('personal-ai-ui-scale:v4')).toBe('1.1')
  })

  it('serializes concurrent creates so both whole-document mutations survive', async () => {
    const ids = [
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
    ]
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW, () => ids.shift()!)

    const [first, second] = await Promise.all([
      gateway.createProject({ name: '并发项目一', color: '#112233' }),
      gateway.createProject({ name: '并发项目二', color: '#445566' }),
    ])

    const saved = await gateway.loadWorkspace({ includeDeleted: true })
    expect(saved.projects.filter(project => project.id === first.id || project.id === second.id))
      .toHaveLength(2)
  })

  it('serializes clear behind an in-flight mutation without resurrecting pre-clear data', async () => {
    const gateway = new LocalWorkspaceGateway(
      localStorage,
      () => NOW,
      () => '40000000-0000-4000-8000-000000000003',
    )

    const creating = gateway.createProject({ name: '清空前排队项目', color: '#112233' })
    const clearing = gateway.clearWorkspaceData()
    await Promise.all([creating, clearing])

    expect(await gateway.loadWorkspace({ includeDeleted: true })).toEqual({
      version: 3,
      projects: [],
      milestones: [],
      tasks: [],
      quarterGoals: [],
    })
  })

  it('continues processing queued mutations after an earlier persist failure', async () => {
    const values = new Map<string, string>()
    let rejectNextWrite = false
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (rejectNextWrite) {
          rejectNextWrite = false
          throw new Error('one write failed')
        }
        values.set(key, value)
      },
    }
    const ids = [
      '40000000-0000-4000-8000-000000000004',
      '40000000-0000-4000-8000-000000000005',
    ]
    const gateway = new LocalWorkspaceGateway(storage, () => NOW, () => ids.shift()!)
    await gateway.loadWorkspace()
    rejectNextWrite = true

    const failed = gateway.createProject({ name: '失败项目', color: '#112233' })
    const successful = gateway.createProject({ name: '后续项目', color: '#445566' })

    await expect(failed).rejects.toThrow('无法保存本地数据')
    await expect(successful).resolves.toMatchObject({ name: '后续项目' })
    expect((await gateway.loadWorkspace()).projects.some(project => project.name === '后续项目')).toBe(true)
  })
})
