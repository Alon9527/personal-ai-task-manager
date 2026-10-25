<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useAgentConversation } from '../../composables/useAgentConversation'
import { useWorkspace } from '../../composables/useWorkspace'
const chat = useAgentConversation(), workspace = useWorkspace()
const dialog = ref<HTMLDialogElement | null>(null), trigger = ref<HTMLButtonElement | null>(null)
const draftIds = ref<string[]>([]), draftYear = ref(2026), query = ref(''), quarter = ref(''), notice = ref('')
const locked = computed(() => chat.busy.value || chat.plan.executing.value)
const goals = computed(() => workspace.quarterGoals.value.filter(g => !g.deletedAt))
const selected = computed(() => goals.value.filter(g => draftIds.value.includes(g.id)))
const groups = computed(() => [1,2,3,4].map(q => ({ quarter:`${draftYear.value}-Q${q}`, goals: goals.value.filter(g =>
  g.quarter === `${draftYear.value}-Q${q}` && (!quarter.value || quarter.value === `Q${q}`) &&
  g.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())) })))
const validYear = computed(() => Number.isInteger(draftYear.value) && draftYear.value >= 2000 && draftYear.value <= 2100)
async function open() {
  if (locked.value) return
  draftIds.value = [...chat.goalIds.value]; draftYear.value = chat.year.value; query.value=''; quarter.value=''; notice.value=''
  await nextTick(); dialog.value?.showModal()
}
function close() { dialog.value?.close(); trigger.value?.focus() }
function confirm() {
  if (locked.value || !validYear.value || draftIds.value.length > 80) return
  const ids = new Set(goals.value.map(g => g.id))
  const next = draftIds.value.filter(id => ids.has(id))
  notice.value = next.length !== draftIds.value.length ? '已移除失效目标引用，请检查当前选择。' : ''
  chat.goalIds.value = next; chat.year.value = draftYear.value; close()
}
</script>
<template>
  <div class="goal-picker-entry">
    <button ref="trigger" data-goal-picker type="button" :disabled="locked" @click="open"><UIcon name="i-lucide-paperclip" /> 引用季度目标 · 已选 {{ chat.goalIds.value.length }} 项 <UIcon name="i-lucide-chevron-right" /></button>
    <small v-if="notice" role="status">{{ notice }}</small>
    <Teleport to="body">
      <dialog ref="dialog" class="goal-picker-dialog" aria-labelledby="goal-picker-title" @cancel.prevent="close">
        <header><div><h2 id="goal-picker-title">引用季度目标</h2><p>选择要重点讨论的目标</p></div><button type="button" aria-label="关闭目标选择" @click="close">×</button></header>
        <div class="goal-picker-filters"><label>年份 <input v-model.number="draftYear" type="number" min="2000" max="2100" aria-label="目标年份"></label><input v-model="query" type="search" placeholder="搜索目标名称" aria-label="搜索目标名称"></div>
        <nav aria-label="季度筛选"><button v-for="q in ['', 'Q1','Q2','Q3','Q4']" :key="q" type="button" :aria-pressed="quarter===q" @click="quarter=q">{{ q || '全部' }}</button></nav>
        <div class="goal-picker-list">
          <template v-for="group in groups" :key="group.quarter"><section v-if="group.goals.length"><h3>{{ group.quarter }}</h3><label v-for="goal in group.goals" :key="goal.id"><input v-model="draftIds" type="checkbox" :value="goal.id" :disabled="locked"><span><b>{{ goal.title }}</b><small>{{ goal.description || `进度 ${goal.progress}%` }}</small></span></label></section></template>
          <p v-if="!groups.some(g=>g.goals.length)" class="goal-picker-empty">没有匹配的目标，试试其他年份或关键词。</p>
          <details v-if="selected.length" class="goal-picker-selected"><summary>查看已选 {{ selected.length }} 项（含其他年份）</summary><button v-for="goal in selected" :key="goal.id" type="button" :disabled="locked" :aria-label="`取消引用 ${goal.quarter} ${goal.title}`" @click="draftIds=draftIds.filter(id=>id!==goal.id)">{{ goal.quarter }} · {{ goal.title }} ×</button></details>
        </div>
        <p class="goal-picker-help">优先引用所选目标，仍可能结合该年份其他目标；选择引用不会修改目标。</p>
        <p v-if="draftIds.length>80 || !validYear" role="alert">{{ !validYear ? '请输入 2000～2100 的年份。' : '一次最多优先引用 80 项，请减少选择。' }}</p>
        <footer><span>已选择 {{ draftIds.length }} 项</span><button type="button" @click="close">取消</button><button type="button" class="confirm" :disabled="locked || !validYear || draftIds.length>80" @click="confirm">确认引用</button></footer>
      </dialog>
    </Teleport>
  </div>
</template>
<style scoped>
.goal-picker-entry>button{display:flex;align-items:center;gap:6px;border:1px solid #e4dcff;background:#f8f5ff;color:#6c4de1;border-radius:20px;padding:7px 11px;font-size:12px;cursor:pointer}.goal-picker-entry small{display:block;color:#87642c;margin-top:6px}
.goal-picker-dialog{width:min(600px,calc(100vw - 32px));max-height:85dvh;margin:auto;border:1px solid #e4dff1;border-radius:16px;padding:0;background:#fff;color:#262b40;box-shadow:0 20px 80px #211d4933;font-size:14px}.goal-picker-dialog[open]{display:flex;flex-direction:column}.goal-picker-dialog::backdrop{background:#17142f66}.goal-picker-dialog header{display:flex;justify-content:space-between;gap:16px;padding:22px 24px 14px}.goal-picker-dialog h2{font-size:20px;margin:0 0 6px}.goal-picker-dialog p{margin:0;color:#777b8d}.goal-picker-dialog button{border:1px solid #e1dced;background:#fff;border-radius:8px;padding:8px 14px;cursor:pointer;color:inherit}.goal-picker-dialog button:disabled{opacity:.5;cursor:not-allowed}.goal-picker-dialog header>button{border:0;font-size:24px;align-self:start;padding:0 6px}.goal-picker-filters{display:flex;gap:12px;margin:0 24px 12px}.goal-picker-filters label{white-space:nowrap;display:flex;align-items:center;gap:6px}.goal-picker-filters input{min-width:0;border:1px solid #ded9eb;border-radius:8px;padding:9px;background:#fff;color:inherit;font:inherit}.goal-picker-filters input[type=number]{width:85px}.goal-picker-filters>input{flex:1;width:0}.goal-picker-dialog nav{display:flex;gap:8px;margin:0 24px 14px}.goal-picker-dialog [aria-pressed=true],.goal-picker-dialog .confirm{background:#7750ff;color:white;border-color:#7750ff}.goal-picker-list{overflow:auto;min-height:0;padding:0 24px;overscroll-behavior:contain}.goal-picker-list section{border:1px solid #e9e5f2;border-radius:10px;margin-bottom:14px;overflow:hidden}.goal-picker-list h3{background:#f7f5fc;padding:10px 14px;margin:0;font-size:13px}.goal-picker-list label{display:flex;gap:12px;padding:14px;border-top:1px solid #f2eff8}.goal-picker-list input{accent-color:#7750ff;width:18px;height:18px;flex-shrink:0}.goal-picker-list span{min-width:0;overflow-wrap:anywhere}.goal-picker-list b{font-weight:600}.goal-picker-list small{display:block;white-space:pre-wrap;color:#777b8d;font-size:12px;margin-top:5px}.goal-picker-selected{font-size:12px;margin:10px 0}.goal-picker-selected button{display:block;text-align:left;margin:5px 0;width:100%;overflow-wrap:anywhere}.goal-picker-help{padding:12px 24px;font-size:12px;line-height:1.5}.goal-picker-dialog footer{display:flex;align-items:center;gap:10px;padding:14px 24px;border-top:1px solid #efedf5}.goal-picker-dialog footer span{flex:1}.goal-picker-dialog [role=alert]{padding:0 24px;color:#b94148}.goal-picker-empty{padding:24px 0}button:focus-visible,input:focus-visible{outline:2px solid #7750ff;outline-offset:3px}
</style>
