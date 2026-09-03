import { describe, expect, it } from 'vitest'
import {
  createFeishuLinkStore,
  normalizeFeishuUrl,
} from '../../app/services/feishu-links'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('Feishu links', () => {
  it('accepts Feishu and Lark HTTPS links and rejects lookalike domains', () => {
    expect(normalizeFeishuUrl('https://acme.feishu.cn/base/abc')).toBe('https://acme.feishu.cn/base/abc')
    expect(normalizeFeishuUrl('https://acme.larksuite.com/base/abc')).toBe('https://acme.larksuite.com/base/abc')
    expect(() => normalizeFeishuUrl('http://acme.feishu.cn/base/abc')).toThrow('HTTPS')
    expect(() => normalizeFeishuUrl('https://feishu.cn.evil.example/base/abc')).toThrow('飞书')
    expect(() => normalizeFeishuUrl('https://user:secret@acme.feishu.cn/base/abc')).toThrow('凭据')
  })

  it('persists multiple links without storing duplicates', () => {
    const storage = memoryStorage()
    let sequence = 0
    const store = createFeishuLinkStore(storage, {
      now: () => '2026-09-02T08:00:00.000Z',
      createId: () => `link-${++sequence}`,
    })

    const first = store.add({ label: '项目排期', url: 'https://acme.feishu.cn/base/abc' })
    const second = store.add({ label: '内容日历', url: 'https://acme.feishu.cn/base/xyz' })

    expect(first.id).toBe('link-1')
    expect(store.list()).toEqual([first, second])
    expect(() => store.add({ label: '重复', url: first.url })).toThrow('已存在')

    const reloaded = createFeishuLinkStore(storage)
    expect(reloaded.list()).toHaveLength(2)
    reloaded.remove(first.id)
    expect(reloaded.list().map(item => item.label)).toEqual(['内容日历'])
  })
})
