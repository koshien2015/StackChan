import { randomUUID } from 'crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { Session } from './session.js'
import { deviceRegistry } from './device-context.js'

export function startServer(port: number): void {
    const wss = new WebSocketServer({ port })

    wss.on('listening', () => {
        console.log(`[server] WebSocket server listening on ws://0.0.0.0:${port}/ws`)
    })

    wss.on('connection', (ws: WebSocket, req) => {
        const ip = req.socket.remoteAddress ?? 'unknown'
        const deviceId = randomUUID()
        console.log(`[server] connected: ${ip} deviceId=${deviceId}`)

        const session = new Session(ws)
        const context = deviceRegistry.register(deviceId, session)

        session.onUserSpoke = () => {
            context.lastHeardAt = Date.now()
        }

        ws.on('message', (data: Buffer | string) => {
            session.handleMessage(data)
        })

        ws.on('close', () => {
            deviceRegistry.unregister(deviceId)
            console.log(`[server] disconnected: ${ip} deviceId=${deviceId}`)
        })

        ws.on('error', (err) => {
            console.error(`[server] error from ${ip}:`, err.message)
        })
    })
}
