<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { loadAiModelTarget, saveAiModelTarget } from '../../services/ai-model-target'
import { MINIMAX_MODELS } from '../../services/minimax-model'
import type { ModelProviderProfile } from '../../services/model-provider'
defineProps<{profiles:ModelProviderProfile[]}>()
const emit=defineEmits<{change:[target:ReturnType<typeof loadAiModelTarget>]}>()
const value=ref(''), error=ref('')
function load(){try{const t=loadAiModelTarget();value.value=t.kind==='minimax'?`minimax:${t.modelId}`:`custom:${t.profileId}`}catch{error.value='无法读取当前模型。'}}
function change(event:Event){const v=(event.target as HTMLSelectElement).value;try{const t=saveAiModelTarget(v.startsWith('custom:')?{kind:'custom',profileId:v.slice(7)}:{kind:'minimax',modelId:v.slice(8)});value.value=v;error.value='';emit('change',t)}catch{error.value='模型选择保存失败，请重试。';load()}}
onMounted(()=>{load();window.addEventListener('focus-ai-model-changed',load)})
onBeforeUnmount(()=>window.removeEventListener('focus-ai-model-changed',load))
</script>
<template><section class="active-model"><label>当前使用的模型<select :value="value" aria-label="当前使用的模型" @change="change"><option value="" disabled>请选择模型</option><optgroup label="MiniMax"><option v-for="m in MINIMAX_MODELS" :key="m.id" :value="`minimax:${m.id}`">MiniMax {{m.label}}</option></optgroup><optgroup label="自定义 API"><option v-for="p in profiles" :key="p.id" :value="`custom:${p.id}`">{{p.name}} · {{p.modelId}}</option></optgroup><option v-if="value.startsWith('custom:')&&!profiles.some(p=>value===`custom:${p.id}`)" :value="value" disabled>原模型配置不可用，请重新选择</option></select></label><small>选择后立即保存，仅切换使用的模型，不修改 API Key。</small><p v-if="error" role="alert">{{error}}</p></section></template>
<style scoped>.active-model{margin:18px 0;padding:14px;background:#f8f6ff;border:1px solid #e7e0f5;border-radius:10px}.active-model label{display:grid;gap:8px;font-size:14px}.active-model select{padding:10px;border:1px solid #ded6ef;border-radius:7px;background:#fff;color:inherit}.active-model small{display:block;color:#777b8d;margin-top:8px}.active-model p{color:#b94148}</style>
