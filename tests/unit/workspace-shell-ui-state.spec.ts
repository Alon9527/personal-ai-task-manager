import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent } from 'vue'
import { useWorkspaceUi } from '../../app/composables/useWorkspaceUi'

const Harness = defineComponent({
  setup() {
    return { ui: useWorkspaceUi() }
  },
  template: '<div />',
})

describe('workspace shell UI state', () => {
  it('coordinates search, workspace information, and explicit AI refresh requests', async () => {
    const wrapper = await mountSuspended(Harness)
    const ui = (wrapper.vm as unknown as { ui: ReturnType<typeof useWorkspaceUi> }).ui

    ui.openSearch('MiniMax')
    expect(ui.searchPalette.value).toEqual({ open: true, query: 'MiniMax' })
    ui.closeSearch()
    expect(ui.searchPalette.value.open).toBe(false)

    ui.openWorkspaceInfo()
    expect(ui.workspaceInfoOpen.value).toBe(true)
    ui.closeWorkspaceInfo()
    expect(ui.workspaceInfoOpen.value).toBe(false)

    const before = ui.miniMaxBriefRequest.value
    ui.requestMiniMaxBrief()
    expect(ui.miniMaxBriefRequest.value).toBe(before + 1)
  })
})
