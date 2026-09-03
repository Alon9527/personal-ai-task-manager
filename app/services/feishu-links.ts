import { invoke, isTauri } from '@tauri-apps/api/core'

const STORAGE_KEY = 'focus-ai.feishu-links.v1'
const MAX_LINKS = 20

export interface FeishuLink {
  id: string
  label: string
  url: string
  createdAt: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

interface StoreOptions {
  now?: () => string
  createId?: () => string
}

export function normalizeFeishuUrl(value: string) {
  const input = value.trim()
  if (input.length > 2_048) throw new Error('链接过长')
  let url: URL
  try {
    url = new URL(input)
  }
  catch {
    throw new Error('请输入有效的飞书链接')
  }
  if (url.protocol !== 'https:') throw new Error('飞书链接必须使用 HTTPS')
  if (url.username || url.password) throw new Error('链接中不能包含账号凭据')
  const hostname = url.hostname.toLocaleLowerCase()
  const allowed = ['feishu.cn', 'larksuite.com'].some(
    domain => hostname === domain || hostname.endsWith(`.${domain}`),
  )
  if (!allowed) throw new Error('仅允许飞书或 Lark 域名')
  url.hash = ''
  return url.toString()
}

export function createFeishuLinkStore(
  storage: StorageLike,
  options: StoreOptions = {},
) {
  const now = options.now ?? (() => new Date().toISOString())
  const createId = options.createId ?? (() => crypto.randomUUID())

  function list(): FeishuLink[] {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter(isStoredLink)
        .slice(0, MAX_LINKS)
        .map(link => ({ ...link, url: normalizeFeishuUrl(link.url) }))
    }
    catch {
      return []
    }
  }

  function persist(links: FeishuLink[]) {
    storage.setItem(STORAGE_KEY, JSON.stringify(links.slice(0, MAX_LINKS)))
  }

  function add(input: { label: string, url: string }) {
    const links = list()
    if (links.length >= MAX_LINKS) throw new Error('最多保存 20 个飞书链接')
    const label = input.label.trim()
    if (!label) throw new Error('请输入链接名称')
    if (label.length > 40) throw new Error('链接名称不能超过 40 个字符')
    const url = normalizeFeishuUrl(input.url)
    if (links.some(link => link.url === url)) throw new Error('该飞书链接已存在')
    const link: FeishuLink = { id: createId(), label, url, createdAt: now() }
    persist([...links, link])
    return link
  }

  function remove(id: string) {
    persist(list().filter(link => link.id !== id))
  }

  return { list, add, remove }
}

export async function openFeishuLink(value: string) {
  const url = normalizeFeishuUrl(value)
  if (isTauri()) {
    await invoke('open_external_url', { url })
    return
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) throw new Error('浏览器阻止了新窗口，请允许弹窗后重试')
}

function isStoredLink(value: unknown): value is FeishuLink {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<FeishuLink>
  return typeof candidate.id === 'string'
    && typeof candidate.label === 'string'
    && typeof candidate.url === 'string'
    && typeof candidate.createdAt === 'string'
}
