import { useWorkspace } from './useWorkspace'
import { useAgentPlan } from './useAgentPlan'
import { createAgentConversation } from '../services/agent-conversation'
import { createAgentChat } from '../services/agent-chat'
import { createAiGeneration } from '../services/ai-generation'
import { getMiniMaxStatus } from '../services/minimax'
import { listModelProviders } from '../services/model-provider'

const controllers = new WeakMap<object, ReturnType<typeof createAgentChat>>()
export function useAgentConversation() {
  const workspace = useWorkspace()
  let chat = controllers.get(workspace)
  if (chat) return chat
  const readDocument = async () => {
    if (!workspace.ready.value) await workspace.load()
    return workspace.readLatestDocument()
  }
  const generation = createAiGeneration(readDocument)
  // Access is deferred so disabled local storage produces a visible warning.
  const disk = import.meta.client ? { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => localStorage.setItem(key, value) } : undefined
  chat = createAgentChat({ log: createAgentConversation(disk), plan: useAgentPlan(), readDocument, ask: generation.ask, invalidate: generation.invalidate,
    connectionGuard(key) {
      const values = JSON.parse(key)
      return values[0].kind === 'custom'
        ? { kind:'custom',baseUrl:values[1],modelId:values[2],credentialGeneration:values[3],updatedAt:values[4] }
        : { kind:'minimax',region:values[1],revision:values[3] }
    },
    async fingerprint(target) {
      if (target.kind === 'custom') {
        const profile = (await listModelProviders()).profiles.find(p => p.id === target.profileId)
        if (!profile) throw new Error('所选模型配置已不存在，请重新选择。')
        return JSON.stringify([target, profile.baseUrl, profile.modelId, profile.credentialGeneration, profile.updatedAt])
      }
      const status = await getMiniMaxStatus()
      return JSON.stringify([target, status.region, status.configured, status.connectionRevision ?? null])
    },
  })
  controllers.set(workspace, chat)
  return chat
}
