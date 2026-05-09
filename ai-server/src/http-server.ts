import express from 'express'
import multer from 'multer'
import { join } from 'path'
import { retrieveMemories, storeMemory, storeDocument, listMemories, formatMemoryContext } from './memory.js'
import { chat, type Message } from './llm.js'

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ??
    'あなたはStackChanという小さなロボットです。明るく元気に日本語で話します。'

const ACCEPTED_MIME_TYPES = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'application/json',
    'text/html', 'text/xml', 'application/xml',
])

export function startHttpServer(port: number): void {
    const app = express()
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
    })

    app.use(express.json())
    app.use(express.static(join(__dirname, '../public')))

    app.get('/api/status', (_req, res) => {
        res.json({
            status: 'ok',
            qdrant: !!process.env.QDRANT_URL,
            model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        })
    })

    app.post('/api/chat', async (req, res) => {
        try {
            const { message, history = [] } = req.body as { message: string; history: Message[] }
            if (!message?.trim()) {
                res.status(400).json({ error: 'message is required' })
                return
            }

            const memories = await retrieveMemories(message)

            const baseMessages: Message[] = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...history,
                { role: 'user', content: message },
            ]

            let llmMessages = baseMessages
            if (memories.length > 0) {
                llmMessages = [
                    baseMessages[0],
                    { role: 'system', content: `【関連する過去の会話・資料】\n${formatMemoryContext(memories)}` },
                    ...baseMessages.slice(1),
                ]
            }

            const reply = await chat(llmMessages)

            // 会話を非同期で保存
            storeMemory(message, reply)

            res.json({ reply, memoriesUsed: memories.length })
        } catch (err) {
            console.error('[http] /api/chat error:', err)
            res.status(500).json({ error: 'Internal server error' })
        }
    })

    // SSEで進捗をストリーミングしながらファイルをアップロード
    app.post('/api/upload', upload.single('file'), async (req, res) => {
        try {
            if (!req.file) {
                res.status(400).json({ error: 'no file provided' })
                return
            }

            const mimeType = req.file.mimetype.split(';')[0].trim()
            if (!ACCEPTED_MIME_TYPES.has(mimeType) && !req.file.originalname.match(/\.(txt|md|csv|json)$/i)) {
                res.status(415).json({ error: `Unsupported file type: ${mimeType}` })
                return
            }

            const text = req.file.buffer.toString('utf-8')
            if (!text.trim()) {
                res.status(400).json({ error: 'file is empty' })
                return
            }

            // SSEで進捗を返す
            res.setHeader('Content-Type', 'text/event-stream')
            res.setHeader('Cache-Control', 'no-cache')
            res.setHeader('Connection', 'keep-alive')

            const sendEvent = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)

            sendEvent({ type: 'start', filename: req.file.originalname })

            const chunks = await storeDocument(text, req.file.originalname, (current, total) => {
                sendEvent({ type: 'progress', current, total })
            })

            sendEvent({ type: 'done', filename: req.file.originalname, chunks })
            res.end()
        } catch (err) {
            console.error('[http] /api/upload error:', err)
            if (!res.headersSent) {
                res.status(500).json({ error: String(err) })
            } else {
                res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`)
                res.end()
            }
        }
    })

    app.get('/api/memories', async (_req, res) => {
        try {
            const memories = await listMemories()
            res.json(memories)
        } catch {
            res.json([])
        }
    })

    app.listen(port, () => {
        console.log(`[http] UI available at http://localhost:${port}`)
    })
}
