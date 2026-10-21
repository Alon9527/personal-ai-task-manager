import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MINIMAX_MODEL,
  MINIMAX_MODELS,
  miniMaxModelSchema,
  loadMiniMaxModel,
  saveMiniMaxModel,
} from '../../app/services/minimax-model'

describe('MiniMax model selection', () => {
  it('offers the official text model allowlist with a safe default', () => {
    expect(MINIMAX_MODELS[0]).toEqual({
      id: 'MiniMax-M3.1-Flash',
      label: 'M3.1 Flash',
      description: '支持图片分析、百万上下文与任务规划',
    })
    expect(DEFAULT_MINIMAX_MODEL).toBe('MiniMax-M3')
    expect(MINIMAX_MODELS.map(option => option.id)).toContain('MiniMax-M2.7-highspeed')
    expect(MINIMAX_MODELS.map(option => option.id)).toContain('MiniMax-M2.5')
    expect(MINIMAX_MODELS.map(option => option.id)).not.toContain('MiniMax-M3-highspeed')
  })

  it('accepts and persists the exact M3.1 Flash API identifier without inventing variants', () => {
    localStorage.clear()
    const model = miniMaxModelSchema.parse('MiniMax-M3.1-Flash')
    saveMiniMaxModel(model)
    expect(loadMiniMaxModel()).toBe('MiniMax-M3.1-Flash')
    expect(miniMaxModelSchema.safeParse('MiniMax-M3.1').success).toBe(false)
    expect(miniMaxModelSchema.safeParse('MiniMax-M3.1-Flash-highspeed').success).toBe(false)
  })

  it('persists only allowlisted model identifiers', () => {
    localStorage.clear()
    saveMiniMaxModel('MiniMax-M2.5')
    expect(loadMiniMaxModel()).toBe('MiniMax-M2.5')
    localStorage.setItem('personal-ai-minimax-model:v1', 'arbitrary-model')
    expect(loadMiniMaxModel()).toBe(DEFAULT_MINIMAX_MODEL)
  })
})
