import { mountSuspended } from '@nuxt/test-utils/runtime'
import TodayPage from '../../app/pages/index.vue'

describe('Today workspace', () => {
  it('shows focus metrics, grouped tasks, and quick capture', async () => {
    const wrapper = await mountSuspended(TodayPage)

    expect(wrapper.get('h1').text()).toBe('Today')
    expect(wrapper.text()).toContain('今日重点')
    expect(wrapper.text()).toContain('进行中')
    expect(wrapper.text()).toContain('已完成')
    expect(wrapper.findAll('[data-task-row]').length).toBeGreaterThanOrEqual(3)
    expect(wrapper.get('[data-quick-add]').exists()).toBe(true)
    expect(wrapper.get('[data-quick-add] [data-voice-input]').exists()).toBe(true)
  })
})
