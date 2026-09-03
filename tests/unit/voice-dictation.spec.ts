import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { VOICE_CONSENT_STORAGE_KEY, useVoiceDictation } from '../../app/composables/useVoiceDictation'

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => tauriMocks)

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = []

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
    MockSpeechRecognition.instances.push(this)
  }
}

describe('voice dictation', () => {
  beforeEach(() => {
    localStorage.clear()
    MockSpeechRecognition.instances = []
    vi.stubGlobal('SpeechRecognition', MockSpeechRecognition)
    tauriMocks.isTauri.mockReturnValue(false)
    tauriMocks.invoke.mockReset()
  })

  it('requires explicit consent before starting the microphone', async () => {
    const onTranscript = vi.fn()
    const voice = useVoiceDictation({ onTranscript })

    voice.start()
    expect(voice.consentOpen.value).toBe(true)
    expect(MockSpeechRecognition.instances).toHaveLength(0)

    voice.confirmAndStart()
    expect(localStorage.getItem(VOICE_CONSENT_STORAGE_KEY)).toBe('accepted')
    expect(MockSpeechRecognition.instances).toHaveLength(1)
    expect(MockSpeechRecognition.instances[0]?.start).toHaveBeenCalledOnce()

    MockSpeechRecognition.instances[0]?.onstart?.()
    expect(voice.listening.value).toBe(true)

    MockSpeechRecognition.instances[0]?.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: '明天下午提交设计稿' } }],
    })
    expect(onTranscript).toHaveBeenCalledWith('明天下午提交设计稿')
  })

  it('shows interim text and never submits anything by itself', async () => {
    localStorage.setItem(VOICE_CONSENT_STORAGE_KEY, 'accepted')
    const onTranscript = vi.fn()
    const voice = useVoiceDictation({ onTranscript })

    voice.start()
    MockSpeechRecognition.instances[0]?.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: false, 0: { transcript: '整理季度' } }],
    })
    await nextTick()

    expect(voice.interimText.value).toBe('整理季度')
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('falls back to Windows voice typing in the desktop app', async () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', undefined)
    tauriMocks.isTauri.mockReturnValue(true)
    tauriMocks.invoke.mockResolvedValue(undefined)
    localStorage.setItem(VOICE_CONSENT_STORAGE_KEY, 'accepted')
    const beforeStart = vi.fn()
    const voice = useVoiceDictation({ onTranscript: vi.fn(), beforeStart })

    await voice.start()

    expect(beforeStart).toHaveBeenCalledOnce()
    expect(tauriMocks.invoke).toHaveBeenCalledWith('start_windows_voice_typing')
    expect(voice.nativePromptActive.value).toBe(true)
  })

  it('reports unsupported WebViews without attempting recognition', () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', undefined)
    const voice = useVoiceDictation({ onTranscript: vi.fn() })

    voice.start()

    expect(voice.supported.value).toBe(false)
    expect(voice.error.value).toContain('不支持系统语音识别')
    expect(MockSpeechRecognition.instances).toHaveLength(0)
  })

  it('translates permission errors into a useful Chinese message', () => {
    localStorage.setItem(VOICE_CONSENT_STORAGE_KEY, 'accepted')
    const voice = useVoiceDictation({ onTranscript: vi.fn() })

    voice.start()
    MockSpeechRecognition.instances[0]?.onerror?.({ error: 'not-allowed' })

    expect(voice.error.value).toContain('麦克风权限')
    expect(voice.listening.value).toBe(false)
  })
})
