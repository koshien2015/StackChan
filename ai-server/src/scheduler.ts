import type { AgentOrchestrator } from './orchestrator.js'
import type { DeviceRegistry } from './device-context.js'
import { captureImage, detectPresence, isCameraEnabled } from './camera-tool.js'
import { storeObservation } from './memory.js'

const TICK_INTERVAL_MS = 60_000
const CHECKIN_SILENCE_MS = 60 * 60 * 1000      // 1時間
const CAMERA_OBSERVATION_TTL_SEC = 10 * 60     // 観測の有効期限: 10分
const CAMERA_TICK_EVERY = 5                    // 5tick(=5分)ごとに撮影

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

class CameraObservationJob implements SchedulerJob {
  readonly id = 'camera-observation'
  private tickCount = 0

  async run(now: Date, orchestrator: AgentOrchestrator): Promise<void> {
    this.tickCount++
    if (this.tickCount % CAMERA_TICK_EVERY !== 0) return
    if (!isCameraEnabled()) return

    try {
      const image = await captureImage()
      const presence = await detectPresence(image)

      if (presence) {
        await storeObservation('人が近くにいる（カメラで検知）', CAMERA_OBSERVATION_TTL_SEC, {
          topic: 'presence',
          source: 'camera_observation',
        })
        console.log('[scheduler] camera: presence detected, triggering reaction')
        await orchestrator.maybeSpeakAll('reaction')
      } else {
        console.log('[scheduler] camera: no presence detected')
      }
    } catch (err) {
      console.error('[scheduler] camera-observation error:', err)
    }
  }
}

export class Scheduler {
  private readonly jobs: SchedulerJob[] = [
    new MorningGreetingJob(),
    new CheckinJob(),
    new CameraObservationJob(),
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
