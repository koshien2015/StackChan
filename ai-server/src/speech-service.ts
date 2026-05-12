import { synthesize } from './tts.js'
import { encodeWavToOpusFrames } from './audio.js'
import type { DeviceContext } from './device-context.js'

const POST_TTS_COOLDOWN_MS = 3000

export class SpeechService {
  async speakToDevice(device: DeviceContext, text: string): Promise<void> {
    device.runtimeState = 'speaking'
    try {
      const wav = await synthesize(text)
      const opusFrames = encodeWavToOpusFrames(wav)
      await device.session.sendTtsAudio(opusFrames, text)
      device.lastSpokeAt = Date.now()
      device.cooldownUntil = Date.now() + POST_TTS_COOLDOWN_MS
      device.runtimeState = 'cooldown'
    } catch (err) {
      console.error('[speech-service] speakToDevice failed:', err)
      device.runtimeState = 'idle'
    }
  }
}
