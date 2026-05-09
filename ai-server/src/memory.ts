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

export type MemoryEntry = {
    user: string
    assistant: string
    timestamp: string
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
        await getQdrantClient().upsert(COLLECTION_NAME, {
            wait: false,
            points: [{
                id: randomUUID(),
                vector,
                payload: {
                    user: userMsg,
                    assistant: assistantMsg,
                    timestamp: new Date().toISOString(),
                } satisfies MemoryEntry,
            }],
        })
        console.log(`[memory] stored: "${userMsg.slice(0, 30)}..."`)
    } catch (err) {
        console.error('[memory] storeMemory failed:', err)
    }
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
        return results.map(r => r.payload as MemoryEntry)
    } catch (err) {
        console.error('[memory] retrieveMemories failed:', err)
        return []
    }
}
