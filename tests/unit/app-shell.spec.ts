import { mountSuspended } from '@nuxt/test-utils/runtime'
import DefaultLayout from '../../app/layouts/default.vue'

const linkStub = {
  template: '<a><slot /></a>',
}

const mountOptions = {
  global: { stubs: { NuxtLink: linkStub, RouterLink: linkStub } },
}

describe('Huly-style application shell', () => {
  it('renders the four desktop workspace zones', async () => {
    const wrapper = await mountSuspended(DefaultLayout, {
      ...mountOptions,
      slots: { default: '<main>Today</main>' },
    })

    expect(wrapper.find('[data-zone="rail"]').exists()).toBe(true)
    expect(wrapper.find('[data-zone="sidebar"]').exists()).toBe(true)
    expect(wrapper.find('[data-zone="content"]').text()).toContain('Today')
    expect(wrapper.find('[data-zone="context"]').exists()).toBe(true)
  })

  it('keeps primary navigation and AI context visible in the shell', async () => {
    const wrapper = await mountSuspended(DefaultLayout, mountOptions)

    expect(wrapper.get('[data-zone="rail"]').attributes('aria-label')).toBe('应用导航')
    expect(wrapper.get('[data-zone="sidebar"]').text()).toContain('Today')
    expect(wrapper.get('[data-zone="sidebar"]').text()).toContain('季度追踪')
    expect(wrapper.get('[data-zone="context"]').text()).toContain('AI 计划助手')
  })
})
