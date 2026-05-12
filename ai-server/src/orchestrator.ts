import type { DeviceRegistry, SpontaneousSpeechType } from './device-context.js'
import type { SpeechPolicy } from './speech-policy.js'
import type { SpeechService } from './speech-service.js'
import { buildUtterance } from './brain.js'

export class AgentOrchestrator {
  constructor(
    private readonly registry: DeviceRegistry,
    private readonly policy: SpeechPolicy,
    private readonly speechService: SpeechService,
  ) {}

  async maybeSpeak(deviceId: string, reason: SpontaneousSpeechType): Promise<boolean> {
    const device = this.registry.get(deviceId)
    if (!device) return false

    if (!this.policy.canSpeak(device)) {
      console.log(`[orchestrator] canSpeak=false device=${deviceId} reason=${reason}`)
      return false
    }

    const text = await buildUtterance(reason)
    if (!text) return false

    console.log(`[orchestrator] speaking to ${deviceId}: "${text}" (reason=${reason})`)
    await this.speechService.speakToDevice(device, text)
    return true
  }

  async maybeSpeakAll(reason: SpontaneousSpeechType): Promise<void> {
    const devices = this.registry.getAll()
    for (const device of devices) {
      await this.maybeSpeak(device.deviceId, reason).catch(err =>
        console.error(`[orchestrator] maybeSpeakAll error device=${device.deviceId}:`, err)
      )
    }
  }
}
