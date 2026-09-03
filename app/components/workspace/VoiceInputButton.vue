<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVoiceDictation } from '../../composables/useVoiceDictation'

const emit = defineEmits<{
  transcript: [text: string]
}>()

const buttonElement = ref<HTMLButtonElement | null>(null)

function focusTargetInput() {
  buttonElement.value?.closest('form')?.querySelector<HTMLInputElement>('input')?.focus()
}

const voice = useVoiceDictation({
  onTranscript: text => emit('transcript', text),
  beforeStart: focusTargetInput,
})

const buttonLabel = computed(() => voice.listening.value ? '停止语音录入' : '语音录入')
const buttonTitle = computed(() => voice.supported.value
  ? buttonLabel.value
  : '当前 WebView 不支持系统语音识别')

function toggle() {
  if (voice.listening.value) voice.stop()
  else voice.start()
}
</script>

<template>
  <span class="voice-input-control">
    <button
      ref="buttonElement"
      type="button"
      data-voice-input
      class="voice-input-button"
      :class="{ listening: voice.listening.value, unsupported: !voice.supported.value }"
      :aria-label="buttonLabel"
      :aria-pressed="voice.listening.value"
      :title="buttonTitle"
      @click="toggle"
    >
      <UIcon v-if="voice.listening.value" name="i-lucide-square" />
      <UIcon v-else name="i-lucide-mic" />
    </button>

    <span v-if="voice.listening.value || voice.interimText.value || voice.nativePromptActive.value" class="voice-status" role="status">
      <i />{{ voice.nativePromptActive.value ? 'Windows 语音输入已打开' : voice.interimText.value || '正在听，请说话…' }}
    </span>
    <span v-else-if="voice.error.value" class="voice-error" role="alert">
      {{ voice.error.value }}
    </span>

    <Teleport to="body">
      <div
        v-if="voice.consentOpen.value"
        class="voice-consent-backdrop"
        data-voice-consent
        @click.self="voice.cancelConsent"
      >
        <section class="voice-consent-dialog" role="dialog" aria-modal="true" aria-labelledby="voice-consent-title">
          <span class="voice-consent-icon"><UIcon name="i-lucide-mic" /></span>
          <div class="voice-consent-copy">
            <small>首次使用</small>
            <h2 id="voice-consent-title">启用系统语音录入</h2>
            <p>语音由 Windows / WebView 的系统语音服务识别。根据系统设置，音频可能发送到系统语音服务进行处理。</p>
            <ul>
              <li><UIcon name="i-lucide-shield-check" />应用不会保存录音，也不会把录音发送给 MiniMax</li>
              <li><UIcon name="i-lucide-text-cursor-input" />识别结果只填入输入框，不会自动创建或发送</li>
              <li><UIcon name="i-lucide-mouse-pointer-click" />以后仍需点击麦克风才会开始录音</li>
            </ul>
          </div>
          <div class="voice-consent-actions">
            <button type="button" class="secondary" @click="voice.cancelConsent">暂不启用</button>
            <button type="button" class="primary" data-confirm-voice @click="voice.confirmAndStart">
              <UIcon name="i-lucide-mic" />同意并开始
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.voice-input-control{position:relative;display:inline-grid;flex:0 0 auto;place-items:center}.voice-input-button{display:grid!important;width:32px!important;height:32px!important;min-width:32px!important;padding:0!important;place-items:center;border:1px solid #dcdde5!important;border-radius:9px!important;background:#fff!important;color:#696f7b!important;cursor:pointer;box-shadow:none!important}.voice-input-button:hover{border-color:#aaa4eb!important;background:#f5f3ff!important;color:#6258d7!important}.voice-input-button.listening{border-color:#df8d8d!important;background:#fff2f2!important;color:#c44848!important;box-shadow:0 0 0 4px rgb(207 73 73 / 10%)!important}.voice-input-button.unsupported{color:#a3a7ae!important}.voice-input-button :deep(svg){width:17px;height:17px}.voice-status,.voice-error{position:absolute;right:0;bottom:calc(100% + 8px);z-index:18;width:max-content;max-width:250px;padding:7px 9px;border:1px solid #ddd9ff;border-radius:8px;background:#fff;color:#5f56c7;font-size:12px;line-height:1.4;box-shadow:0 8px 24px rgb(32 34 43 / 14%)}.voice-status{display:flex;gap:6px;align-items:center}.voice-status i{width:7px;height:7px;border-radius:50%;background:#d35454;animation:voice-pulse 1s ease-in-out infinite}.voice-error{border-color:#eccaca;color:#a44242}
@keyframes voice-pulse{50%{opacity:.35;transform:scale(.75)}}
</style>

<style>
.voice-consent-backdrop{position:fixed;inset:0;z-index:1000;display:grid;padding:24px;place-items:center;background:rgb(20 22 28 / 48%);backdrop-filter:blur(5px)}.voice-consent-dialog{display:grid;grid-template-columns:52px minmax(0,1fr);gap:18px;width:min(520px,100%);padding:24px;border:1px solid #dedaf8;border-radius:18px;background:#fff;color:#333741;box-shadow:0 28px 80px rgb(20 22 35 / 28%)}.voice-consent-icon{display:grid;width:52px;height:52px;place-items:center;border-radius:16px;background:linear-gradient(145deg,#7569ec,#554ac6);color:#fff;box-shadow:0 12px 24px rgb(88 76 205 / 25%)}.voice-consent-icon svg{width:24px;height:24px}.voice-consent-copy{display:grid;gap:8px}.voice-consent-copy small{color:#6b61df;font-size:12px;font-weight:800;letter-spacing:.08em}.voice-consent-copy h2{margin:0;font-size:21px;line-height:1.25}.voice-consent-copy p{margin:0;color:#656a74;font-size:14px;line-height:1.65}.voice-consent-copy ul{display:grid;gap:8px;margin:6px 0 0;padding:0;list-style:none}.voice-consent-copy li{display:grid;grid-template-columns:18px minmax(0,1fr);gap:8px;align-items:start;color:#555a64;font-size:13px;line-height:1.5}.voice-consent-copy li svg{margin-top:2px;color:#6258d7}.voice-consent-actions{grid-column:1/-1;display:flex;gap:10px;justify-content:flex-end;padding-top:4px}.voice-consent-actions button{display:flex;gap:7px;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer}.voice-consent-actions .secondary{border:1px solid #dedfe5;background:#fff;color:#6b7079}.voice-consent-actions .primary{border:1px solid #6258d7;background:#6b61df;color:#fff;box-shadow:0 8px 20px rgb(91 80 205 / 20%)}@media(max-width:560px){.voice-consent-dialog{grid-template-columns:1fr;padding:20px}.voice-consent-icon{width:44px;height:44px;border-radius:13px}.voice-consent-actions{grid-column:1;display:grid;grid-template-columns:1fr 1fr}}
</style>
