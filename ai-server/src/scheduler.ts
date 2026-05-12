import type { AgentOrchestrator } from './orchestrator.js'
import type { DeviceRegistry } from './device-context.js'

const TICK_INTERVAL_MS = 60_000
const CHECKIN_SILENCE_MS = 60 * 60 * 1000  // 1時間

interface SchedulerJob {
  id: string
  run(now: Date, orchestrator: AgentOrchestrator, registry: DeviceRegistry): Promise<void>
}

class MorningGreetingJob implements SchedulerJob {
  readonly id = 'morning-greeting'
  private lastFiredDate: string | null = null

  async run(now: Date, orchestrator: AgentOrchestrator): Promise<void> {
    const hour = now.getHours()
    if (hour < 7 || hour >= 9) return

    const today = now.toDateString()
    if (this.lastFiredDate === today) return
    this.lastFiredDate = today

    console.log('[scheduler] morning-greeting firing')
    await orchestrator.maybeSpeakAll('greeting')
  }
}

class CheckinJob implements SchedulerJob {
  readonly id = 'checkin'

  async run(now: Date, orchestrator: AgentOrchestrator, registry: DeviceRegistry): Promise<void> {
    const nowMs = now.getTime()
    for (const device of registry.getAll()) {
      const lastActivity = Math.max(
        device.lastHeardAt ?? 0,
        device.lastSpokeAt ?? 0,
      )
      if (lastActivity === 0) continue
      if (nowMs - lastActivity < CHECKIN_SILENCE_MS) continue

      console.log(`[scheduler] checkin firing device=${device.deviceId}`)
      await orchestrator.maybeSpeak(device.deviceId, 'checkin').catch(err =>
        console.error('[scheduler] checkin error:', err)
      )
    }
  }
}

export class Scheduler {
  private readonly jobs: SchedulerJob[] = [
    new MorningGreetingJob(),
    new CheckinJob(),
  ]
  private interval?: ReturnType<typeof setInterval>

  start(orchestrator: AgentOrchestrator, registry: DeviceRegistry): void {
    this.interval = setInterval(() => {
      const now = new Date()
      for (const job of this.jobs) {
        job.run(now, orchestrator, registry).catch(err =>
          console.error(`[scheduler] job ${job.id} error:`, err)
        )
      }
    }, TICK_INTERVAL_MS)
    console.log(`[scheduler] started (tick=${TICK_INTERVAL_MS / 1000}s)`)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
  }
}
