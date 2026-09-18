import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'
import type { WorkspaceDocument } from '#shared/workspace'
import type { CreateTaskInput } from '../data/workspace-gateway'
import { agentPlanDraftSchema } from './agent-plan-schema'
import type { AgentAction } from './agent-plan-schema'
import { aiModelTargetSchema } from './ai-model-target'
import type { AiModelTarget } from './ai-model-target'
import { DEFAULT_MINIMAX_MODEL } from './minimax-model'
import type { MiniMaxModel } from './minimax-model'

export const MINIMAX_MODEL = DEFAULT_MINIMAX_MODEL
export const MINIMAX_CONTEXT_TASK_LIMIT = 80
export const MINIMAX_CONTEXT_MILESTONE_LIMIT = 80

export type MiniMaxPriority = 'low' | 'medium' | 'high'
export type MiniMaxRegion = 'cn' | 'global'

export interface MiniMaxContextProject {
  id: string
  name: string
  description: string
  color: string
  priority: MiniMaxPriority | null
  status: 'planned' | 'active' | 'paused' | 'completed'
  targetDate: string | null
  updatedAt: string
}

export interface MiniMaxContextMilestone {
  id: string
  projectId: string
  title: string
  description: string
  targetDate: string | null
  status: 'planned' | 'in_progress' | 'blocked' | 'completed'
  progressMode: 'auto' | 'manual'
  progress: number
  updatedAt: string
}

export interface MiniMaxContextTask {
  id: string
  projectId: string | null
  milestoneId: string | null
  projectName: string | null
  title: string
  description: string
  priority: MiniMaxPriority | null
  dueDate: string | null
  dueTime: string | null
  isFocus: boolean
  completed: boolean
  updatedAt: string
}

export interface MiniMaxContextGoal {
  id: string
  quarter: string
  title: string
  description: string
  progress: number
  status: 'active' | 'completed' | 'paused'
}

export interface MiniMaxWorkspaceContext {
  generatedAt: string
  projects: MiniMaxContextProject[]
  milestones: MiniMaxContextMilestone[]
  tasks: MiniMaxContextTask[]
  quarterGoals: MiniMaxContextGoal[]
}

export interface MiniMaxStatus {
  available: boolean
  configured: boolean
  model: string
  credentialStore: 'windows-credential-manager' | 'unsupported'
  region: MiniMaxRegion | null
}

export interface MiniMaxUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface MiniMaxSource {
  taskId: string
  title: string
  projectName: string | null
}

export interface MiniMaxProgressItem {
  kind: 'done' | 'progress' | 'warning'
  text: string
}

export interface MiniMaxSuggestion {
  rationale: string
  title: string
  description: string
  projectId: string | null
  priority: MiniMaxPriority | null
  dueDate: string | null
  dueTime: string | null
  isFocus: boolean
}

export interface MiniMaxBrief {
  focus: string
  progress: MiniMaxProgressItem[]
  suggestion: MiniMaxSuggestion | null
  sources: MiniMaxSource[]
  model: string
  generatedAt: string
  usage: MiniMaxUsage | null
}

export type MiniMaxAgentAction = AgentAction

export interface MiniMaxAnswer {
  answer: string
  actions: MiniMaxAgentAction[]
  sources: MiniMaxSource[]
  model: string
  generatedAt: string
  usage: MiniMaxUsage | null
}

export function buildMiniMaxWorkspaceContext(
  document: WorkspaceDocument,
  generatedAt = new Date().toISOString(),
): MiniMaxWorkspaceContext {
  const projects = document.projects
    .filter(project => project.deletedAt === null)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .slice(0, 50)
    .map(project => ({
      id: project.id,
      name: clip(project.name, 80),
      description: clip(project.description, 1200),
      color: project.color,
      priority: project.priority,
      status: project.status,
      targetDate: project.targetDate,
      updatedAt: project.updatedAt,
    }))
  const projectNames = new Map(projects.map(project => [project.id, project.name]))
  const milestones = document.milestones
    .filter(milestone => milestone.deletedAt === null)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .slice(0, MINIMAX_CONTEXT_MILESTONE_LIMIT)
    .map(milestone => ({
      id: milestone.id,
      projectId: milestone.projectId,
      title: clip(milestone.title, 160),
      description: clip(milestone.description, 1200),
      targetDate: milestone.targetDate,
      status: milestone.status,
      progressMode: milestone.progressMode,
      progress: milestone.progress,
      updatedAt: milestone.updatedAt,
    }))
  const tasks = document.tasks
    .filter(task => task.deletedAt === null)
    .sort((left, right) => taskRank(left) - taskRank(right) || left.sortOrder - right.sortOrder)
    .slice(0, MINIMAX_CONTEXT_TASK_LIMIT)
    .map(task => ({
      id: task.id,
      projectId: task.projectId,
      milestoneId: task.milestoneId,
      projectName: task.projectId ? (projectNames.get(task.projectId) ?? null) : null,
      title: clip(task.title, 160),
      description: clip(task.description, 1200),
      priority: task.priority,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      isFocus: task.isFocus,
      completed: task.completedAt !== null,
      updatedAt: task.updatedAt,
    }))
  const quarterGoals = document.quarterGoals
    .filter(goal => goal.deletedAt === null)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .slice(0, 20)
    .map(goal => ({
      id: goal.id,
      quarter: goal.quarter,
      title: clip(goal.title, 160),
      description: clip(goal.description, 1200),
      progress: goal.progress,
      status: goal.status,
    }))

  return { generatedAt, projects, milestones, tasks, quarterGoals }
}

const miniMaxUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
}).strict()

const miniMaxSourceSchema = z.object({
  taskId: z.string().min(1),
  title: z.string(),
  projectName: z.string().nullable(),
}).strict()

const miniMaxProgressItemSchema = z.object({
  kind: z.enum(['done', 'progress', 'warning']),
  text: z.string().min(1),
}).strict()

const miniMaxSuggestionSchema = z.object({
  rationale: z.string(),
  title: z.string().min(1),
  description: z.string(),
  projectId: z.string().nullable(),
  priority: z.enum(['low', 'medium', 'high']).nullable(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  isFocus: z.boolean(),
}).strict()

const miniMaxBriefSchema = z.object({
  focus: z.string().min(1),
  progress: z.array(miniMaxProgressItemSchema),
  suggestion: miniMaxSuggestionSchema.nullable(),
  sources: z.array(miniMaxSourceSchema),
  model: z.string().min(1),
  generatedAt: z.string().datetime(),
  usage: miniMaxUsageSchema.nullable(),
}).strict()

const miniMaxAnswerSchema = z.object({
  answer: z.string().min(1),
  actions: agentPlanDraftSchema.shape.actions,
  sources: z.array(miniMaxSourceSchema),
  model: z.string().min(1),
  generatedAt: z.string().datetime(),
  usage: miniMaxUsageSchema.nullable(),
}).strict()

export function parseMiniMaxAgentActions(input: unknown): MiniMaxAgentAction[] {
  return agentPlanDraftSchema.shape.actions.parse(input)
}

export function suggestionToTaskInput(
  suggestion: MiniMaxSuggestion,
  validProjectIds: ReadonlySet<string>,
): CreateTaskInput {
  return {
    title: clip(suggestion.title.trim(), 160),
    description: clip(suggestion.description.trim(), 4000),
    projectId: suggestion.projectId && validProjectIds.has(suggestion.projectId)
      ? suggestion.projectId
      : null,
    milestoneId: null,
    priority: suggestion.priority,
    dueDate: suggestion.dueDate,
    dueTime: suggestion.dueTime,
    isFocus: suggestion.isFocus,
  }
}

export function isMiniMaxDesktop() {
  return import.meta.client && isTauri()
}

export async function getMiniMaxStatus(): Promise<MiniMaxStatus> {
  if (!isMiniMaxDesktop()) return unsupportedStatus()
  return invoke<MiniMaxStatus>('minimax_get_status')
}

export async function saveMiniMaxApiKey(
  apiKey: string,
  region: MiniMaxRegion,
): Promise<MiniMaxStatus> {
  if (!isMiniMaxDesktop()) throw new Error('请在 Windows 桌面版中配置 MiniMax')
  const normalized = apiKey.trim()
  if (normalized.length < 16 || normalized.length > 2048) throw new Error('API Key 格式不正确')
  return invoke<MiniMaxStatus>('minimax_save_api_key', { apiKey: normalized, region })
}

export async function setMiniMaxRegion(region: MiniMaxRegion): Promise<MiniMaxStatus> {
  if (!isMiniMaxDesktop()) throw new Error('请在 Windows 桌面版中配置 MiniMax')
  return invoke<MiniMaxStatus>('minimax_set_region', { region })
}

export async function removeMiniMaxApiKey(): Promise<MiniMaxStatus> {
  if (!isMiniMaxDesktop()) throw new Error('请在 Windows 桌面版中配置 MiniMax')
  return invoke<MiniMaxStatus>('minimax_delete_api_key')
}

export async function generateMiniMaxBrief(context: MiniMaxWorkspaceContext, model: MiniMaxModel = DEFAULT_MINIMAX_MODEL): Promise<MiniMaxBrief> {
  if (!isMiniMaxDesktop()) throw new Error('AI 简报仅在 Windows 桌面版中可用')
  return miniMaxBriefSchema.parse(await invoke('minimax_generate_brief', { request: { context, model } }))
}

export async function askMiniMax(
  context: MiniMaxWorkspaceContext,
  question: string,
  model: MiniMaxModel = DEFAULT_MINIMAX_MODEL,
): Promise<MiniMaxAnswer> {
  if (!isMiniMaxDesktop()) throw new Error('AI 问答仅在 Windows 桌面版中可用')
  const normalized = clip(question.trim(), 1000)
  if (!normalized) throw new Error('请输入问题')
  const response = await invoke('minimax_ask', {
    request: { context, question: normalized, model },
  })
  return miniMaxAnswerSchema.parse(response)
}

export async function generateAiBrief(
  context: MiniMaxWorkspaceContext,
  target: AiModelTarget,
): Promise<MiniMaxBrief> {
  if (!isMiniMaxDesktop()) throw new Error('AI 简报仅在 Windows 桌面版中可用')
  const trustedTarget = aiModelTargetSchema.parse(target)
  return miniMaxBriefSchema.parse(await invoke('ai_generate_brief', {
    request: { context, target: trustedTarget },
  }))
}

export async function askAi(
  context: MiniMaxWorkspaceContext,
  question: string,
  target: AiModelTarget,
  images: string[] = [],
): Promise<MiniMaxAnswer> {
  if (!isMiniMaxDesktop()) throw new Error('AI 问答仅在 Windows 桌面版中可用')
  const normalized = clip(question.trim(), 1000)
  if (!normalized) throw new Error('请输入问题')
  const trustedTarget = aiModelTargetSchema.parse(target)
  const checkedImages = z.array(z.string().max(7_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)).max(4).parse(images)
  const response = await invoke('ai_ask', {
    request: { context, question: normalized, target: trustedTarget, ...(checkedImages.length ? { images: checkedImages } : {}) },
  })
  return miniMaxAnswerSchema.parse(response)
}

function unsupportedStatus(): MiniMaxStatus {
  return {
    available: false,
    configured: false,
    model: MINIMAX_MODEL,
    credentialStore: 'unsupported',
    region: null,
  }
}

function taskRank(task: WorkspaceDocument['tasks'][number]) {
  if (task.completedAt !== null) return 2
  return task.isFocus ? 0 : 1
}

function clip(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1))}…` : value
}
