import { vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent } from 'vue'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import ContextPanel from '../../app/components/app/ContextPanel.vue'

const minimaxMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  generateBrief: vi.fn(),
}))

vi.mock('../../app/services/minimax', async () => {
  const actual = await vi.importActual<typeof import('../../app/services/minimax')>('../../app/services/minimax')
  return {
    ...actual,
    getMiniMaxStatus: minimaxMocks.getStatus,
    generateAiBrief: minimaxMocks.generateBrief,
  }
})

const Harness = defineComponent({
  components: { ContextPanel },
  setup() {
    return { ui: useWorkspaceUi() }
  },
  template: '<button data-request-brief @click="ui.requestMiniMaxBrief()">刷新</button><ContextPanel />',
})

describe('Today to MiniMax refresh bridge', () => {
  it('calls the real brief service only after the user requests a refresh', async () => {
    localStorage.clear()
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(createDemoWorkspace()))
    minimaxMocks.getStatus.mockResolvedValue({
      available: true,
      configured: true,
      model: 'MiniMax-M2.7',
      credentialStore: 'windows-credential-manager',
      region: 'cn',
    })
    minimaxMocks.generateBrief.mockResolvedValue({
      focus: '真实简报',
      progress: [],
      suggestion: null,
      sources: [],
      model: 'MiniMax-M2.7',
      generatedAt: '2026-08-05T08:00:00.000Z',
      usage: null,
    })

    const wrapper = await mountSuspended(Harness)
    await vi.waitFor(() => expect(wrapper.find('[data-generate-minimax-brief]').exists()).toBe(true))
    expect(minimaxMocks.generateBrief).not.toHaveBeenCalled()
    await wrapper.get('[data-request-brief]').trigger('click')
    await vi.waitFor(() => expect(minimaxMocks.generateBrief).toHaveBeenCalledOnce())
    expect(wrapper.text()).toContain('真实简报')
  })
})
