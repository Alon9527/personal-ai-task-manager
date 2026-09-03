import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'

export const VOICE_CONSENT_STORAGE_KEY = 'personal-ai-voice-consent:v1'

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0?: { transcript?: string }
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

interface VoiceDictationOptions {
  onTranscript: (text: string) => void
  beforeStart?: () => void
  language?: string
}

function recognitionConstructor() {
  const scope = globalThis as typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

function nativeVoiceTypingAvailable() {
  try {
    return isTauri()
  }
  catch {
    return false
  }
}

function errorMessage(code?: string) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return '没有麦克风权限，请在 Windows 隐私设置中允许此应用使用麦克风。'
  if (code === 'audio-capture') return '没有检测到可用麦克风，请检查设备连接。'
  if (code === 'network') return '系统语音服务暂时无法连接网络，请稍后重试。'
  if (code === 'no-speech') return '没有听到语音，请靠近麦克风后重试。'
  return '语音识别没有完成，请重试。'
}

export function useVoiceDictation(options: VoiceDictationOptions) {
  const supported = ref(true)
  const listening = ref(false)
  const consentOpen = ref(false)
  const interimText = ref('')
  const nativePromptActive = ref(false)
  const error = ref<string | null>(null)
  let recognition: SpeechRecognitionLike | null = null
  let nativeStatusTimer: ReturnType<typeof setTimeout> | null = null

  function hasConsent() {
    try {
      return localStorage.getItem(VOICE_CONSENT_STORAGE_KEY) === 'accepted'
    }
    catch {
      return false
    }
  }

  async function beginRecognition() {
    const Constructor = recognitionConstructor()
    const canUseNative = nativeVoiceTypingAvailable()
    supported.value = Boolean(Constructor) || canUseNative
    error.value = null
    interimText.value = ''
    nativePromptActive.value = false

    if (!Constructor) {
      if (!canUseNative) {
        error.value = '当前 Windows WebView 不支持系统语音识别，请更新 WebView2 后重试。'
        return
      }
      try {
        options.beforeStart?.()
        await invoke('start_windows_voice_typing')
        nativePromptActive.value = true
        if (nativeStatusTimer) clearTimeout(nativeStatusTimer)
        nativeStatusTimer = setTimeout(() => { nativePromptActive.value = false }, 4000)
      }
      catch {
        error.value = '无法打开 Windows 语音输入，请按 Win + H 重试。'
      }
      return
    }


    options.beforeStart?.()
    recognition?.abort()
    recognition = new Constructor()
    recognition.lang = options.language ?? 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.onstart = () => {
      listening.value = true
    }
    recognition.onend = () => {
      listening.value = false
      interimText.value = ''
      recognition = null
    }
    recognition.onerror = (event) => {
      listening.value = false
      interimText.value = ''
      error.value = errorMessage(event.error)
    }
    recognition.onresult = (event) => {
      let interim = ''
      let finalText = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result?.[0]?.transcript?.trim() ?? ''
        if (!transcript) continue
        if (result?.isFinal) finalText += `${transcript} `
        else interim += `${transcript} `
      }
      interimText.value = interim.trim()
      const completed = finalText.trim()
      if (completed) options.onTranscript(completed)
    }

    try {
      recognition.start()
    }
    catch {
      recognition = null
      listening.value = false
      error.value = '麦克风启动失败，请稍后重试。'
    }
  }

  async function start() {
    if (!recognitionConstructor() && !nativeVoiceTypingAvailable()) {
      supported.value = false
      error.value = '当前 Windows WebView 不支持系统语音识别，请更新 WebView2 后重试。'
      return
    }
    if (!hasConsent()) {
      consentOpen.value = true
      return
    }
    await beginRecognition()
  }

  async function confirmAndStart() {
    try {
      localStorage.setItem(VOICE_CONSENT_STORAGE_KEY, 'accepted')
    }
    catch {
      // A private WebView may reject persistence; consent still applies to this click.
    }
    consentOpen.value = false
    await beginRecognition()
  }

  function cancelConsent() {
    consentOpen.value = false
  }

  function stop() {
    recognition?.stop()
    listening.value = false
    interimText.value = ''
  }

  function dispose() {
    recognition?.abort()
    recognition = null
    if (nativeStatusTimer) clearTimeout(nativeStatusTimer)
  }

  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return {
    supported,
    listening,
    consentOpen,
    interimText,
    nativePromptActive,
    error,
    start,
    stop,
    confirmAndStart,
    cancelConsent,
  }
}
