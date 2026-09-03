import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent } from 'vue'
import { useWorkspaceUi } from '../../app/composables/useWorkspaceUi'

const Harness = defineComponent({
  setup() {
    return { ui: useWorkspaceUi() }
  },
  template: '<div />',
})

describe('quarter goal UI state', () => {
  it('opens new and existing goal editors and prepares soft deletion', async () => {
    const wrapper = await mountSuspended(Harness)
    const ui = (wrapper.vm as unknown as { ui: Record<string, any> }).ui

    expect(ui.openNewQuarterGoal).toBeTypeOf('function')
    expect(ui.openEditQuarterGoal).toBeTypeOf('function')
    expect(ui.askDeleteQuarterGoal).toBeTypeOf('function')
    if (!ui.openNewQuarterGoal) return

    ui.openNewQuarterGoal('2026-Q3')
    expect(ui.quarterGoalEditor.value).toEqual({
      open: true,
      goalId: null,
      defaultQuarter: '2026-Q3',
    })

    ui.openEditQuarterGoal('30000000-0000-4000-8000-000000000001')
    expect(ui.quarterGoalEditor.value).toMatchObject({
      open: true,
      goalId: '30000000-0000-4000-8000-000000000001',
    })

    ui.askDeleteQuarterGoal('30000000-0000-4000-8000-000000000001')
    expect(ui.deleteRequest.value).toEqual({
      kind: 'quarter-goal',
      id: '30000000-0000-4000-8000-000000000001',
    })
  })
})
