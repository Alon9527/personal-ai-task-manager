import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MINIMAX_MODEL,
  MINIMAX_MODELS,
  loadMiniMaxModel,
  saveMiniMaxModel,
} from '../../app/services/minimax-model'

describe('MiniMax model selection', () => {
  it('offers the official text model allowlist with a safe default', () => {
    expect(MINIMAX_MODELS[0]).toEqual({
      id: 'MiniMax-M3',
      label: 'M3',
      description: '最新旗舰 Agent 模型，支持超长上下文与复杂规划',
    })
    expect(DEFAULT_MINIMAX_MODEL).toBe('MiniMax-M3')
    expect(MINIMAX_MODELS.map(option => option.id)).toContain('MiniMax-M2.7-highspeed')
    expect(MINIMAX_MODELS.map(option => option.id)).toContain('MiniMax-M2.5')
    expect(MINIMAX_MODELS.map(option => option.id)).not.toContain('MiniMax-M3-highspeed')
  })

  it('persists only allowlisted model identifiers', () => {
    localStorage.clear()
    saveMiniMaxModel('MiniMax-M2.5')
    expect(loadMiniMaxModel()).toBe('MiniMax-M2.5')
    localStorage.setItem('personal-ai-minimax-model:v1', 'arbitrary-model')
    expect(loadMiniMaxModel()).toBe(DEFAULT_MINIMAX_MODEL)
  })
})
