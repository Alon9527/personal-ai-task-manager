<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  parentLabel: string
  dependents: Array<{ actionId: string, label: string }>
  resolveDecision: (resolution: 'deselect-dependents' | 'keep-and-reassign') => boolean | Promise<boolean>
  cancelDecision: () => boolean | Promise<boolean>
}>()

const panel = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const resolving = ref(false)
let returnFocus: HTMLElement | null = null

onMounted(() => {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  cancelButton.value?.focus()
})

onBeforeUnmount(() => returnFocus?.focus())

async function cancel() {
  if (resolving.value) return
  resolving.value = true
  try {
    const accepted = await props.cancelDecision()
    if (!accepted) resolving.value = false
  }
  catch {
    resolving.value = false
  }
}

async function resolve(resolution: 'deselect-dependents' | 'keep-and-reassign') {
  if (resolving.value) return
  resolving.value = true
  try {
    const accepted = await props.resolveDecision(resolution)
    if (!accepted) resolving.value = false
  }
  catch {
    resolving.value = false
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }
  if (event.key !== 'Tab') return
  const controls = focusableControls()
  if (controls.length === 0) return
  const first = controls[0]!
  const last = controls.at(-1)!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
  else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function focusableControls() {
  return [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
}
</script>

<template>
  <div class="agent-safety-dialog-backdrop" @mousedown.self.prevent>
    <section
      ref="panel"
      data-agent-dependency-dialog
      class="agent-safety-dialog agent-safety-dialog__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-dependency-title"
      aria-describedby="agent-dependency-description"
      @keydown="handleKeydown"
    >
      <header class="agent-safety-dialog__header">
        <span class="agent-safety-dialog__symbol" aria-hidden="true">↳</span>
        <div>
          <span class="agent-plan-kicker">DEPENDENCY CHECK</span>
          <h2 id="agent-dependency-title" class="agent-plan-heading">下属改动仍在使用此项目</h2>
        </div>
      </header>

      <div class="agent-safety-dialog__scroll">
        <p id="agent-dependency-description">
          “{{ parentLabel }}”还有 <strong>{{ dependents.length }} 项下属改动</strong>，请选择如何处理。
        </p>
        <ul class="agent-safety-dialog__list">
          <li v-for="dependent in dependents" :key="dependent.actionId">{{ dependent.label }}</li>
        </ul>
        <p class="agent-safety-dialog__meta">取消不会修改计划。重新归属后，必须先处理标记的关系字段才能执行。</p>
      </div>

      <footer class="agent-safety-dialog__actions">
        <button ref="cancelButton" type="button" data-agent-dependency-cancel class="agent-control agent-quiet-button" :disabled="resolving" @click="cancel">取消</button>
        <button type="button" data-agent-dependency-reassign class="agent-control agent-quiet-button" :disabled="resolving" @click="resolve('keep-and-reassign')">
          保留下属项并重新归属
        </button>
        <button type="button" data-agent-dependency-recursive class="agent-control agent-primary-button" :disabled="resolving" @click="resolve('deselect-dependents')">
          同时取消下属项
        </button>
      </footer>
    </section>
  </div>
</template>
