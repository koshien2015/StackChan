import type { DeviceContext } from './device-context.js'

const MIN_SPEAK_INTERVAL_MS = 2 * 60 * 1000  // 2分間隔

export class SpeechPolicy {
  canSpeak(device: DeviceContext): boolean {
    const now = Date.now()

    if (device.runtimeState === 'sleep') return false
    if (device.runtimeState === 'speaking') return false
    if (device.cooldownUntil !== null && now < device.cooldownUntil) return false
    if (device.lastSpokeAt !== null && now - device.lastSpokeAt < MIN_SPEAK_INTERVAL_MS) return false

    const transportState = device.session.getTransportState()
    if (transportState === 'listening' || transportState === 'processing') return false

    return true
  }
}
