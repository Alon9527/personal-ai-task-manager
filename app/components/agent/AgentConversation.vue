<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAgentConversation } from '../../composables/useAgentConversation'
import { actionLabel, actionChanges } from '../../services/agent-action-display'
import type { AgentAction } from '../../services/agent-plan-schema'
import { conversationHistory } from '../../services/agent-conversation'
withDefaults(defineProps<{ showError?: boolean, title?: string }>(), { showError: true, title: 'AI 助手' })
const chat = useAgentConversation()
const workspace = useWorkspace()
const router = useRouter()
let navigating = false
async function openReview() { if (navigating) return; navigating = true; try { await router.push('/agent-plan') } finally { navigating = false } }
const log = ref<HTMLElement | null>(null)
const ignoredSuggestions = ref<string[]>([])
function suggestionUsed(id: string) { return chat.isBriefSuggestionUsed(id) }
const following = ref(true), newMessages = ref(false), resetting = ref(false)
const candidate = computed(() => chat.log.state.value.candidate)
const visiblePlan = computed(() => candidate.value?.draft ?? chat.pending.value)
const hasBinding = computed(() => !!chat.pending.value && chat.log.canConfirm(chat.pending.value))
const omittedMessages = computed(() => chat.log.messages.value.filter(m => m.role !== 'system' && m.status === 'ready').length - conversationHistory(chat.log.messages.value).length)
function label(action: AgentAction) {
  return actionLabel(action, workspace.document.value)
}
function changes(action: AgentAction) {
  return actionChanges(action, workspace.document.value, visiblePlan.value?.actions ?? [])
}
function track() { const el = log.value; if (el) following.value = el.scrollHeight - el.scrollTop - el.clientHeight < 35 }
function latest() { if (log.value) log.value.scrollTop = log.value.scrollHeight; following.value = true; newMessages.value = false }
watch(() => chat.log.messages.value.length, async () => { await nextTick(); if (following.value) latest(); else newMessages.value = true })
watch(() => chat.readyToDisplay.value, async value => { if (value) { await nextTick(); chat.displayed() } })
watch(resetting, async value => { if(value){await nextTick();if(log.value)log.value.scrollTop=0} })
onMounted(() => { chat.load(); void nextTick(() => { latest(); chat.displayed() }) })
</script>
<template>
  <section class="agent-conversation" aria-label="Agent 对话">
    <header><h2><UIcon name="i-lucide-sparkles" />{{ title }}</h2><button type="button" :disabled="chat.busy.value || chat.plan.executing.value" @click="resetting = !resetting">新对话</button></header>
    <slot name="shortcuts" />
    <div ref="log" class="chat-log" role="log" aria-label="聊天记录" aria-live="polite" @scroll="track">
    <div v-if="resetting" class="chat-notice" role="alert">
      <p>清空本机这段聊天记录并开始新对话？{{ chat.pending.value ? '当前待确认方案也将放弃，不会修改任务。' : '不会删除任务或目标。' }}</p>
      <button type="button" @click="chat.reset(true); resetting = false">确认开始新对话</button><button type="button" @click="resetting = false">取消</button>
    </div>
      <p v-if="!chat.log.messages.value.length" class="chat-empty">可以先分析，再提出具体修改；你确认后才会执行。</p>
      <article v-for="message in chat.log.messages.value" :key="message.id" :class="message.role" :data-chat-role="message.role">
        <strong>{{ message.role === 'user' ? '你' : message.role === 'assistant' ? 'AI' : '执行结果' }}</strong><p>{{ message.text }}</p>
        <footer v-if="message.imageCount">本轮附图 {{ message.imageCount }} 张；旧图片不会自动重发，需要时请重新添加。</footer>
        <small v-if="message.status === 'pending'">正在等待回复…</small>
        <small v-if="message.status === 'failed'" role="alert">{{ message.error }}（原问题保留，再次发送可重试）</small>
        <footer v-if="message.model">{{ message.model }} · 引用 {{ message.sourceCount ?? 0 }} 条任务 <span v-if="message.tokens">· {{ message.tokens }} tokens</span></footer>
        <details v-if="message.brief?.sources.length"><summary>引用 {{ message.brief.sources.length }} 条真实任务</summary><p v-for="source in message.brief.sources" :key="source.taskId">{{ source.title }}<span v-if="source.projectName"> · {{ source.projectName }}</span></p></details>
        <div v-if="message.brief?.suggestion && !ignoredSuggestions.includes(message.id) && !suggestionUsed(message.id)" class="brief-chat-actions"><button type="button" data-create-suggestion-plan :disabled="chat.busy.value || chat.plan.executing.value" @click="chat.suggestBrief(message.id)">生成建议计划</button><button type="button" data-ignore-suggestion @click="ignoredSuggestions.push(message.id)">暂不处理</button></div>
        <details v-if="message.plan"><summary>本轮方案 · {{ message.plan.id === chat.pending.value?.id ? '当前版本' : candidate?.draft.id === message.plan.id ? '候选版本' : '历史版本（已执行、被替代或放弃）' }} · 只读</summary><p v-for="(title,index) in message.planLabels" :key="index">{{ title }}</p></details>
      </article>
    <button v-if="newMessages" type="button" @click="latest">有新消息 · 跳到最新</button>
    <small v-if="omittedMessages > 0">较早的 {{ omittedMessages }} 条仍可回看，但未发送给模型；需要时请重述。</small>
    <p v-if="chat.log.error.value" role="alert" class="chat-error">{{ chat.log.error.value }}</p>
    <div v-if="chat.consent.value" class="chat-notice"><p>模型或连接已变化，将发送这段对话最近的文字历史（不含旧图片）。</p><button type="button" @click="chat.allowHistory">允许发送历史</button><button type="button" @click="resetting = true">改用新对话</button></div>
    <section v-if="visiblePlan" class="chat-plan agent-plan-proposal" data-chat-plan data-agent-plan-proposal>
      <strong>{{ candidate ? '候选修改 · 尚未采用' : '当前待确认方案' }}</strong>
      <p>{{ visiblePlan.actions.length }} 项操作 · 已选 {{ visiblePlan.actions.filter(a => a.selected).length }} 项 · 预计 {{ visiblePlan.validation.estimatedMinutes }} 分钟</p>
      <p>尚未修改任何任务，审阅确认后才会写入</p>
      <article v-for="action in visiblePlan.actions" :key="action.actionId" class="suite-plan-card"><div><b>{{ action.selected ? '✓' : '未选' }} {{ label(action) }}</b><p>{{ action.reason }}</p><pre v-if="action.type !== 'renameQuarterGoal'">{{ changes(action) }}</pre><small v-if="action.type === 'renameQuarterGoal'">保留季度、进度及原文依据，仅改名。</small></div></article>
      <div v-if="candidate" data-agent-plan-replacement><button v-if="chat.pending.value" type="button" data-replace-agent-plan :disabled="chat.busy.value" @click="chat.adopt">采用这版修改</button><button v-else type="button" data-retry-save-agent-plan :disabled="chat.busy.value" @click="chat.adopt">重试保存计划</button><button type="button" :disabled="chat.busy.value" @click="chat.keep">保留原方案</button><button v-if="chat.pending.value" type="button" data-continue-existing-agent-plan @click="openReview">继续审阅上次计划</button></div>
      <template v-else><button v-if="!hasBinding" type="button" :disabled="chat.busy.value" @click="chat.review">我已查看此方案</button><button v-else type="button" class="suite-ai-confirm" :disabled="chat.busy.value" @click="chat.confirm">确认执行当前方案</button><button class="agent-plan-control" type="button" data-review-agent-plan @click="openReview">审阅计划 / 调整选择</button></template>
    </section>
    <p v-if="showError && chat.error.value" role="alert" class="chat-error">{{ chat.error.value }}</p>
    </div>
    <slot name="composer" />
  </section>
</template>
<style scoped>
.chat-plan pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}.chat-plan .suite-plan-card{display:block;margin:0;box-shadow:none;background:transparent}
.chat-log pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}.chat-log footer{font-size:11px;color:#73788a}
.agent-conversation{display:grid;gap:10px;min-width:0;font-size:13px}.agent-conversation header{display:flex;justify-content:space-between;align-items:center}.agent-conversation button,.chat-plan a{padding:7px 10px;border:1px solid #d8d1f3;border-radius:7px;background:#fff;color:#6450c0;cursor:pointer}.agent-conversation button:disabled{opacity:.5;cursor:wait}.chat-log{max-height:45dvh;min-height:90px;overflow:auto;overscroll-behavior:contain}.chat-log article{margin:8px 0;padding:10px;border-radius:10px;background:#fff;border:1px solid #e8e4f4;overflow-wrap:anywhere}.chat-log .user{background:#f0eaff}.chat-log .system{background:#eaf8f1}.chat-log p{white-space:pre-wrap;line-height:1.65;margin:5px 0}.chat-log strong{font-size:12px;color:#655187}.chat-log small,.chat-error{color:#b94148}.chat-notice,.chat-plan{padding:10px;border:1px solid #d6cef6;border-radius:9px;background:#faf8ff}.chat-plan article{padding:10px 0;border-bottom:1px solid #e9e4f5;overflow-wrap:anywhere}.chat-plan p{margin:4px 0;line-height:1.5}.chat-plan small{color:#717482}.chat-plan button,.chat-plan a{display:inline-block;margin:8px 6px 0 0}.goal-context p,.chat-empty{color:#73788a;line-height:1.5}.goal-context input[type=number]{width:85px;border:1px solid #ded9ef;padding:4px}.goal-options{max-height:180px;overflow:auto}.goal-options label{display:flex;gap:7px;align-items:start;margin:8px 0}.goal-options small{display:block;font-size:10px;overflow-wrap:anywhere}.chat-error{margin:0;overflow-wrap:anywhere}
</style>
<style scoped>
.agent-conversation{display:flex;flex-direction:column;gap:0;height:100%;min-height:0;overflow:hidden}.agent-conversation>header{flex:0 0 auto;padding:22px 18px 14px}.agent-conversation h2{display:flex;align-items:center;gap:8px;margin:0;font-size:20px}.agent-conversation h2 .iconify{color:#8055ff}.agent-conversation>header>button{background:transparent;border:0;color:#7750ed;font-size:12px}.chat-log{flex:1;min-height:0;max-height:none;padding:6px 18px 18px;overflow:auto}.chat-log article.user{margin-left:24px;background:#eee8ff}.chat-log article.assistant{margin-right:12px}.chat-log article{padding:13px;font-size:13px;line-height:1.65}.chat-log .chat-plan{margin-top:14px}.chat-empty{padding:24px 4px;text-align:center;font-size:13px}.chat-log footer{margin-top:9px}.chat-log .brief-chat-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.chat-log .suite-ai-confirm{width:auto;background:#7750ff;color:#fff;border:0;padding:9px 16px;min-height:36px}.chat-log .agent-plan-control{font-size:12px}.chat-log details{margin-top:8px;font-size:12px}.chat-notice{margin-bottom:10px}button:focus-visible{outline:2px solid #7750ff;outline-offset:2px}
</style>
