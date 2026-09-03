begin;

insert into public.projects (id, owner_id, name, color, sort_order, created_at, updated_at, deleted_at)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '收集箱', '#9297A1', 0, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '个人效率系统', '#8B7CF6', 1, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '产品灵感库', '#4DB6AC', 2, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '健康与生活', '#F4A261', 3, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null)
on conflict (id) do update set
  owner_id = excluded.owner_id,
  name = excluded.name,
  color = excluded.color,
  sort_order = excluded.sort_order,
  deleted_at = null;

insert into public.tasks (
  id, owner_id, project_id, title, description, priority, due_date, due_time,
  is_focus, sort_order, completed_at, created_at, updated_at, deleted_at
)
values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '完成个人工作台首页的信息架构', '', 'high', '2026-07-22', '10:30', true, 0, null, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '整理 MiniMax API 接入方案', '', null, '2026-07-22', '14:00', true, 1, null, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '把季度目标拆成可追踪的关键结果', '', 'medium', '2026-07-22', null, true, 2, null, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '整理竞品界面截图', '', null, '2026-07-22', null, false, 0, null, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('20000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', '30 分钟力量训练', '', null, '2026-07-22', '18:30', false, 1, null, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('20000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '确认 MVP 功能范围', '', null, '2026-07-22', null, true, 0, '2026-07-22T01:30:00Z', '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('20000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '选择 MiniMax 作为首个 AI 模型', '', null, '2026-07-22', null, true, 1, '2026-07-22T02:00:00Z', '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null)
on conflict (id) do update set
  owner_id = excluded.owner_id,
  project_id = excluded.project_id,
  title = excluded.title,
  description = excluded.description,
  priority = excluded.priority,
  due_date = excluded.due_date,
  due_time = excluded.due_time,
  is_focus = excluded.is_focus,
  sort_order = excluded.sort_order,
  completed_at = excluded.completed_at,
  deleted_at = null;

insert into public.quarter_goals (id, owner_id, quarter, title, description, progress, status, sort_order, created_at, updated_at, deleted_at)
values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '2026-Q3', '完成个人效率系统 1.0', '让任务、项目与复盘形成稳定闭环', 72, 'active', 0, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '2026-Q3', '建立每周复盘习惯', '连续执行并沉淀一套固定复盘模板', 68, 'active', 1, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '2026-Q3', '恢复稳定训练节奏', '每周完成三次力量或有氧训练', 64, 'active', 2, '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z', null)
on conflict (id) do update set
  owner_id = excluded.owner_id,
  quarter = excluded.quarter,
  title = excluded.title,
  description = excluded.description,
  progress = excluded.progress,
  status = excluded.status,
  sort_order = excluded.sort_order,
  deleted_at = null;

commit;
