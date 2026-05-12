import OpenAI from 'openai'

// CAMERA_URL: ESP32カメラのスナップショットエンドポイント (例: http://192.168.1.x/capture)
const cameraUrl = () => process.env.CAMERA_URL ?? null
const visionModel = () => process.env.VISION_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

export function isCameraEnabled(): boolean {
  return !!process.env.CAMERA_URL
}

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    })
  }
  return client
}

export async function captureImage(): Promise<Buffer> {
  const url = cameraUrl()
  if (!url) throw new Error('CAMERA_URL not configured')
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Camera capture failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function detectPresence(image: Buffer): Promise<boolean> {
  const base64 = image.toString('base64')
  const response = await getClient().chat.completions.create({
    model: visionModel(),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '画像の中に人がいますか？「yes」または「no」のみで答えてください。' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
      ],
    }],
    max_tokens: 5,
  })
  const answer = response.choices[0]?.message.content?.toLowerCase().trim() ?? ''
  return answer.startsWith('yes') || answer.includes('はい')
}

export async function summarizeScene(image: Buffer): Promise<string> {
  const base64 = image.toString('base64')
  const response = await getClient().chat.completions.create({
    model: visionModel(),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '画像を1文で簡潔に説明してください。' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
      ],
    }],
    max_tokens: 60,
  })
  return response.choices[0]?.message.content?.trim() ?? ''
}
