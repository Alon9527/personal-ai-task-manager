import { taskAttachmentSchema } from '#shared/workspace'
import type { TaskAttachment } from '#shared/workspace'

export const MAX_TASK_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_TASK_ATTACHMENTS = 8
export const MAX_TASK_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024

const PREVIEWABLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

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
  const current = taskAttachmentSchema.array().max(MAX_TASK_ATTACHMENTS).parse(structuredClone(existing))
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
