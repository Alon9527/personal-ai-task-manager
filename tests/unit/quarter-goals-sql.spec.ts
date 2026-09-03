import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('quarter goals SQL contract', () => {
  it('defines a constrained soft-deletable table with RLS and an owner-scoped reorder RPC', async () => {
    const sql = (await readFile(
      'supabase/migrations/202607290001_quarter_goals.sql',
      'utf8',
    )).toLowerCase()

    expect(sql).toContain('create table if not exists public.quarter_goals')
    expect(sql).toContain("quarter ~ '^\\d{4}-q[1-4]$'")
    expect(sql).toContain('progress between 0 and 100')
    expect(sql).toContain("status in ('active', 'completed', 'paused')")
    expect(sql).toContain('quarter_goals_owner_quarter_active_idx')
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('reorder_quarter_goals')
    expect(sql).toContain('cardinality(p_ordered_ids)')
    expect(sql).toContain('quarter goal order contains inaccessible ids')
    expect(sql).toContain('grant execute on function public.reorder_quarter_goals')
  })

  it('seeds exactly three fixed demo goals idempotently', async () => {
    const sql = (await readFile('supabase/seed.sql', 'utf8')).toLowerCase()
    const ids = sql.match(/30000000-0000-4000-8000-00000000000[1-3]/g) ?? []

    expect(sql).toContain('insert into public.quarter_goals')
    expect(ids).toHaveLength(3)
    expect(sql).toContain('on conflict (id) do update')
    expect(sql).toContain('deleted_at = null')
  })
})
