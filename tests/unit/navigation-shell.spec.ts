import { beforeEach, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import AppRail from '../../app/components/app/AppRail.vue'
import ProjectSidebar from '../../app/components/app/ProjectSidebar.vue'

describe('real application navigation', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(createDemoWorkspace()))
  })

  it('exposes the four primary routes from the application rail', async () => {
    const wrapper = await mountSuspended(AppRail)

    expect(wrapper.find('a[href="/"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/inbox"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/calendar"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/project"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/settings"]').exists()).toBe(true)

    const icons = wrapper.findAll('svg.rail-icon')
    expect(icons).toHaveLength(6)
    for (const icon of icons) {
      expect(icon.attributes('viewBox')).toBe('0 0 24 24')
      expect(icon.find('path, circle, rect').exists()).toBe(true)
    }
  })

  it('shows live quarter progress without a hard-coded active sidebar item', async () => {
    const wrapper = await mountSuspended(ProjectSidebar, { route: '/quarter' })
    await vi.waitFor(() =>
      expect(wrapper.get('[data-quarter-progress]').text()).toContain('68%'),
    )

    const quarterLink = wrapper.get('a[href="/quarter"]')
    expect(wrapper.find('a[href="/review"]').exists()).toBe(true)
    expect(quarterLink.classes()).not.toContain('active')
    expect(wrapper.find('.sidebar-link.active').exists()).toBe(false)
  })
})
