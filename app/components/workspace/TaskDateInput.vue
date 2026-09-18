<script setup lang="ts">
import { normalizeTaskDateInput } from '../../utils/task-date-input'
const value = defineModel<string>({ required: true })
defineProps<{ name: string, label: string }>()
function normalize() {
  value.value = normalizeTaskDateInput(value.value)
}
</script>
<template><div class="task-date-input"><input v-model="value" :name="name" :aria-label="label" type="text" placeholder="YYYY-MM-DD" inputmode="numeric" autocomplete="off" @blur="normalize"><input v-model="value" type="date" :aria-label="`选择${label}`" title="打开日历选择日期"></div></template>
<style scoped>
.task-date-input{display:flex;gap:6px;min-width:0}.task-date-input input:first-child{min-width:0;flex:1}.task-date-input input[type=date]{width:44px!important;min-width:44px;padding:8px;color:transparent}.task-date-input input[type=date]::-webkit-datetime-edit{display:none}.task-date-input input[type=date]::-webkit-calendar-picker-indicator{margin:0;cursor:pointer}
</style>
