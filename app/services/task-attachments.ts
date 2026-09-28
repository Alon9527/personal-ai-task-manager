import { invoke, isTauri } from '@tauri-apps/api/core'
import { taskAttachmentSchema, migrateWorkspaceDocument, workspaceDocumentSchema } from '#shared/workspace'
import type { TaskAttachment, WorkspaceDocument } from '#shared/workspace'

export const MAX_TASK_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_TASK_ATTACHMENTS = 8
export const MAX_TASK_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024

const PREVIEWABLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function isStoredTaskAttachment(attachment: TaskAttachment) {
  return attachment.dataUrl === `attachment:${attachment.id}`
}

async function loadDesktopAttachment(id: string): Promise<string> {
  if (!isTauri()) throw new Error('本机附件只能在桌面软件中读取，请导入包含完整附件的备份')
  try { return await invoke<string>('workspace_load_attachment', { attachmentId: id }) }
  catch (cause) { throw new Error(typeof cause === 'string' ? cause : '附件读取失败，请恢复完整备份', { cause }) }
}

export async function resolveTaskAttachment(attachment: TaskAttachment, load = loadDesktopAttachment): Promise<string> {
  const checked = taskAttachmentSchema.parse(attachment)
  const url = isStoredTaskAttachment(checked) ? await load(checked.id) : checked.dataUrl
  const prefix = `data:${checked.mimeType};base64,`
  if (!url.startsWith(prefix) || url.length > 7_100_000) throw new Error('附件内容格式无效')
  let size: number
  try { size = atob(url.slice(prefix.length)).length }
  catch { throw new Error('附件内容编码无效') }
  if (size !== checked.size) throw new Error('附件内容大小不匹配，请恢复完整备份')
  return url
}

export async function materializeWorkspaceAttachments(document: WorkspaceDocument, load = loadDesktopAttachment): Promise<WorkspaceDocument> {
  const portable = workspaceDocumentSchema.parse(document)
  // Sequential reads bound memory during export; no content is written into live state.
  for (const task of portable.tasks) for (const attachment of task.attachments) {
    attachment.dataUrl = await resolveTaskAttachment(attachment, load)
  }
  return portable
}

export function parsePortableWorkspaceBackup(input: unknown): WorkspaceDocument {
  const document = migrateWorkspaceDocument(input)
  if (document.tasks.some(task => task.attachments.some(isStoredTaskAttachment))) {
    throw new Error('备份仅含本机附件引用，请在原电脑导出包含完整附件的工作区备份')
  }
  return document
}

export type TaskAttachmentFile = {
  name: string
  type: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

export function isPreviewableTaskImage(attachment: Pick<TaskAttachment, 'mimeType'>) {
  return PREVIEWABLE_IMAGE_TYPES.has(attachment.mimeType)
}

export async function addTaskAttachments(
  existing: TaskAttachment[],
  files: TaskAttachmentFile[],
  createId: () => string = () => crypto.randomUUID(),
): Promise<TaskAttachment[]> {
  // Zod returns detached plain data; structuredClone cannot clone Vue proxies.
  const current = taskAttachmentSchema.array().max(MAX_TASK_ATTACHMENTS).parse(existing)
  if (current.length + files.length > MAX_TASK_ATTACHMENTS) {
    throw new Error(`每个任务最多添加 ${MAX_TASK_ATTACHMENTS} 个附件`)
  }

  for (const file of files) {
    validateFile(file)
  }
  const totalSize = current.reduce((sum, attachment) => sum + attachment.size, 0)
    + files.reduce((sum, file) => sum + file.size, 0)
  if (totalSize > MAX_TASK_ATTACHMENTS_TOTAL_BYTES) {
    throw new Error('单个任务的附件总大小不能超过 20 MB')
  }

  const additions: TaskAttachment[] = []
  for (const file of files) {
    const buffer = await file.arrayBuffer()
    if (buffer.byteLength !== file.size) {
      throw new Error(`${file.name} 读取不完整，请重新选择`)
    }
    const mimeType = normalizeMimeType(file.type)
    additions.push(taskAttachmentSchema.parse({
      id: createId(),
      name: file.name.trim(),
      mimeType,
      size: file.size,
      dataUrl: `data:${mimeType};base64,${encodeBase64(buffer)}`,
    }))
  }
  return [...current, ...additions]
}

function validateFile(file: TaskAttachmentFile) {
  const name = file.name.trim()
  if (!name || name.length > 255 || /[\\/]/.test(name) || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('附件名称无效')
  }
  if (!Number.isInteger(file.size) || file.size < 0) {
    throw new Error(`${name} 的文件大小无效`)
  }
  if (file.size > MAX_TASK_ATTACHMENT_BYTES) {
    throw new Error(`${name} 不能超过 5 MB`)
  }
}

function normalizeMimeType(value: string) {
  const normalized = value.trim().toLowerCase()
  return /^[\w.+-]+\/[\w.+-]+$/.test(normalized) ? normalized : 'application/octet-stream'
}

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
