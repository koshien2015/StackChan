import { randomUUID } from 'crypto'
import OpenAI from 'openai'
import { QdrantClient } from '@qdrant/js-client-rest'

const COLLECTION_NAME = 'stackchan_memories'

const embeddingModel = () => process.env.EMBEDDING_MODEL ?? 'nomic-embed-text'
const vectorSize = () => Number(process.env.EMBEDDING_DIMENSIONS ?? '768')
const memoryLimit = () => Number(process.env.MEMORY_SEARCH_LIMIT ?? '5')
const scoreThreshold = () => Number(process.env.MEMORY_SCORE_THRESHOLD ?? '0.7')

let qdrantClient: QdrantClient | null = null
let openaiClient: OpenAI | null = null

// Phase A: 既存フィールドを維持しつつ新フィールドを追加

export type MemoryType = 'fact' | 'preference' | 'episode' | 'observation'
export type MemorySource = 'user_direct' | 'tool_result' | 'assistant_reply' | 'camera_observation' | 'inference' | 'legacy'
export type MemoryStatus = 'verified' | 'unverified' | 'deprecated'

export type ConversationMemory = {
    type: 'conversation'
    user: string
    assistant: string
    timestamp: string
}

export type DocumentMemory = {
    type: 'document'
    content: string    // 元のチャンクテキスト（コンテキスト注入用）
    summary: string    // LLM生成サマリー（embedding用）
    filename: string
    chunkIndex: number
    timestamp: string
}

export type MemoryEntry = ConversationMemory | DocumentMemory

export type NewMemoryPayload = {
    memoryType: MemoryType
    source: MemorySource
    status: MemoryStatus
    confidence: number
    text: string
    topic?: string
    createdAt: string
    expiresAt?: string | null
    supersedes?: string | null
}

function isAliveMemory(payload: Record<string, unknown>): boolean {
    const expiresAt = payload['expiresAt'] as string | null | undefined
    if (!expiresAt) return true
    return new Date(expiresAt).getTime() > Date.now()
}

function isEnabled(): boolean {
    return !!process.env.QDRANT_URL
}

function getQdrantClient(): QdrantClient {
    if (!qdrantClient) {
        qdrantClient = new QdrantClient({ url: process.env.QDRANT_URL! })
    }
    return qdrantClient
}

function getOpenAIClient(): OpenAI {
    if (!openaiClient) {
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.EMBEDDING_BASE_URL ?? process.env.OPENAI_BASE_URL,
        })
    }
    return openaiClient
}

async function createEmbedding(text: string): Promise<number[]> {
    const response = await getOpenAIClient().embeddings.create({
        model: embeddingModel(),
        input: text,
    })
    return response.data[0].embedding
}

function normalizePayload(payload: Record<string, unknown>): MemoryEntry {
    if (payload['type'] === 'document') {
        return {
            type: 'document',
            content: (payload['content'] as string) ?? '',
            summary: (payload['summary'] as string) ?? (payload['content'] as string) ?? '',
            filename: (payload['filename'] as string) ?? '',
            chunkIndex: (payload['chunkIndex'] as number) ?? 0,
            timestamp: (payload['timestamp'] as string) ?? '',
        }
    }
    return {
        type: 'conversation',
        user: (payload['user'] as string) ?? '',
        assistant: (payload['assistant'] as string) ?? '',
        timestamp: (payload['timestamp'] as string) ?? '',
    }
}

function splitIntoChunks(text: string, maxChunkSize = 500): string[] {
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim())
    const chunks: string[] = []
    let current = ''

    for (const para of paragraphs) {
        if (current.length + para.length > maxChunkSize && current) {
            chunks.push(current.trim())
            current = para
        } else {
            current = current ? `${current}\n\n${para}` : para
        }
    }
    if (current.trim()) chunks.push(current.trim())

    return chunks.length ? chunks : [text.slice(0, maxChunkSize)]
}

export function formatMemoryContext(memories: MemoryEntry[]): string {
    return memories.map((m, i) => {
        if (m.type === 'document') {
            // 元テキストをコンテキストとして使用（サマリーは検索用のみ）
            return `${i + 1}. 参考資料「${m.filename}」:\n${m.content}`
        }
        return `${i + 1}. ユーザー:「${m.user}」→ スタックちゃん:「${m.assistant}」`
    }).join('\n')
}

export async function initMemoryCollection(): Promise<void> {
    if (!isEnabled()) return
    try {
        const client = getQdrantClient()
        const collections = await client.getCollections()
        const exists = collections.collections.some(c => c.name === COLLECTION_NAME)
        if (!exists) {
            await client.createCollection(COLLECTION_NAME, {
                vectors: { size: vectorSize(), distance: 'Cosine' },
            })
            console.log(`[memory] created collection "${COLLECTION_NAME}" (dims=${vectorSize()})`)
        } else {
            console.log(`[memory] connected to collection "${COLLECTION_NAME}"`)
        }
    } catch (err) {
        console.error('[memory] init failed:', err)
    }
}

export async function storeMemory(userMsg: string, assistantMsg: string): Promise<void> {
    if (!isEnabled()) return
    try {
        const text = `ユーザー: ${userMsg}\nスタックちゃん: ${assistantMsg}`
        const vector = await createEmbedding(text)
        const now = new Date().toISOString()
        await getQdrantClient().upsert(COLLECTION_NAME, {
            wait: false,
            points: [{
                id: randomUUID(),
                vector,
                payload: {
                    // 後方互換フィールド
                    type: 'conversation',
                    user: userMsg,
                    assistant: assistantMsg,
                    timestamp: now,
                    // 新スキーマフィールド
                    memoryType: 'episode' as MemoryType,
                    source: 'assistant_reply' as MemorySource,
                    status: 'unverified' as MemoryStatus,
                    confidence: 0.4,
                    text,
                    createdAt: now,
                    expiresAt: null,
                },
            }],
        })
        console.log(`[memory] stored conversation: "${userMsg.slice(0, 30)}..."`)
    } catch (err) {
        console.error('[memory] storeMemory failed:', err)
    }
}

export async function storeFact(text: string, meta: Partial<NewMemoryPayload> = {}): Promise<void> {
    if (!isEnabled()) return
    try {
        const vector = await createEmbedding(text)
        const now = new Date().toISOString()
        await getQdrantClient().upsert(COLLECTION_NAME, {
            wait: false,
            points: [{
                id: randomUUID(),
                vector,
                payload: {
                    type: 'conversation',
                    user: '',
                    assistant: '',
                    timestamp: now,
                    memoryType: 'fact' as MemoryType,
                    source: 'user_direct' as MemorySource,
                    status: 'verified' as MemoryStatus,
                    confidence: 0.9,
                    text,
                    createdAt: now,
                    expiresAt: null,
                    ...meta,
                },
            }],
        })
        console.log(`[memory] stored fact: "${text.slice(0, 40)}..."`)
    } catch (err) {
        console.error('[memory] storeFact failed:', err)
    }
}

export async function storeObservation(text: string, ttlSec: number, meta: Partial<NewMemoryPayload> = {}): Promise<void> {
    if (!isEnabled()) return
    try {
        const vector = await createEmbedding(text)
        const now = new Date().toISOString()
        const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString()
        await getQdrantClient().upsert(COLLECTION_NAME, {
            wait: false,
            points: [{
                id: randomUUID(),
                vector,
                payload: {
                    type: 'conversation',
                    user: '',
                    assistant: '',
                    timestamp: now,
                    memoryType: 'observation' as MemoryType,
                    source: 'camera_observation' as MemorySource,
                    status: 'unverified' as MemoryStatus,
                    confidence: 0.7,
                    text,
                    createdAt: now,
                    expiresAt,
                    ...meta,
                },
            }],
        })
        console.log(`[memory] stored observation (ttl=${ttlSec}s): "${text.slice(0, 40)}..."`)
    } catch (err) {
        console.error('[memory] storeObservation failed:', err)
    }
}

async function summarizeChunk(chunk: string): Promise<string> {
    try {
        const response = await getOpenAIClient().chat.completions.create({
            model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
            messages: [{
                role: 'user',
                content: `以下のテキストを、検索に最適化した1〜2文の日本語で要約してください。重要な固有名詞・数値・手順は必ず含めてください。\n\n${chunk}`,
            }],
        })
        return response.choices[0]?.message.content ?? chunk
    } catch (err) {
        console.warn('[memory] summarizeChunk failed, using raw chunk:', err)
        return chunk
    }
}

export async function storeDocument(
    text: string,
    filename: string,
    onProgress?: (current: number, total: number) => void,
): Promise<number> {
    if (!isEnabled()) throw new Error('QDRANT_URL not configured')
    const chunks = splitIntoChunks(text)
    console.log(`[memory] processing document "${filename}" (${chunks.length} chunks)`)

    for (let i = 0; i < chunks.length; i++) {
        onProgress?.(i + 1, chunks.length)

        const summary = await summarizeChunk(chunks[i])
        console.log(`[memory] chunk ${i + 1}/${chunks.length} summary: "${summary.slice(0, 60)}..."`)

        const vector = await createEmbedding(summary)
        await getQdrantClient().upsert(COLLECTION_NAME, {
            wait: false,
            points: [{
                id: randomUUID(),
                vector,
                payload: {
                    type: 'document',
                    content: chunks[i],
                    summary,
                    filename,
                    chunkIndex: i,
                    timestamp: new Date().toISOString(),
                } satisfies DocumentMemory,
            }],
        })
    }

    console.log(`[memory] stored document "${filename}" (${chunks.length} chunks)`)
    return chunks.length
}

export async function retrieveMemories(query: string): Promise<MemoryEntry[]> {
    if (!isEnabled()) return []
    try {
        const vector = await createEmbedding(query)
        const results = await getQdrantClient().search(COLLECTION_NAME, {
            vector,
            limit: memoryLimit(),
            score_threshold: scoreThreshold(),
            with_payload: true,
        })
        return results
            .filter(r => {
                const p = r.payload as Record<string, unknown>
                if (p['status'] === 'deprecated') return false
                return isAliveMemory(p)
            })
            .map(r => normalizePayload(r.payload as Record<string, unknown>))
    } catch (err) {
        console.error('[memory] retrieveMemories failed:', err)
        return []
    }
}

export async function listMemories(limit = 50): Promise<MemoryEntry[]> {
    if (!isEnabled()) return []
    try {
        const result = await getQdrantClient().scroll(COLLECTION_NAME, {
            limit,
            with_payload: true,
        })
        return result.points
            .map(p => normalizePayload(p.payload as Record<string, unknown>))
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    } catch (err) {
        console.error('[memory] listMemories failed:', err)
        return []
    }
}
