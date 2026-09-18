<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { getFeishuStatus, saveFeishuConfig, testFeishuConnection, inspectFeishuTable } from '../../services/feishu-api'
import type { FeishuProbe, FeishuInspection } from '../../services/feishu-api'

const appId = ref(''); const appSecret = ref(''); const url = ref('')
const configured = ref(false); const available = ref(false); const busy = ref(false)
const error = ref(''); const message = ref(''); const saved = ref({ appId: '', url: '' })
const probe = ref<FeishuProbe | null>(null); const inspection = ref<FeishuInspection | null>(null); const selectedTable = ref('')
const dirty = computed(() => appId.value !== saved.value.appId || url.value !== saved.value.url || !!appSecret.value)
let alive = true
function errorText(e: unknown, fallback: string) { return e instanceof Error ? e.message : typeof e === 'string' ? e : fallback }
onBeforeUnmount(() => { alive = false; appSecret.value = '' })
onMounted(async () => {
  busy.value = true
  try {
    const status = await getFeishuStatus()
    if (!alive) return
    available.value = true; configured.value = status.configured
    appId.value = status.appId; url.value = status.url; saved.value = { appId: status.appId, url: status.url }
  } catch (e) { if (alive) error.value = errorText(e, '读取配置失败') }
  finally { if (alive) busy.value = false }
})
async function run(action: 'save' | 'test' | 'read') {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''; inspection.value = null
  if (action !== 'read') { probe.value = null; selectedTable.value = '' }
  try {
    if (action === 'save') {
      const status = await saveFeishuConfig({ appId: appId.value, appSecret: appSecret.value, url: url.value })
      if (!alive) return
      appSecret.value = ''; configured.value = status.configured
      appId.value = status.appId; url.value = status.url; saved.value = { appId: status.appId, url: status.url }
      message.value = '配置已安全保存，尚未进行线上连接测试。'
    } else if (action === 'test') {
      const result = await testFeishuConnection()
      if (!alive) return
      probe.value = result; selectedTable.value = result.tables[0]?.table_id ?? ''
      message.value = `应用鉴权与数据表列表读取成功，返回 ${result.tables.length} 张数据表。尚未验收写入。`
    } else {
      const result = await inspectFeishuTable(selectedTable.value)
      if (!alive) return
      inspection.value = result; message.value = '字段与记录读取成功，没有修改飞书或本机任务。'
    }
  } catch (e) { if (alive) error.value = errorText(e, '飞书操作失败') }
  finally { if (alive) { busy.value = false; if (action === 'save') appSecret.value = '' } }
}
</script>

<template>
  <section class="suite-card" aria-label="飞书 API 接入">
    <header><div><h2>飞书 API 接入</h2><p>中国版企业自建应用 · 安全配置与只读联调</p></div><span>{{ configured ? '已保存配置' : '未配置' }}</span></header>
    <p>App Secret 仅保存在 Windows 凭据管理器，不写入任务备份或浏览器存储。保存配置不会联网。</p>
    <form class="suite-settings-form" @submit.prevent="run('save')">
      <label>App ID<input v-model="appId" :disabled="busy || !available" autocomplete="off" placeholder="cli_…" required></label>
      <label>App Secret<input v-model="appSecret" :disabled="busy || !available" type="password" autocomplete="new-password" :placeholder="configured ? '留空保留现有密钥；换应用时必填' : '在本机填写，不要发到聊天'" :required="!configured" maxlength="512"></label>
      <label class="feishu-link-field">测试多维表格链接<input v-model="url" :disabled="busy || !available" type="url" placeholder="https://…feishu.cn/wiki/… 或 /base/…" required></label>
      <footer><button class="suite-primary" :disabled="busy || !available" type="submit">保存安全配置</button><button class="suite-secondary" type="button" :disabled="busy || !configured || dirty" @click="run('test')">测试连接并获取数据表</button></footer>
    </form>
    <p class="suite-hint">点击测试才会向飞书官方接口发送应用凭据、解析表格链接；不会向模型发送表格内容。/wiki/ 链接可能还需知识库节点读取权限。</p>
    <p v-if="dirty && configured" class="suite-hint">配置有未保存修改，请先保存再测试。</p>
    <p v-if="busy" role="status">正在处理，请稍候…</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="error" role="alert" class="feishu-error">{{ error }}</p>
    <div v-if="probe" class="feishu-inspection">
      <label>测试数据表<select v-model="selectedTable" :disabled="busy || dirty" @change="inspection = null; message = ''"><option v-for="table in probe.tables" :key="table.table_id" :value="table.table_id">{{ table.name }}</option></select></label>
      <button class="suite-secondary" :disabled="busy || dirty || !selectedTable" @click="run('read')">读取字段及前 5 条记录</button>
      <p v-if="!probe.tables.length">接口未返回可访问的数据表，请检查测试表与应用授权。</p>
      <p v-if="probe.hasMore">仅列出前 100 张数据表，请使用专用测试多维表格。</p>
      <div v-if="inspection"><p>字段：{{ inspection.fields.join('、') || '无字段' }}</p><p>本次读取 {{ inspection.recordsRead }} 条记录（只显示数量，不导入本机）。{{ inspection.hasMore ? '仍有更多字段或记录，本次不是全量读取。' : '' }}</p></div>
    </div>
    <p class="suite-hint">当前阶段不写入、不删除、不自动同步。真实写入验收与确认流程完成后才正式发布。</p>
  </section>
</template>

<style scoped>
.feishu-link-field { grid-column: 1 / -1; }
.feishu-error { color: #b42318; overflow-wrap: anywhere; }
.feishu-inspection { display: grid; gap: 14px; margin-top: 20px; }
.feishu-inspection label { display: grid; gap: 8px; }
.feishu-inspection select { border: 1px solid #d9d9e6; border-radius: 8px; padding: 10px; background: white; color: #202130; }
button:disabled { opacity: .5; cursor: not-allowed; }
</style>
