import { beforeEach, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Milestone, WorkspaceDocument } from '../../shared/workspace'
import { createDemoWorkspace, DEMO_PROJECT_IDS } from '../../app/data/demo-workspace'
import UpcomingMilestones from '../../app/components/dashboard/UpcomingMilestones.vue'
import TodayPage from '../../app/pages/index.vue'

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const CREATED_AT = '2026-08-01T00:00:00.000Z'
const NOW = new Date('2026-08-13T08:00:00+08:00')

function milestone(id: string, projectId: string, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    ownerId: OWNER_ID,
    projectId,
    title: id,
    description: '',
    targetDate: '2026-08-14',
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

function documentWithReminders(): WorkspaceDocument {
  const document = createDemoWorkspace()
  document.milestones = [
    milestone('overdue', DEMO_PROJECT_IDS.personal, { title: 'Overdue milestone', targetDate: '2026-08-11', sortOrder: 1 }),
    milestone('today', DEMO_PROJECT_IDS.ideas, { title: 'Today milestone', targetDate: '2026-08-13', sortOrder: 2 }),
    milestone('one-day', DEMO_PROJECT_IDS.personal, { title: 'One day milestone', targetDate: '2026-08-14', sortOrder: 0 }),
    milestone('two-days', DEMO_PROJECT_IDS.personal, { title: 'Two days milestone', targetDate: '2026-08-15', sortOrder: 0 }),
    milestone('three-days', DEMO_PROJECT_IDS.personal, { title: 'Three days milestone', targetDate: '2026-08-16', sortOrder: 0 }),
    milestone('upcoming', DEMO_PROJECT_IDS.personal, { title: 'Upcoming milestone', targetDate: '2026-08-17', sortOrder: 0 }),
    milestone('later', DEMO_PROJECT_IDS.personal, { title: 'Later milestone', targetDate: '2026-08-18', sortOrder: 0 }),
    milestone('completed', DEMO_PROJECT_IDS.personal, { title: 'Completed milestone', targetDate: '2026-08-10', status: 'completed' }),
    milestone('deleted', DEMO_PROJECT_IDS.personal, { title: 'Deleted milestone', targetDate: '2026-08-10', deletedAt: CREATED_AT }),
  ]
  return document
}

describe('upcoming milestone reminders', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('limits reminders to five, excludes completed or deleted milestones, and shows dates and project color', async () => {
    const wrapper = await mountSuspended(UpcomingMilestones, {
      props: { document: documentWithReminders(), now: NOW },
    })

    expect(wrapper.findAll('[data-upcoming-milestone]').map(row => row.attributes('data-upcoming-milestone'))).toEqual([
      'overdue',
      'today',
      'one-day',
      'two-days',
      'three-days',
    ])
    expect(wrapper.findAll('[data-upcoming-milestone]').map(row => row.text())).toEqual([
      expect.stringContaining('Overdue milestone'),
      expect.stringContaining('Today milestone'),
      expect.stringContaining('One day milestone'),
      expect.stringContaining('Two days milestone'),
      expect.stringContaining('Three days milestone'),
    ])
    expect(wrapper.text()).toContain('逾期 2 天')
    expect(wrapper.text()).toContain('今天')
    expect(wrapper.text()).toContain('1 天后')
    expect(wrapper.text()).not.toContain('Completed milestone')
    expect(wrapper.text()).not.toContain('Deleted milestone')
    expect(wrapper.get('[data-upcoming-milestone="overdue"] > i').attributes('style')?.toLowerCase()).toContain('#8b7cf6')
  })

  it('navigates to the clicked milestone project', async () => {
    const wrapper = await mountSuspended(UpcomingMilestones, {
      props: { document: documentWithReminders(), now: NOW },
    })
    const router = useRouter()
    const push = vi.spyOn(router, 'push').mockResolvedValue()

    await wrapper.get('[data-upcoming-milestone="one-day"]').trigger('click')

    expect(push).toHaveBeenCalledWith({ path: '/', query: { project: DEMO_PROJECT_IDS.personal } })
  })

  it('hides the panel whenever a Today filter is active, including a stale project query', async () => {
    const workspace = useWorkspace()
    workspace.document.value = documentWithReminders()
    workspace.ready.value = true

    const today = await mountSuspended(TodayPage, { route: '/' })
    expect(today.find('[data-upcoming-milestones]').exists()).toBe(true)

    await today.get('[aria-label="筛选任务"]').trigger('click')
    await today.get('[data-today-search]').setValue('milestone')
    expect(today.find('[data-upcoming-milestones]').exists()).toBe(false)
    await today.get('[data-today-search]').setValue('')
    await today.get('[data-today-priority]').setValue('high')
    expect(today.find('[data-upcoming-milestones]').exists()).toBe(false)
    await today.get('[data-today-priority]').setValue('all')
    await today.get('[data-today-status]').setValue('completed')
    expect(today.find('[data-upcoming-milestones]').exists()).toBe(false)

    const staleProject = await mountSuspended(TodayPage, { route: '/?project=missing-project' })
    expect(staleProject.find('[data-upcoming-milestones]').exists()).toBe(false)
  })
})
