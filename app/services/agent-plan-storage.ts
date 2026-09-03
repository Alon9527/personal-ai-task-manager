import { agentPlanDraftSchema } from './agent-plan-schema'
import type { AgentPlanDraftV1 } from './agent-plan-schema'

export const AGENT_PLAN_STORAGE_KEY = 'personal-ai-agent-plan:v1'
export const AGENT_PLAN_RECOVERY_STORAGE_KEY = 'personal-ai-agent-plan:recovery:v1'

export type AgentPlanStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface AgentPlanStorage {
  load(): AgentPlanDraftV1 | null
  save(draft: unknown): void
  clear(): void
}

export class AgentPlanStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AgentPlanStorageError'
  }
}

export function createAgentPlanStorage(storage: AgentPlanStorageLike): AgentPlanStorage {
  function clear() {
    try {
      storage.removeItem(AGENT_PLAN_STORAGE_KEY)
    }
    catch (cause) {
      throw new AgentPlanStorageError('无法清除 Agent 计划草稿', { cause })
    }
  }

  function quarantine(raw: string) {
    try {
      storage.setItem(AGENT_PLAN_RECOVERY_STORAGE_KEY, raw)
      storage.removeItem(AGENT_PLAN_STORAGE_KEY)
    }
    catch (cause) {
      throw new AgentPlanStorageError('Agent 计划草稿已损坏，但无法安全隔离原始数据', { cause })
    }
  }

  return {
    load() {
      let raw: string | null
      try {
        raw = storage.getItem(AGENT_PLAN_STORAGE_KEY)
      }
      catch (cause) {
        throw new AgentPlanStorageError('无法读取 Agent 计划草稿', { cause })
      }
      if (raw === null) return null

      let parsed: AgentPlanDraftV1
      try {
        parsed = agentPlanDraftSchema.parse(JSON.parse(raw))
      }
      catch {
        quarantine(raw)
        return null
      }

      if (parsed.status === 'applied') {
        clear()
        return null
      }
      return parsed
    },

    save(draft: unknown) {
      let parsed: AgentPlanDraftV1
      try {
        parsed = agentPlanDraftSchema.parse(draft)
      }
      catch (cause) {
        throw new AgentPlanStorageError('Agent 计划草稿格式无效', { cause })
      }

      try {
        storage.setItem(AGENT_PLAN_STORAGE_KEY, JSON.stringify(parsed))
      }
      catch (cause) {
        throw new AgentPlanStorageError('无法保存 Agent 计划草稿', { cause })
      }

      if (parsed.status === 'applied') clear()
    },

    clear,
  }
}
