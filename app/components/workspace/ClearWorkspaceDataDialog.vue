<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  taskCount: number
  projectCount: number
  milestoneCount: number
  quarterGoalCount: number
  saving: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

const confirmationPhrase = ref('')
const canConfirm = computed(() => confirmationPhrase.value === '清空数据' && !props.saving)

watch(() => props.open, (open) => {
  if (open) confirmationPhrase.value = ''
})

function close() {
  if (!props.saving) emit('close')
}

function confirm() {
  if (canConfirm.value) emit('confirm')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="close">
      <section class="workspace-dialog clear-workspace-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-workspace-title">
        <header class="dialog-header">
          <div><small>DANGER ZONE</small><h2 id="clear-workspace-title">清空工作区数据</h2></div>
          <button type="button" data-close-clear-workspace aria-label="关闭" :disabled="saving" @click="close"><UIcon name="i-lucide-x" /></button>
        </header>
        <div class="clear-workspace-body">
          <div class="danger-callout">
            <span><UIcon name="i-lucide-triangle-alert" /></span>
            <div><b>此操作无法撤销</b><p>将永久删除所有实际和测试数据，但不会删除 MiniMax 密钥、模型及界面设置。</p></div>
          </div>
          <div class="clear-counts" aria-label="即将删除的数据">
            <span><b>{{ taskCount }}</b> 项任务</span>
            <span><b>{{ projectCount }}</b> 个项目</span>
            <span><b>{{ milestoneCount }}</b> 个里程碑</span>
            <span><b>{{ quarterGoalCount }}</b> 个季度目标</span>
          </div>
          <label class="confirmation-field">
            <span>请输入“清空数据”确认</span>
            <input
              v-model="confirmationPhrase"
              data-clear-workspace-phrase
              :disabled="saving"
              autocomplete="off"
              placeholder="清空数据"
              @keydown.enter.prevent="confirm"
            >
          </label>
          <div class="dialog-actions">
            <button type="button" class="secondary-action" data-cancel-clear-workspace :disabled="saving" @click="close">取消</button>
            <button type="button" class="danger-button" data-confirm-clear-workspace :disabled="!canConfirm" @click="confirm">{{ saving ? '正在清空…' : '永久清空' }}</button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.clear-workspace-dialog{width:min(100%,470px)}
.clear-workspace-body{display:grid;gap:16px;padding:18px 20px 20px}
.danger-callout{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;padding:13px;border:1px solid #f0caca;border-radius:10px;background:#fff7f7}
.danger-callout>span{display:grid;width:32px;height:32px;place-items:center;border-radius:8px;background:#ffe7e7;color:#be4848}
.danger-callout b{color:#923838;font-size:15px}.danger-callout p{margin:4px 0 0;color:#795d5d;font-size:13px;line-height:1.55}
.clear-counts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.clear-counts span{display:grid;place-items:center;min-height:58px;border:1px solid #e3e4e8;border-radius:8px;background:#fafafd;color:#686d76;font-size:12px}.clear-counts b{color:#292c32;font-size:19px}
.confirmation-field{display:grid;gap:7px}.confirmation-field>span{color:#5f646d;font-size:13px;font-weight:700}.confirmation-field input{height:40px;padding:0 11px;border:1px solid #d9dbe1;border-radius:8px;outline:0;color:#292c32;font:inherit;font-size:14px}.confirmation-field input:focus{border-color:#d56262;box-shadow:0 0 0 3px #fff0f0}.confirmation-field input:disabled,.dialog-actions button:disabled,.dialog-header button:disabled{opacity:.5;cursor:not-allowed}
.dialog-actions{margin-top:0}
</style>
