import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import {
  MAX_TASK_ATTACHMENT_BYTES,
  addTaskAttachments,
  isPreviewableTaskImage,
  resolveTaskAttachment,
  materializeWorkspaceAttachments,
  parsePortableWorkspaceBackup,
} from '../../app/services/task-attachments'
import { taskAttachmentSchema, workspaceDocumentSchema } from '../../shared/workspace'

function file(name: string, type: string, bytes: number[]) {
  const buffer = Uint8Array.from(bytes).buffer
  return {
    name,
    type,
    size: buffer.byteLength,
    arrayBuffer: async () => buffer,
  }
}

describe('task attachments', () => {
  const stored = { id: '40000000-0000-4000-8000-000000000001', name: 'photo.png', mimeType: 'image/png', size: 3,
    dataUrl: 'attachment:40000000-0000-4000-8000-000000000001' }
  it('resolves stored images on demand and validates returned content size', async () => {
    expect(await resolveTaskAttachment(stored, async () => 'data:image/png;base64,AQID')).toBe('data:image/png;base64,AQID')
    await expect(resolveTaskAttachment(stored, async () => 'data:image/png;base64,AQ==')).rejects.toThrow('大小')
    await expect(resolveTaskAttachment(stored, async () => 'https://example.invalid')).rejects.toThrow()
    await expect(resolveTaskAttachment(stored, async () => { throw new Error('missing') })).rejects.toThrow('missing')
  })
  it('exports portable inline attachments without mutating the task document', async () => {
    const doc = createDemoWorkspace()
    doc.tasks[0]!.attachments = [stored]
    const backup = await materializeWorkspaceAttachments(doc, async () => 'data:image/png;base64,AQID')
    expect(backup.tasks[0]!.attachments[0]!.dataUrl).toBe('data:image/png;base64,AQID')
    expect(doc.tasks[0]!.attachments[0]!.dataUrl).toBe(stored.dataUrl)
    expect(parsePortableWorkspaceBackup(backup)).toEqual(backup)
    expect(() => parsePortableWorkspaceBackup(doc)).toThrow('完整')
  })
  it('accepts only a stored reference matching the attachment ID', () => {
    const id = '40000000-0000-4000-8000-000000000001'
    const attachment = { id, name: 'photo.png', mimeType: 'image/png', size: 3, dataUrl: `attachment:${id}` }
    expect(taskAttachmentSchema.safeParse(attachment).success).toBe(true)
    expect(taskAttachmentSchema.safeParse({ ...attachment, dataUrl: 'attachment:40000000-0000-4000-8000-000000000002' }).success).toBe(false)
    expect(taskAttachmentSchema.safeParse({ ...attachment, dataUrl: 'https://example.invalid/photo.png' }).success).toBe(false)
  })
  it('accepts Vue reactive attachment arrays without DataCloneError', async () => {
    const existing = reactive(await addTaskAttachments([], [file('已有.png', 'image/png', [1])]))
    const result = await addTaskAttachments(existing, [file('新图.png', 'image/png', [2])])
    expect(result).toHaveLength(2)
    expect(existing).toHaveLength(1)
  })
  it('encodes local files into portable task data and recognizes safe image previews', async () => {
    const attachments = await addTaskAttachments(
      [],
      [
        file('方案.png', 'image/png', [1, 2, 3]),
        file('需求.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', [4, 5]),
      ],
      () => '40000000-0000-4000-8000-000000000001',
    )

    expect(attachments).toHaveLength(2)
    expect(attachments[0]).toMatchObject({
      name: '方案.png',
      mimeType: 'image/png',
      size: 3,
      dataUrl: 'data:image/png;base64,AQID',
    })
    expect(isPreviewableTaskImage(attachments[0]!)).toBe(true)
    expect(isPreviewableTaskImage(attachments[1]!)).toBe(false)
  })

  it('rejects oversized files and keeps the existing list unchanged', async () => {
    const existing = await addTaskAttachments([], [file('已有.txt', 'text/plain', [1])])
    const oversized = {
      name: '太大.zip',
      type: 'application/zip',
      size: MAX_TASK_ATTACHMENT_BYTES + 1,
      arrayBuffer: async () => new ArrayBuffer(0),
    }

    await expect(addTaskAttachments(existing, [oversized])).rejects.toThrow('不能超过 5 MB')
    expect(existing).toHaveLength(1)
  })

  it('migrates existing tasks with an empty attachment list', () => {
    const legacy = createDemoWorkspace() as unknown as { tasks: Array<Record<string, unknown>> }
    for (const task of legacy.tasks) Reflect.deleteProperty(task, 'attachments')

    const migrated = workspaceDocumentSchema.parse(legacy)

    expect(migrated.tasks.every(task => task.attachments.length === 0)).toBe(true)
  })
})
