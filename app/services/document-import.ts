import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'
import {
  DEMO_OWNER_ID,
  workspaceDocumentSchema,
} from '#shared/workspace'
import type {
  Project,
  Task,
  TaskImportance,
  WorkspaceDocument,
} from '#shared/workspace'

const MAX_IMPORT_BYTES = 8 * 1024 * 1024
const MAX_IMPORT_TASKS = 200

export const parsedOfficeDocumentSchema = z.object({
  kind: z.enum(['docx', 'xlsx']),
  sourceName: z.string().trim().min(1).max(255),
  rows: z.array(z.array(z.string().max(2_000)).max(32)).max(500),
  warnings: z.array(z.string().max(240)).max(10),
})

export type ParsedOfficeDocument = z.infer<typeof parsedOfficeDocumentSchema>

export interface ImportTaskCandidate {
  id: string
  sourceRow: number
  selected: boolean
  title: string
  description: string
  projectId: string | null
  priority: 'high' | 'medium' | 'low' | null
  importance: TaskImportance
  dueDate: string | null
  isFocus: boolean
}

const HEADER_ALIASES = {
  title: ['任务', '待办', '待办事项', '事项', '标题', '工作项', 'task', 'title', 'name'],
  description: ['说明', '描述', '备注', '详情', 'description', 'note', 'notes'],
  project: ['项目', '所属项目', 'project'],
  priority: ['优先级', 'priority'],
  importance: ['重要性', '重要程度', 'importance'],
  dueDate: ['截止日期', '到期日期', '计划日期', '日期', 'due date', 'duedate', 'date'],
} as const

export async function parseOfficeDocument(file: File): Promise<ParsedOfficeDocument> {
  if (!isTauri()) throw new Error('Word / Excel 导入仅支持桌面版')
  if (file.size <= 0) throw new Error('文件内容为空')
  if (file.size > MAX_IMPORT_BYTES) throw new Error('文件不能超过 8 MB')
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension !== 'docx' && extension !== 'xlsx') {
    throw new Error('仅支持 .docx 和 .xlsx 文件')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const dataBase64 = bytesToBase64(bytes)
  const response = await invoke('parse_office_document', {
    request: { fileName: file.name, dataBase64 },
  })
  return parsedOfficeDocumentSchema.parse(response)
}

export function buildImportCandidates(
  document: ParsedOfficeDocument,
  projects: Project[],
): ImportTaskCandidate[] {
  const rows = document.rows
    .map(row => row.map(cell => cell.trim()))
    .filter(row => row.some(Boolean))
  if (rows.length === 0) return []

  const projectIds = new Map(
    projects
      .filter(project => project.deletedAt === null)
      .map(project => [normalizedKey(project.name), project.id]),
  )

  const header = document.kind === 'xlsx' ? detectHeader(rows[0] ?? []) : null
  const dataRows = header ? rows.slice(1) : rows
  const seen = new Set<string>()
  const candidates: ImportTaskCandidate[] = []

  for (let index = 0; index < dataRows.length && candidates.length < MAX_IMPORT_TASKS; index += 1) {
    const row = dataRows[index] ?? []
    const rawTitle = header ? row[header.title] : row[0]
    const title = cleanTitle(rawTitle ?? '').slice(0, 160)
    if (!title) continue

    const description = (header?.description === undefined ? '' : row[header.description] ?? '').slice(0, 4_000)
    const projectName = header?.project === undefined ? '' : row[header.project] ?? ''
    const rawPriority = header?.priority === undefined ? '' : row[header.priority] ?? ''
    const rawImportance = header?.importance === undefined ? '' : row[header.importance] ?? ''
    const priority = parsePriority(rawPriority || rawImportance)
    const importance = parseImportance(rawImportance || rawPriority)
    const dueDate = parseDueDate(header?.dueDate === undefined ? '' : row[header.dueDate] ?? '')
    const duplicateKey = [title, description, projectName, dueDate].join('\u0000').toLocaleLowerCase()
    if (seen.has(duplicateKey)) continue
    seen.add(duplicateKey)

    candidates.push({
      id: crypto.randomUUID(),
      sourceRow: index + (header ? 2 : 1),
      selected: true,
      title,
      description,
      projectId: projectIds.get(normalizedKey(projectName)) ?? null,
      priority,
      importance,
      dueDate,
      isFocus: importance === 'important' || priority === 'high',
    })
  }

  return candidates
}

export function appendImportedTasks(
  document: WorkspaceDocument,
  candidates: ImportTaskCandidate[],
  now: () => string = () => new Date().toISOString(),
  createId: () => string = () => crypto.randomUUID(),
): WorkspaceDocument {
  const selected = candidates.filter(candidate => candidate.selected)
  if (selected.length === 0) throw new Error('请至少选择一项任务')
  if (selected.length > MAX_IMPORT_TASKS) throw new Error('一次最多导入 200 项任务')

  const next = structuredClone(workspaceDocumentSchema.parse(document))
  const activeProjects = new Set(next.projects.filter(project => project.deletedAt === null).map(project => project.id))
  let focusOrder = next.tasks
    .filter(task => task.deletedAt === null && task.isFocus)
    .reduce((maximum, task) => Math.max(maximum, task.sortOrder), -1) + 1
  let laterOrder = next.tasks
    .filter(task => task.deletedAt === null && !task.isFocus)
    .reduce((maximum, task) => Math.max(maximum, task.sortOrder), -1) + 1
  const timestamp = now()

  for (const candidate of selected) {
    const title = candidate.title.trim()
    if (!title) throw new Error(`第 ${candidate.sourceRow} 行缺少任务标题`)
    const task: Task = {
      id: createId(),
      ownerId: DEMO_OWNER_ID,
      title: title.slice(0, 160),
      description: candidate.description.slice(0, 4_000),
      projectId: candidate.projectId && activeProjects.has(candidate.projectId) ? candidate.projectId : null,
      milestoneId: null,
      priority: candidate.priority,
      dueDate: candidate.dueDate,
      dueTime: null,
      isFocus: candidate.isFocus,
      status: 'todo',
      importance: candidate.importance,
      estimatedMinutes: null,
      reminderAt: null,
      snoozedUntil: null,
      lastRemindedAt: null,
      sortOrder: candidate.isFocus ? focusOrder++ : laterOrder++,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      attachments: [],
    }
    next.tasks.push(task)
  }

  return workspaceDocumentSchema.parse(next)
}

function detectHeader(row: string[]) {
  const indices = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => [
      field,
      row.findIndex(cell => aliases.includes(normalizedKey(cell) as never)),
    ]),
  ) as Record<keyof typeof HEADER_ALIASES, number>

  if (indices.title < 0) return null
  return {
    title: indices.title,
    description: indices.description < 0 ? undefined : indices.description,
    project: indices.project < 0 ? undefined : indices.project,
    priority: indices.priority < 0 ? undefined : indices.priority,
    importance: indices.importance < 0 ? undefined : indices.importance,
    dueDate: indices.dueDate < 0 ? undefined : indices.dueDate,
  }
}

function normalizedKey(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
}

function cleanTitle(value: string) {
  return value
    .replace(/^\s*(?:(?:[-*•▪◦☐☑✓]+)|(?:\d{1,3}[.)、]))\s*/, '')
    .trim()
}

function parsePriority(value: string): ImportTaskCandidate['priority'] {
  const normalized = normalizedKey(value)
  if (['高', '最高', '重要', '紧急', 'high', 'p0', 'p1'].includes(normalized)) return 'high'
  if (['中', '一般', 'medium', 'normal', 'p2'].includes(normalized)) return 'medium'
  if (['低', '不重要', 'low', 'p3'].includes(normalized)) return 'low'
  return null
}

function parseImportance(value: string): TaskImportance {
  const normalized = normalizedKey(value)
  return ['高', '最高', '重要', '紧急', 'high', 'important', 'p0', 'p1'].includes(normalized)
    ? 'important'
    : 'normal'
}

function parseDueDate(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) return null
  const dateMatch = normalized.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/)
  if (dateMatch) {
    const year = Number(dateMatch[1])
    const month = Number(dateMatch[2])
    const day = Number(dateMatch[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    }
  }
  if (/^\d{5}(?:\.\d+)?$/.test(normalized)) {
    const serial = Number(normalized)
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000)
    if (date.getUTCFullYear() >= 2000 && date.getUTCFullYear() <= 2100) {
      return date.toISOString().slice(0, 10)
    }
  }
  return null
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
