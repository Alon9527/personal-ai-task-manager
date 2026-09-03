import { beforeEach, describe, expect, it } from 'vitest'
import {
  AI_MODEL_SELECTION_KEY,
  DEFAULT_AI_MODEL_TARGET,
  aiModelTargetSchema,
  loadAiModelTarget,
  saveAiModelTarget,
} from '../../app/services/ai-model-target'
import { MINIMAX_MODEL_STORAGE_KEY } from '../../app/services/minimax-model'

describe('AI model target selection', () => {
  beforeEach(() => localStorage.clear())

  it('uses and persists MiniMax M3 when no valid selection exists', () => {
    expect(loadAiModelTarget()).toEqual({ kind: 'minimax', modelId: 'MiniMax-M3' })
    expect(DEFAULT_AI_MODEL_TARGET).toEqual({ kind: 'minimax', modelId: 'MiniMax-M3' })
    expect(JSON.parse(localStorage.getItem(AI_MODEL_SELECTION_KEY) ?? 'null')).toEqual({
      kind: 'minimax',
      modelId: 'MiniMax-M3',
    })
  })

  it('migrates a valid legacy MiniMax model without replacing it with the new default', () => {
    localStorage.setItem(MINIMAX_MODEL_STORAGE_KEY, 'MiniMax-M2.7')

    expect(loadAiModelTarget()).toEqual({ kind: 'minimax', modelId: 'MiniMax-M2.7' })
    expect(JSON.parse(localStorage.getItem(AI_MODEL_SELECTION_KEY) ?? 'null')).toEqual({
      kind: 'minimax',
      modelId: 'MiniMax-M2.7',
    })
  })

  it('does not resurrect a legacy selection when v2 data exists but is invalid', () => {
    localStorage.setItem(AI_MODEL_SELECTION_KEY, JSON.stringify({
      kind: 'minimax',
      modelId: 'MiniMax-M3',
      unexpected: true,
    }))
    localStorage.setItem(MINIMAX_MODEL_STORAGE_KEY, 'MiniMax-M2.7')

    expect(loadAiModelTarget()).toEqual(DEFAULT_AI_MODEL_TARGET)
    expect(JSON.parse(localStorage.getItem(AI_MODEL_SELECTION_KEY) ?? 'null')).toEqual(DEFAULT_AI_MODEL_TARGET)
  })

  it('replaces invalid v2 JSON with the safe default', () => {
    localStorage.setItem(AI_MODEL_SELECTION_KEY, '{bad')

    expect(loadAiModelTarget()).toEqual(DEFAULT_AI_MODEL_TARGET)
    expect(JSON.parse(localStorage.getItem(AI_MODEL_SELECTION_KEY) ?? 'null')).toEqual(DEFAULT_AI_MODEL_TARGET)
  })

  it('accepts only the strict target schema and validates before saving', () => {
    const profileId = '123e4567-e89b-42d3-a456-426614174000'
    expect(aiModelTargetSchema.parse({ kind: 'custom', profileId })).toEqual({ kind: 'custom', profileId })
    expect(() => aiModelTargetSchema.parse({ kind: 'custom', profileId, apiKey: 'secret' })).toThrow()
    expect(() => aiModelTargetSchema.parse({ kind: 'minimax', modelId: 'MiniMax-M3-highspeed' })).toThrow()
    expect(() => saveAiModelTarget({ kind: 'custom', profileId: 'not-a-uuid' })).toThrow()
    expect(localStorage.getItem(AI_MODEL_SELECTION_KEY)).toBeNull()
  })
})
