import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import DefaultLayout from '../../app/layouts/default.vue'

describe('desktop workspace shortcuts', () => {
  it('opens global search with Ctrl+K and task creation with C', async () => {
    const wrapper = await mountSuspended(DefaultLayout, {
      global: { stubs: { Teleport: true } },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await nextTick()
    expect(wrapper.find('[data-command-palette]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.find('[data-command-palette]').exists()).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }))
    await nextTick()
    expect(wrapper.find('[aria-labelledby="task-editor-title"]').exists()).toBe(true)
  })
})
