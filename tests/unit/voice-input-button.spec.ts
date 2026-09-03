import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VoiceInputButton from '../../app/components/workspace/VoiceInputButton.vue'
import { VOICE_CONSENT_STORAGE_KEY } from '../../app/composables/useVoiceDictation'

class MockSpeechRecognition {
  static instance: MockSpeechRecognition | null = null
  continuous = false
  interimResults = false
  lang = ''
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onresult: ((event: { resultIndex: number, results: ArrayLike<{ isFinal: boolean, 0: { transcript: string } }> }) => void) | null = null

  constructor() {
    MockSpeechRecognition.instance = this
  }
}

describe('VoiceInputButton', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    MockSpeechRecognition.instance = null
    vi.stubGlobal('SpeechRecognition', MockSpeechRecognition)
  })

  it('explains system processing before the first microphone use', async () => {
    const wrapper = mount(VoiceInputButton, {
      attachTo: document.body,
      global: { stubs: { UIcon: { template: '<span />' } } },
    })

    await wrapper.get('[data-voice-input]').trigger('click')

    expect(document.body.textContent).toContain('系统语音服务')
    expect(document.body.textContent).toContain('不会自动创建或发送')
    expect(MockSpeechRecognition.instance).toBeNull()
  })

  it('emits recognized text after consent without submitting a surrounding form', async () => {
    localStorage.setItem(VOICE_CONSENT_STORAGE_KEY, 'accepted')
    const wrapper = mount(VoiceInputButton, {
      global: { stubs: { UIcon: { template: '<span />' } } },
    })

    await wrapper.get('[data-voice-input]').trigger('click')
    MockSpeechRecognition.instance?.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: '完成季度总结' } }],
    })

    expect(wrapper.emitted('transcript')).toEqual([['完成季度总结']])
    expect(wrapper.get('[data-voice-input]').attributes('type')).toBe('button')
  })
})
