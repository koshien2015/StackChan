import type { Session } from './session.js'

export type AgentRuntimeState = 'idle' | 'speaking' | 'cooldown' | 'sleep'

export type SpontaneousSpeechType =
  | 'greeting'
  | 'weather'
  | 'schedule'
  | 'checkin'
  | 'smalltalk'
  | 'reaction'
  | 'memory_based'

export type DeviceContext = {
  deviceId: string
  session: Session
  runtimeState: AgentRuntimeState
  cooldownUntil: number | null
  lastSpokeAt: number | null
  lastHeardAt: number | null
}

export class DeviceRegistry {
  private readonly devices = new Map<string, DeviceContext>()

  register(deviceId: string, session: Session): DeviceContext {
    const context: DeviceContext = {
      deviceId,
      session,
      runtimeState: 'idle',
      cooldownUntil: null,
      lastSpokeAt: null,
      lastHeardAt: null,
    }
    this.devices.set(deviceId, context)
    console.log(`[registry] registered device: ${deviceId}`)
    return context
  }

  unregister(deviceId: string): void {
    this.devices.delete(deviceId)
    console.log(`[registry] unregistered device: ${deviceId}`)
  }

  get(deviceId: string): DeviceContext | undefined {
    return this.devices.get(deviceId)
  }

  getAll(): DeviceContext[] {
    return [...this.devices.values()]
  }
}

export const deviceRegistry = new DeviceRegistry()
