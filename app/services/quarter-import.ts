import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'
import { aiModelTargetSchema } from './ai-model-target'
import type { AiModelTarget } from './ai-model-target'
export const quarterSuggestionSchema = z.object({ quarter: z.string().regex(/^\d{4}-Q[1-4]$/), title: z.string().trim().min(1).max(160), description: z.string().max(2800), evidence: z.string().trim().max(600).default('') })
export type QuarterSuggestion = z.infer<typeof quarterSuggestionSchema>
export async function suggestQuarterGoals(text: string, year: number, target: AiModelTarget) {
  if (!isTauri()) throw new Error('请在 Windows 桌面版中导入并分析总结')
  const request = z.object({ text: z.string().trim().min(1).max(20000), year: z.number().int().min(2000).max(2100), target: aiModelTargetSchema }).parse({ text, year, target })
  const result = z.object({
    goals: z.array(quarterSuggestionSchema.extend({ quarter: z.string().regex(/^\d{4}-Q[1-4]$/).or(z.literal('')) })).max(16),
    analysis: z.string().max(40000).default(''),
    notice: z.string().max(1000).default(''),
  }).parse(await invoke('ai_suggest_quarter_goals', { request }))
  if (result.goals.some(g => (g.quarter && !g.quarter.startsWith(`${year}-Q`)) || (g.evidence && !text.includes(g.evidence)))) throw new Error('模型建议引用的原文或年份不符；这不是文档格式问题，请重新生成。')
  return result
}
