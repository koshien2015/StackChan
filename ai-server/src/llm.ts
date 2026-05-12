import OpenAI from 'openai'
import { TOOLS, callTool } from './tools.js'
import { withTiming } from './timing.js'

export type Message = { role: 'system' | 'user' | 'assistant'; content: string }

let client: OpenAI | null = null
// セッション内でツール対応を確認済みかどうかのフラグ（null=未確認）
let toolsSupported: boolean | null = null

function getClient(): OpenAI {
    if (!client) {
        client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL,
        })
    }
    return client
}

function isToolsNotSupportedError(err: unknown): boolean {
    const msg = String(err).toLowerCase()
    return msg.includes('tool') || msg.includes('function call')
}

async function callWithTools(
    model: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return withTiming(
        'llm.chat.initial',
        () => getClient().chat.completions.create({ model, messages, tools: TOOLS, tool_choice: 'auto' }),
        { model, messageCount: messages.length },
    )
}

async function callWithoutTools(
    model: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return withTiming(
        'llm.chat',
        () => getClient().chat.completions.create({ model, messages }),
        { model, messageCount: messages.length },
    )
}

export async function chat(messages: Message[]): Promise<string> {
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
    const canUseTools = TOOLS.length > 0 && toolsSupported !== false

    let response: OpenAI.Chat.Completions.ChatCompletion
    if (canUseTools) {
        try {
            response = await callWithTools(model, messages)
            toolsSupported = true
        } catch (err) {
            if (isToolsNotSupportedError(err)) {
                console.warn('[llm] model does not support tools, disabling for this session')
                toolsSupported = false
                response = await callWithoutTools(model, messages)
            } else {
                throw err
            }
        }
    } else {
        response = await callWithoutTools(model, messages)
    }

    const choice = response.choices[0]

    // ツール呼び出しが必要な場合はツールを実行して再度APIを呼ぶ
    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
        const extended: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            ...messages,
            choice.message,
        ]

        for (const toolCall of choice.message.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
            const result = await withTiming(
                `llm.tool.${toolCall.function.name}`,
                () => callTool(toolCall.function.name, args),
            )
            console.log(`[llm] tool ${toolCall.function.name}(${toolCall.function.arguments}) => ${result}`)
            extended.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result,
            })
        }

        const final = await withTiming(
            'llm.chat.final',
            () => getClient().chat.completions.create({ model, messages: extended }),
            { model, messageCount: extended.length },
        )
        return final.choices[0]?.message.content ?? ''
    }

    return choice.message.content ?? ''
}

export async function chatSimple(messages: Message[]): Promise<string> {
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
    const response = await callWithoutTools(model, messages)
    return response.choices[0]?.message.content ?? ''
}
