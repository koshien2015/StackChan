import { chatSimple, type Message } from './llm.js'
import { retrieveMemories, formatMemoryContext } from './memory.js'
import type { SpontaneousSpeechType } from './device-context.js'

const MAX_UTTERANCE_CHARS = 90

const MORNING_GREETINGS = [
  'おはようございます！今日もよい一日を。',
  'おはよう！今日も頑張ろう。',
  'おはようございます。今日も元気にいきましょう。',
]

const CHECKIN_FALLBACK = [
  'ちょっと一休みしませんか？',
  '最近どうですか？',
  'そろそろ休憩でもどうですか。',
  '作業、うまくいってますか？',
]

const REACTION_FALLBACK = [
  'あ、いたんですか！気づかなかった。',
  'おや、こんにちは。',
  'いらっしゃい！',
  'やあ、気づいてなかった。何かありましたか？',
]

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]
}

function formatTime(d: Date): string {
  return `${d.getHours()}時${d.getMinutes()}分`
}

async function buildLlmReaction(): Promise<string> {
  const memories = await retrieveMemories('挨拶 ユーザー 人 存在', 2)
  const memoryContext = memories.length > 0
    ? formatMemoryContext(memories)
    : '（直近の記憶なし）'

  const messages: Message[] = [
    {
      role: 'system',
      content: [
        'あなたは卓上ロボット「StackChan」です。',
        'カメラで近くに人がいることに気づきました。',
        '自然な一言で話しかけてください。1文のみ。',
        `${MAX_UTTERANCE_CHARS}文字以内で答えてください。`,
        '発話文のみを返してください。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `現在時刻: ${formatTime(new Date())}`,
        '',
        '直近の記憶:',
        memoryContext,
      ].join('\n'),
    },
  ]

  const text = await chatSimple(messages)
  return text.trim().slice(0, MAX_UTTERANCE_CHARS)
}

async function buildLlmCheckin(): Promise<string> {
  const memories = await retrieveMemories('最近の会話 ユーザーの様子 話題 好み', 3)
  const memoryContext = memories.length > 0
    ? formatMemoryContext(memories)
    : '（直近の記憶なし）'

  const messages: Message[] = [
    {
      role: 'system',
      content: [
        'あなたは卓上ロボット「StackChan」です。',
        'ユーザーに短く自然に話しかけてください。',
        '1〜2文、質問するなら1つだけにしてください。',
        '説教・長い説明は禁止です。',
        `${MAX_UTTERANCE_CHARS}文字以内で答えてください。`,
        '発話文のみを返してください（前置き・説明不要）。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `現在時刻: ${formatTime(new Date())}`,
        '',
        '直近の会話・記憶:',
        memoryContext,
      ].join('\n'),
    },
  ]

  const text = await chatSimple(messages)
  return text.trim().slice(0, MAX_UTTERANCE_CHARS)
}

export async function buildUtterance(reason: SpontaneousSpeechType): Promise<string | null> {
  switch (reason) {
    case 'greeting':
      return pick(MORNING_GREETINGS)

    case 'checkin': {
      try {
        return await buildLlmCheckin()
      } catch (err) {
        console.warn('[brain] LLM checkin failed, using fallback:', err)
        return pick(CHECKIN_FALLBACK)
      }
    }

    case 'reaction': {
      try {
        return await buildLlmReaction()
      } catch (err) {
        console.warn('[brain] LLM reaction failed, using fallback:', err)
        return pick(REACTION_FALLBACK)
      }
    }

    default:
      return null
  }
}
