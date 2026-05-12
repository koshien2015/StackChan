import 'dotenv/config'
import { startServer } from './server.js'
import { startHttpServer } from './http-server.js'
import { initMemoryCollection } from './memory.js'
import { deviceRegistry } from './device-context.js'
import { SpeechPolicy } from './speech-policy.js'
import { SpeechService } from './speech-service.js'
import { AgentOrchestrator } from './orchestrator.js'
import { Scheduler } from './scheduler.js'

const PORT = Number(process.env.PORT ?? '8765')
const HTTP_PORT = Number(process.env.HTTP_PORT ?? '3000')

if (!process.env.OPENAI_API_KEY) {
    console.error('[error] OPENAI_API_KEY is not set')
    process.exit(1)
}

const policy = new SpeechPolicy()
const speechService = new SpeechService()
const orchestrator = new AgentOrchestrator(deviceRegistry, policy, speechService)
const scheduler = new Scheduler()

initMemoryCollection().then(() => {
    startServer(PORT)
    startHttpServer(HTTP_PORT)
    scheduler.start(orchestrator, deviceRegistry)
})
