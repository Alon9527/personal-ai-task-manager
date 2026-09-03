import { z } from 'zod'

export const MINIMAX_MODELS = [
  { id: 'MiniMax-M3', label: 'M3', description: '最新旗舰 Agent 模型，支持超长上下文与复杂规划' },
  { id: 'MiniMax-M2.7', label: 'M2.7', description: '最新通用模型，适合规划与 Agent 操作' },
  { id: 'MiniMax-M2.7-highspeed', label: 'M2.7 高速版', description: '更快响应，需要对应高速套餐' },
  { id: 'MiniMax-M2.5', label: 'M2.5', description: '稳定的工具调用与办公任务能力' },
  { id: 'MiniMax-M2.5-highspeed', label: 'M2.5 高速版', description: 'M2.5 低延迟版本，需要对应套餐' },
  { id: 'MiniMax-M2.1', label: 'M2.1', description: '多语言与复杂任务处理' },
  { id: 'MiniMax-M2.1-highspeed', label: 'M2.1 高速版', description: 'M2.1 低延迟版本' },
  { id: 'MiniMax-M2', label: 'M2', description: '经典 Agent 推理模型' },
] as const

export type MiniMaxModel = typeof MINIMAX_MODELS[number]['id']
export const miniMaxModelSchema = z.enum(
  MINIMAX_MODELS.map(option => option.id) as [MiniMaxModel, ...MiniMaxModel[]],
)
export const DEFAULT_MINIMAX_MODEL: MiniMaxModel = 'MiniMax-M3'
export const MINIMAX_MODEL_STORAGE_KEY = 'personal-ai-minimax-model:v1'

export function isMiniMaxModel(value: unknown): value is MiniMaxModel {
  return miniMaxModelSchema.safeParse(value).success
}

export function loadMiniMaxModel(storage: Pick<Storage, 'getItem'> = localStorage): MiniMaxModel {
  const value = storage.getItem(MINIMAX_MODEL_STORAGE_KEY)
  return isMiniMaxModel(value) ? value : DEFAULT_MINIMAX_MODEL
}

export function saveMiniMaxModel(model: MiniMaxModel, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(MINIMAX_MODEL_STORAGE_KEY, model)
}
