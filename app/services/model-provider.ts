import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

export const MODEL_PROVIDER_DESKTOP_ERROR = '请在 Windows 桌面版中管理模型服务商'

const strictScalarText = (maximum: number) => z.string()
  .refine(value => value === value.trim() && value.length > 0, '字段不能为空且首尾不能包含空白')
  .refine(value => [...value].length <= maximum, `字段不能超过 ${maximum} 个字符`)

const trimmedScalarText = (maximum: number) => z.string()
  .transform(value => value.trim())
  .refine(value => value.length > 0, '字段不能为空')
  .refine(value => [...value].length <= maximum, `字段不能超过 ${maximum} 个字符`)

export const modelProviderProfileSchema = z.object({
  id: z.string().uuid(),
  name: strictScalarText(40),
  baseUrl: z.string().url(),
  modelId: strictScalarText(160),
  credentialGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  hasCredential: z.boolean(),
  isLocal: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict()

export const modelProviderListSchema = z.object({
  profiles: z.array(modelProviderProfileSchema).max(20),
  pendingCredentialDeletes: z.array(z.string().uuid()).max(20),
}).strict()

const apiKeySchema = z.string().min(1).max(4096)
  .refine(value => !/[\s\0]/u.test(value), 'API Key 不能包含空白或控制字符')

const createModelProviderInputSchema = z.object({
  name: trimmedScalarText(40),
  baseUrl: z.string().transform(value => value.trim()).pipe(z.string().url()),
  modelId: trimmedScalarText(160),
  apiKey: apiKeySchema.optional(),
}).strict()

const updateModelProviderInputSchema = createModelProviderInputSchema.omit({ apiKey: true }).strict()
const providerIdSchema = z.string().uuid()

export type ModelProviderProfile = z.infer<typeof modelProviderProfileSchema>
export type ModelProviderList = z.infer<typeof modelProviderListSchema>
export type CreateModelProviderInput = z.input<typeof createModelProviderInputSchema>
export type UpdateModelProviderInput = z.input<typeof updateModelProviderInputSchema>
export type ModelProviderConnectionTest = {
  ok: boolean
  modelId: string
  latencyMs: number
}

const modelProviderConnectionTestSchema = z.object({
  ok: z.literal(true),
  modelId: strictScalarText(160),
  latencyMs: z.number().int().nonnegative(),
}).strict()

function requireDesktop() {
  if (!isTauri()) throw new Error(MODEL_PROVIDER_DESKTOP_ERROR)
}

export async function listModelProviders(): Promise<ModelProviderList> {
  requireDesktop()
  return modelProviderListSchema.parse(await invoke('model_provider_list'))
}

export async function createModelProvider(input: CreateModelProviderInput): Promise<ModelProviderProfile> {
  requireDesktop()
  const parsed = createModelProviderInputSchema.parse(input)
  const body = parsed.apiKey === undefined
    ? { name: parsed.name, baseUrl: parsed.baseUrl, modelId: parsed.modelId }
    : parsed
  return modelProviderProfileSchema.parse(await invoke('model_provider_create', { input: body }))
}

export async function updateModelProvider(id: string, input: UpdateModelProviderInput): Promise<ModelProviderProfile> {
  requireDesktop()
  return modelProviderProfileSchema.parse(await invoke('model_provider_update', {
    id: providerIdSchema.parse(id),
    input: updateModelProviderInputSchema.parse(input),
  }))
}

export async function replaceModelProviderCredential(id: string, apiKey: string): Promise<ModelProviderProfile> {
  requireDesktop()
  return modelProviderProfileSchema.parse(await invoke('model_provider_replace_api_key', {
    id: providerIdSchema.parse(id),
    apiKey: apiKeySchema.parse(apiKey),
  }))
}

export async function deleteModelProvider(id: string): Promise<ModelProviderList> {
  requireDesktop()
  return modelProviderListSchema.parse(await invoke('model_provider_delete', {
    id: providerIdSchema.parse(id),
  }))
}

export async function retryModelProviderCredentialCleanup(id: string): Promise<ModelProviderList> {
  requireDesktop()
  return modelProviderListSchema.parse(await invoke('model_provider_retry_credential_cleanup', {
    id: providerIdSchema.parse(id),
  }))
}

export async function testModelProviderConnection(id: string): Promise<ModelProviderConnectionTest> {
  requireDesktop()
  return modelProviderConnectionTestSchema.parse(await invoke('model_provider_test_connection', {
    id: providerIdSchema.parse(id),
  }))
}
