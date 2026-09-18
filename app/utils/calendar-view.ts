import type { Task } from '#shared/workspace'
export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function weekDays(anchor: Date) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return { date: d, key: dateKey(d) } })
}
export function calendarEvents(tasks: Task[], day: string) {
  const events = tasks.filter(t => t.dueDate === day && t.dueTime && !t.deletedAt && t.status !== 'cancelled')
    .map(task => { const [h, m] = task.dueTime!.split(':').map(Number); const start = h! * 60 + m!; return { task, start, end: Math.min(1440, start + (task.estimatedMinutes ?? 30)), lane: 0, lanes: 1 } })
    .sort((a, b) => a.start - b.start || a.end - b.end)
  let group: typeof events = []
  let groupEnd = -1
  const flush = () => { const count = Math.max(1, ...group.map(e => e.lane + 1)); group.forEach(e => e.lanes = count); group = [] }
  for (const event of events) {
    if (event.start >= groupEnd) { flush(); groupEnd = -1 }
    const busy = new Set(group.filter(e => e.end > event.start).map(e => e.lane))
    while (busy.has(event.lane)) event.lane++
    group.push(event); groupEnd = Math.max(groupEnd, event.end)
  }
  flush(); return events
}
