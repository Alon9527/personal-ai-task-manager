import { onBeforeUnmount, onMounted } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { dueTaskReminders } from '../utils/task-reminders'

const REMINDER_POLL_MS = 30_000

export function useTaskReminders() {
  const workspace = useWorkspace()
  let timer: ReturnType<typeof setInterval> | null = null
  let checking = false

  async function check() {
    if (checking || !isTauri()) return
    checking = true
    try {
      const remindedAt = new Date().toISOString()
      for (const task of dueTaskReminders(workspace.tasks.value, new Date())) {
        await invoke('show_task_notification', {
          taskId: task.id,
          title: task.title,
          body: task.dueTime ? `计划时间 ${task.dueTime}，打开 Focus AI 可完成或延后。` : '待办提醒，打开 Focus AI 可完成或延后。',
        })
        await workspace.updateTask(task.id, { lastRemindedAt: remindedAt })
      }
    }
    catch {
      // Keep the reminder pending so the next polling cycle can retry it.
    }
    finally {
      checking = false
    }
  }

  onMounted(() => {
    if (!isTauri()) return
    void check()
    timer = setInterval(() => void check(), REMINDER_POLL_MS)
  })

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
  })

  return { check }
}
