import { describe, expect, it } from 'vitest'
import { DEMO_OWNER_ID, workspaceDocumentSchema } from '#shared/workspace'
import {
  appendImportedTasks,
  buildImportCandidates,
  type ParsedOfficeDocument,
} from '../../app/services/document-import'

const PROJECT_ID = '10000000-0000-4000-8000-000000000001'

function workspace() {
  return workspaceDocumentSchema.parse({
    version: 3,
    projects: [{
      id: PROJECT_ID,
      ownerId: DEMO_OWNER_ID,
      name: '新品上市',
      color: '#8b7cf6',
      description: '',
      priority: null,
      status: 'active',
      targetDate: null,
      sortOrder: 0,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      deletedAt: null,
    }],
    milestones: [],
    tasks: [],
    quarterGoals: [],
  })
}

describe('Office document import', () => {
  it('maps a Chinese Excel header row into editable task candidates', () => {
    const parsed: ParsedOfficeDocument = {
      kind: 'xlsx',
      sourceName: '新品排期.xlsx',
      rows: [
        ['任务', '说明', '项目', '重要性', '截止日期'],
        ['确认包装刀模', '联系供应商', '新品上市', '重要', '2026/09/08'],
        ['整理商品图', '', '不存在的项目', '普通', ''],
      ],
      warnings: [],
    }

    const result = buildImportCandidates(parsed, workspace().projects)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      title: '确认包装刀模',
      description: '联系供应商',
      projectId: PROJECT_ID,
      importance: 'important',
      priority: 'high',
      dueDate: '2026-09-08',
      isFocus: true,
    })
    expect(result[1]?.projectId).toBeNull()
  })

  it('turns Word paragraphs into preview rows and removes bullet markers', () => {
    const parsed: ParsedOfficeDocument = {
      kind: 'docx',
      sourceName: '会议纪要.docx',
      rows: [['• 跟进报价'], ['2. 确认交期'], ['']],
      warnings: [],
    }

    const result = buildImportCandidates(parsed, workspace().projects)

    expect(result.map(item => item.title)).toEqual(['跟进报价', '确认交期'])
  })

  it('appends selected candidates as one validated workspace document', () => {
    const base = workspace()
    const parsed: ParsedOfficeDocument = {
      kind: 'docx',
      sourceName: '待办.docx',
      rows: [['提交周报'], ['预约复盘']],
      warnings: [],
    }
    const candidates = buildImportCandidates(parsed, base.projects)
    candidates[1]!.selected = false

    const next = appendImportedTasks(
      base,
      candidates,
      () => '2026-09-02T08:00:00.000Z',
      () => '40000000-0000-4000-8000-000000000001',
    )

    expect(base.tasks).toHaveLength(0)
    expect(next.tasks).toHaveLength(1)
    expect(next.tasks[0]).toMatchObject({
      id: '40000000-0000-4000-8000-000000000001',
      ownerId: DEMO_OWNER_ID,
      title: '提交周报',
      status: 'todo',
      completedAt: null,
      deletedAt: null,
    })
    expect(() => workspaceDocumentSchema.parse(next)).not.toThrow()
  })
})
