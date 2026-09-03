import { z } from 'zod'
import {
  DEFAULT_MINIMAX_MODEL,
  MINIMAX_MODELS,
  MINIMAX_MODEL_STORAGE_KEY,
  isMiniMaxModel,
  miniMaxModelSchema,
} from './minimax-model'
import type { MiniMaxModel } from './minimax-model'
import type { ModelProviderProfile } from './model-provider'

export const AI_MODEL_SELECTION_KEY = 'personal-ai-model-selection:v2'

export const aiModelTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('minimax'),
    modelId: miniMaxModelSchema,
  }).strict(),
  z.object({
    kind: z.literal('custom'),
    profileId: z.string().uuid(),
  }).strict(),
])

export type AiModelTarget = z.infer<typeof aiModelTargetSchema>

export const DEFAULT_AI_MODEL_TARGET: AiModelTarget = {
  kind: 'minimax',
  modelId: DEFAULT_MINIMAX_MODEL,
}

export type AiModelTargetInfo = {
  label: string
  modelId: string
  description: string
  ready: boolean
  profile: ModelProviderProfile | null
}

export function builtInTargetInfo(modelId: MiniMaxModel): AiModelTargetInfo {
  const option = MINIMAX_MODELS.find(candidate => candidate.id === modelId) ?? MINIMAX_MODELS[0]!
  return {
    label: `MiniMax ${option.label}`,
    modelId: option.id,
    description: option.description,
    ready: false,
    profile: null,
  }
}

export function customTargetInfo(
  profileId: string,
  providers: readonly ModelProviderProfile[],
): AiModelTargetInfo {
  const profile = providers.find(candidate => candidate.id === profileId) ?? null
  return {
    label: profile?.name ?? '自定义模型不可用',
    modelId: profile?.modelId ?? '',
    description: profile
      ? `${profile.modelId} · ${profile.isLocal ? '本机服务' : '自定义 API'}`
      : '所选模型 API 已不存在',
    ready: Boolean(profile && (profile.isLocal || profile.hasCredential)),
    profile,
  }
}

type AiModelTargetStorage = Pick<Storage, 'getItem' | 'setItem'>

export function saveAiModelTarget(
  target: unknown,
  storage: Pick<Storage, 'setItem'> = localStorage,
): AiModelTarget {
  const parsed = aiModelTargetSchema.parse(target)
  storage.setItem(AI_MODEL_SELECTION_KEY, JSON.stringify(parsed))
  return parsed
}

export function loadAiModelTarget(storage: AiModelTargetStorage = localStorage): AiModelTarget {
  const storedTarget = storage.getItem(AI_MODEL_SELECTION_KEY)
  if (storedTarget !== null) {
    try {
      const parsed = aiModelTargetSchema.safeParse(JSON.parse(storedTarget))
      if (parsed.success) return parsed.data
    }
    catch {
      // Invalid persisted JSON is replaced by the safe default below.
    }

    return saveAiModelTarget(DEFAULT_AI_MODEL_TARGET, storage)
  }

  const legacyModel = storage.getItem(MINIMAX_MODEL_STORAGE_KEY)
  if (isMiniMaxModel(legacyModel)) {
    return saveAiModelTarget({ kind: 'minimax', modelId: legacyModel }, storage)
  }

  return saveAiModelTarget(DEFAULT_AI_MODEL_TARGET, storage)
}
