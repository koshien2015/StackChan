import { chatSimple, type Message } from './llm.js'
import { storeMemory, storeFact, type MemoryType, type MemoryStatus } from './memory.js'

type ExtractedMemory = {
  text: string
  memoryType: MemoryType
  status: MemoryStatus
  confidence: number
}

const SYSTEM_PROMPT: Message = {
  role: 'system',
  content: [
    '以下の会話から、将来使えそうな記憶だけを抽出してください。',
    '保存してよいもの: ユーザーが明言した事実、ユーザーの好み・設定、継続中の課題。',
    '保存しないもの: 雑談の相槌、未確認推測、アシスタントの返答文そのもの、一時的な話題。',
    '何も保存すべきものがなければ items を空にしてください。',
    '',
    'JSON形式のみで返してください（コードブロック・説明不要）:',
    '{"items":[{"text":"...","memoryType":"fact"|"preference"|"episode","status":"verified"|"unverified","confidence":0.0}]}',
  ].join('\n'),
}

function parseExtracted(raw: string): ExtractedMemory[] {
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(cleaned) as { items?: ExtractedMemory[] }
  return parsed.items ?? []
}

async function extractMemories(userMsg: string, assistantMsg: string): Promise<ExtractedMemory[]> {
  const messages: Message[] = [
    SYSTEM_PROMPT,
    {
      role: 'user',
      content: `ユーザー: ${userMsg}\nアシスタント: ${assistantMsg}`,
    },
  ]
  const raw = await chatSimple(messages)
  return parseExtracted(raw)
}

export async function extractAndStoreMemories(userMsg: string, assistantMsg: string): Promise<void> {
  // 後方互換: 会話ログとしての保存を継続（検索・コンテキスト注入用）
  await storeMemory(userMsg, assistantMsg)

  // 構造化記憶の抽出・保存（fire-and-forget）
  extractMemories(userMsg, assistantMsg)
    .then(items => {
      for (const item of items) {
        if (item.memoryType === 'fact' || item.memoryType === 'preference') {
          storeFact(item.text, {
            memoryType: item.memoryType,
            status: item.status,
            confidence: item.confidence,
            source: 'user_direct',
          }).catch(err => console.error('[memory-writer] storeFact failed:', err))
        }
      }
      if (items.length > 0) {
        console.log(`[memory-writer] extracted ${items.length} memories from conversation`)
      }
    })
    .catch(err => console.error('[memory-writer] extractMemories failed:', err))
}
