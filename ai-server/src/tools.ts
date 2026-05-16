import type OpenAI from 'openai'
import { withTiming } from './timing.js'

type ToolDefinition = OpenAI.Chat.Completions.ChatCompletionTool

const WEATHER_CODES: Record<number, string> = {
    0: '快晴', 1: '晴れ', 2: '一部曇り', 3: '曇り',
    45: '霧', 48: '霧氷',
    51: '霧雨（弱）', 53: '霧雨', 55: '霧雨（強）',
    61: '雨（弱）', 63: '雨', 65: '雨（強）',
    71: '雪（弱）', 73: '雪', 75: '雪（強）',
    80: 'にわか雨（弱）', 81: 'にわか雨', 82: 'にわか雨（強）',
    95: '雷雨', 99: '雷雨（雹あり）',
}

async function getWeather(city: string): Promise<string> {
    const geoRes = await withTiming(
        'tool.weather.geocode',
        () => fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ja`
        ),
        { city },
    )
    if (!geoRes.ok) return `天気情報の取得に失敗しました`

    const geoData = await withTiming(
        'tool.weather.geocode.parse',
        async () => await geoRes.json() as { results?: { latitude: number; longitude: number; name: string }[] },
    )
    if (!geoData.results?.length) return `${city}の位置情報が見つかりませんでした`

    const { latitude, longitude, name } = geoData.results[0]

    const weatherRes = await withTiming(
        'tool.weather.forecast',
        () => fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
            `&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,precipitation&timezone=auto`
        ),
        { city: name, latitude, longitude },
    )
    if (!weatherRes.ok) return `天気情報の取得に失敗しました`

    const weatherData = await withTiming(
        'tool.weather.forecast.parse',
        async () => await weatherRes.json() as {
            current: {
                temperature_2m: number
                apparent_temperature: number
                weathercode: number
                windspeed_10m: number
                precipitation: number
            }
        },
    )
    const c = weatherData.current
    const condition = WEATHER_CODES[c.weathercode] ?? '不明'

    return `${name}の現在の天気: ${condition}、気温${c.temperature_2m}°C（体感${c.apparent_temperature}°C）、風速${c.windspeed_10m}km/h`
}

const JCBL_API = process.env.JCBL_API_URL

interface JcblGame {
    game_id: string
    game_date: string
    first_team_name: string
    last_team_name: string
    first_run: number
    last_run: number
    name: string
    is_private: 0 | 1
    locked: 0 | 1
    current_inning: number | null
    isTop: 0 | 1 | null
    current_out: number | null
    batter_name: string | null
    pitcher_name: string | null
    winner: string | null
    loser: string | null
    homer: string | null
    first_pitchers: string | null
    last_pitchers: string | null
    parent_id: number | null
    top_1st?: number | null
    top_2nd?: number | null
    top_3rd?: number | null
    top_4th?: number | null
    top_5th?: number | null
    top_6th?: number | null
    top_7th?: number | null
    top_8th?: number | null
    top_9th?: number | null
    bottom_1st?: number | null
    bottom_2nd?: number | null
    bottom_3rd?: number | null
    bottom_4th?: number | null
    bottom_5th?: number | null
    bottom_6th?: number | null
    bottom_7th?: number | null
    bottom_8th?: number | null
    bottom_9th?: number | null
}

function formatInnings(game: JcblGame): string {
    const tops = [
        game.top_1st, game.top_2nd, game.top_3rd, game.top_4th, game.top_5th,
        game.top_6th, game.top_7th, game.top_8th, game.top_9th,
    ]
    const bottoms = [
        game.bottom_1st, game.bottom_2nd, game.bottom_3rd, game.bottom_4th, game.bottom_5th,
        game.bottom_6th, game.bottom_7th, game.bottom_8th, game.bottom_9th,
    ]
    const played = tops.map((t, i) => ({ t, b: bottoms[i] })).filter(({ t, b }) => t !== null || b !== null)
    if (played.length === 0) return ''
    return played.map(({ t, b }, i) =>
        `${i + 1}回: ${t ?? '-'}対${b ?? '-'}`
    ).join('、')
}

async function getCapBaseballGames(keyword?: string): Promise<string> {
    if (!JCBL_API) return '試合情報APIが設定されていません（JCBL_API_URL）'

    const res = await withTiming(
        'tool.jcbl.games',
        () => fetch(`${JCBL_API}/game`),
    )
    if (!res.ok) return '試合データの取得に失敗しました'

    const games = await res.json() as JcblGame[]

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })

    // 本日・公開・リーグ戦（parent_id != null）のみ対象
    const todayGames = games.filter(g =>
        g.game_date === today &&
        g.is_private === 0 &&
        g.parent_id !== null
    )

    // キーワードで絞り込み
    const filtered = keyword
        ? todayGames.filter(g =>
            g.first_team_name.includes(keyword) ||
            g.last_team_name.includes(keyword) ||
            g.name.includes(keyword)
        )
        : todayGames

    if (filtered.length === 0) return keyword
        ? `本日、「${keyword}」に関連するリーグ試合データが見つかりませんでした`
        : `本日（${today}）のリーグ試合データはありません`

    const lines = filtered.map(g => {
        const firstTeam = g.first_team_name.replace(/\r?\n/g, '')
        const lastTeam = g.last_team_name.replace(/\r?\n/g, '')

        // 進行中（locked === 0）
        if (g.locked === 0) {
            const side = g.isTop ? '表' : '裏'
            const inning = g.current_inning ?? '?'
            const out = g.current_out ?? '?'
            return `[進行中] ${g.name}: ${firstTeam} ${g.first_run} - ${g.last_run} ${lastTeam}（${inning}回${side} ${out}アウト、打者:${g.batter_name ?? '不明'} 投手:${g.pitcher_name ?? '不明'}）`
        }

        // 終了（locked === 1）
        const result = g.first_run > g.last_run
            ? `${firstTeam}が${g.first_run}対${g.last_run}で勝利`
            : g.last_run > g.first_run
            ? `${lastTeam}が${g.last_run}対${g.first_run}で勝利`
            : `${g.first_run}対${g.last_run}で引き分け`

        const extras = [
            g.winner ? `勝利投手:${g.winner}` : null,
            g.homer  ? `本塁打:${g.homer}` : null,
        ].filter(Boolean).join('、')

        const innings = formatInnings(g)

        return `[終了] ${g.name}: ${result}${extras ? '（' + extras + '）' : ''}${innings ? ' / ' + innings : ''}`
    })

    return `本日${today}の試合（${lines.length}件）:\n` + lines.join('\n')
}

export const TOOLS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'get_weather',
            description: '指定した都市・地域の現在の天気情報を取得する',
            parameters: {
                type: 'object',
                properties: {
                    city: {
                        type: 'string',
                        description: '都市名または地域名（日本語可、例: 東京、大阪、札幌）',
                    },
                },
                required: ['city'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_cap_baseball_games',
            description: 'JCBLキャップ野球の試合結果・進行中の試合情報を取得する。チーム名やリーグ名で絞り込み可能。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: {
                        type: 'string',
                        description: 'チーム名・リーグ名などの絞り込みキーワード（省略すると全件の最新5件）',
                    },
                },
                required: [],
            },
        },
    },
]

export async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (name === 'get_weather') {
        return getWeather(args['city'] as string)
    }
    if (name === 'get_cap_baseball_games') {
        return getCapBaseballGames(args['keyword'] as string | undefined)
    }
    return 'ツールが見つかりませんでした'
}
