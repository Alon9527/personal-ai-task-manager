import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

const statusSchema = z.object({ configured: z.boolean(), appId: z.string(), url: z.string() })
const tableId = z.string().regex(/^tbl[a-zA-Z0-9_]+$/).max(200)
const probeSchema = z.object({ tables: z.array(z.object({ table_id: tableId, name: z.string() })), hasMore: z.boolean() })
const inspectionSchema = z.object({ fields: z.array(z.string()), recordsRead: z.number().int().min(0).max(5), hasMore: z.boolean() })
export type FeishuStatus = z.infer<typeof statusSchema>
export type FeishuProbe = z.infer<typeof probeSchema>
export type FeishuInspection = z.infer<typeof inspectionSchema>
function desktop() { if (!isTauri()) throw new Error('请在 Windows 桌面软件中配置和测试飞书，浏览器预览不可用。') }
export async function getFeishuStatus() { desktop(); return statusSchema.parse(await invoke('feishu_get_status')) }
export async function saveFeishuConfig(input: { appId: string, appSecret: string, url: string }) {
  desktop()
  const parsed = z.object({ appId: z.string().trim().regex(/^cli_[a-zA-Z0-9_]+$/).max(200), appSecret: z.string().max(512), url: z.string().trim().url().max(1024) }).parse(input)
  return statusSchema.parse(await invoke('feishu_save_config', { input: parsed }))
}
export async function testFeishuConnection() { desktop(); return probeSchema.parse(await invoke('feishu_test_connection')) }
export async function inspectFeishuTable(id: string) { desktop(); return inspectionSchema.parse(await invoke('feishu_inspect_table', { tableId: tableId.parse(id) })) }
