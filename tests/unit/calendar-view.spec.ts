// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { weekDays, calendarEvents } from '../../app/utils/calendar-view'
import type { Task } from '../../shared/workspace'
describe('calendar layout', () => {
  it('starts on Monday across month and year boundaries', () => {
    expect(weekDays(new Date(2027, 0, 1)).map(d => d.key)).toEqual(['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03'])
  })
  it('separates overlapping tasks and clips at midnight', () => {
    const make = (dueTime: string, estimatedMinutes: number) => ({ dueDate:'2026-09-15', dueTime, estimatedMinutes, deletedAt:null, status:'todo' } as Task)
    const events = calendarEvents([make('09:00',60),make('09:30',60),make('23:30',90)], '2026-09-15')
    expect(events.map(e => [e.lane,e.lanes])).toEqual([[0,2],[1,2],[0,1]])
    expect(events[2]?.end).toBe(1440)
  })
})
