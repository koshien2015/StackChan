import type { SpontaneousSpeechType } from './device-context.js'

// Phase 1: 定型発話のみ（LLM不要）
// Phase 2以降でretrieveMemoriesを使った雑談生成を追加予定

const MORNING_GREETINGS = [
  'おはようございます！今日もよい一日を。',
  'おはよう！今日も頑張ろう。',
  'おはようございます。今日も元気にいきましょう。',
]

const CHECKIN_PHRASES = [
  'ちょっと一休みしませんか？',
  '最近どうですか？',
  'そろそろ休憩でもどうですか。',
  '作業、うまくいってますか？',
]

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]
}

export async function buildUtterance(reason: SpontaneousSpeechType): Promise<string | null> {
  switch (reason) {
    case 'greeting': return pick(MORNING_GREETINGS)
    case 'checkin': return pick(CHECKIN_PHRASES)
    default: return null
  }
}
