/**
 * Голос помощника — тот же, что у телефонной линии Зейтуна (владелец
 * 2026-11-09: «точь-в-точь, какой на звонке», а у собственного голоса Live —
 * «провинциальный акцент», как он сказал о нём и 2026-10-23).
 *
 * На линии говорит не модель Live, а отдельная модель озвучки: станция берёт
 * текст ответа и озвучивает его `gemini-3.8-flash-tts` голосом Sulafat в
 * манере, выбранной владельцем по трём записям (вариант «C», 2026-10-30).
 * Консоль делает то же: вкладка присылает фразы ответа, сервер озвучивает их
 * этой моделью и отдаёт звук потоком.
 *
 * Через Vertex AI, а не Gemini API: на Tier 1 у этой модели 100 озвучек в
 * сутки — несколько разговоров, — и ключ Gemini API общий с запасным путём
 * линии. Нет ключа Vertex — озвучки нет, консоль говорит голосом Live.
 */

// Те же модель и голос, что у линии (ZEYTUN_INBOUND_SPEECH); их равенство
// стережёт voice-console-speech.test.ts — модуль линии сюда не тянется.
export const CONSOLE_SPEECH_MODEL = "gemini-3.8-flash-tts"
export const CONSOLE_SPEECH_VOICE = "Sulafat"
export const CONSOLE_SPEECH_SAMPLE_RATE = 24_000
/** Одна фраза, а не монолог: длинный ответ вкладка режет на фразы. */
export const CONSOLE_SPEECH_MAX_CHARS = 1_000

const VERTEX_PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

export type ConsoleSpeechConfig = Readonly<{ project: string; key: string }>

export function consoleSpeechConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConsoleSpeechConfig | null {
  const project = (env.VOICE_TTS_VERTEX_PROJECT ?? "").trim()
  const key = (env.VOICE_TTS_VERTEX_KEY ?? "").trim()
  if (!VERTEX_PROJECT.test(project) || key.length < 30 || key.length > 256) return null
  return { project, key }
}

/**
 * Манера линии (вариант «C») без её телефонной роли «оператор заказов» —
 * консоль говорит с сотрудником, — и с языком фразы. Модель озвучки сама
 * угадывает язык, и азербайджанский кусок без азербайджанских букв звучал
 * по-английски (звонок 2026-11-03): поэтому язык называется явно.
 */
const MANNER = "relaxed, friendly conversation; warm and smiling, natural unhurried pace with small natural pauses; a real person talking to a colleague, not a narrator reading a script"
const AZERBAIJANI_LETTERS = /[əğıöüşçƏĞİÖÜŞÇ]/
const CYRILLIC = /[Ѐ-ӿ]/

export function consoleSpeechStyle(text: string, locale: string): string {
  const language = CYRILLIC.test(text)
    ? "always Russian as spoken in Baku: every word, number and name read the Russian way"
    : AZERBAIJANI_LETTERS.test(text) || locale.toLowerCase().startsWith("az")
      ? "always Azerbaijani as spoken in Baku: every word, number and name read the Azerbaijani way, never English"
      : "always English"
  return `${language}; ${MANNER}`
}

export function consoleSpeechRequest(config: ConsoleSpeechConfig, text: string, style: string | null): { url: string; body: unknown } {
  const part: Record<string, unknown> = { text }
  if (style) part.speechMetadata = { style }
  return {
    url: `https://aiplatform.googleapis.com/v1/projects/${config.project}/locations/global/publishers/google/models/${CONSOLE_SPEECH_MODEL}:streamGenerateContent?alt=sse`,
    body: {
      contents: [{ role: "user", parts: [part] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: CONSOLE_SPEECH_VOICE } } },
      },
    },
  }
}

/** Звук из одного события SSE: base64-PCM частей ответа. */
export function consoleSpeechChunks(event: unknown): Buffer[] {
  const candidates = (event as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: unknown } }> } }> })?.candidates
  const parts = candidates?.[0]?.content?.parts ?? []
  return parts.flatMap((part) => (typeof part.inlineData?.data === "string" && part.inlineData.data
    ? [Buffer.from(part.inlineData.data, "base64")]
    : []))
}

export class ConsoleSpeechError extends Error {
  constructor(readonly status: number | null) {
    super(status ? `console speech http ${status}` : "console speech unavailable")
    this.name = "ConsoleSpeechError"
  }
}

async function open(config: ConsoleSpeechConfig, text: string, style: string | null, signal: AbortSignal): Promise<Response> {
  const { url, body } = consoleSpeechRequest(config, text, style)
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      // Ключ — в заголовке, не в адресе: адрес попадает в журналы и ошибки.
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.key },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new ConsoleSpeechError(null)
  }
  if (!response.ok || !response.body) throw new ConsoleSpeechError(response.status)
  return response
}

/**
 * Озвучить одну фразу: PCM16 24 кГц моно кусками по мере синтеза. Отказ на
 * манеру (400) — тот же текст без неё, как на линии. Ничего не пишет в журнал
 * — ни текста, ни ключа.
 */
export async function* streamConsoleSpeech(input: {
  config: ConsoleSpeechConfig
  text: string
  locale: string
  signal: AbortSignal
}): AsyncGenerator<Buffer> {
  let response: Response
  try {
    response = await open(input.config, input.text, consoleSpeechStyle(input.text, input.locale), input.signal)
  } catch (error) {
    if (!(error instanceof ConsoleSpeechError) || error.status !== 400) throw error
    response = await open(input.config, input.text, null, input.signal)
  }
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    let newline = buffered.indexOf("\n")
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim()
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf("\n")
      if (!line.startsWith("data:")) continue
      let event: unknown
      try {
        event = JSON.parse(line.slice(5).trim())
      } catch {
        continue
      }
      for (const chunk of consoleSpeechChunks(event)) yield chunk
    }
  }
}
