import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, onMounted } from 'vue'
import WorkspaceInfoDialog from '../../app/components/workspace/WorkspaceInfoDialog.vue'
import { useWorkspaceUi } from '../../app/composables/useWorkspaceUi'

const Harness = defineComponent({
  components: { WorkspaceInfoDialog },
  setup() {
    const ui = useWorkspaceUi()
    onMounted(() => ui.openWorkspaceInfo())
  },
  template: '<WorkspaceInfoDialog />',
})

describe('workspace information destructive action', () => {
  it('opens typed confirmation without immediately clearing data', async () => {
    const wrapper = await mountSuspended(Harness, {
      global: { stubs: { Teleport: true } },
    })

    await vi.waitFor(() => expect(wrapper.find('[data-open-clear-workspace]').exists()).toBe(true))
    expect(wrapper.find('[data-clear-workspace-phrase]').exists()).toBe(false)

    await wrapper.get('[data-open-clear-workspace]').trigger('click')

    expect(wrapper.find('[data-clear-workspace-phrase]').exists()).toBe(true)
    expect(wrapper.find('[data-confirm-clear-workspace]').attributes('disabled')).toBeDefined()
  })
})
