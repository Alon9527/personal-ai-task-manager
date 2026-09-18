import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'
import { aiModelTargetSchema } from './ai-model-target'
import type { AiModelTarget } from './ai-model-target'
export const quarterSuggestionSchema = z.object({ quarter: z.string().regex(/^\d{4}-Q[1-4]$/), title: z.string().trim().min(1).max(160), description: z.string().max(2800), evidence: z.string().trim().min(1).max(600) })
export type QuarterSuggestion = z.infer<typeof quarterSuggestionSchema>
export async function suggestQuarterGoals(text: string, year: number, target: AiModelTarget) {
  if (!isTauri()) throw new Error('请在 Windows 桌面版中导入并分析总结')
  const request = z.object({ text: z.string().trim().min(1).max(20000), year: z.number().int().min(2000).max(2100), target: aiModelTargetSchema }).parse({ text, year, target })
  const result = z.object({ goals: z.array(quarterSuggestionSchema).max(16) }).parse(await invoke('ai_suggest_quarter_goals', { request }))
  if (result.goals.some(g => !g.quarter.startsWith(`${year}-Q`) || !text.includes(g.evidence))) throw new Error('模型建议缺少原文依据或年份不符')
  return result.goals
}
