/**
 * Вкладка говорит голосом линии (console-speech.ts): текст ответа модели
 * приходит расшифровкой её речи, здесь он режется на фразы, каждая фраза
 * озвучивается сервером (`/api/v1/ai/voice/speech`), и звук играет по порядку.
 *
 * Фразы запрашиваются сразу, как только сложились, а играют строго по
 * очереди: пока звучит одна, следующая уже синтезируется. Сбой озвучки — не
 * тишина: вызывающий получает `onFallback` и до конца хода играет собственный
 * голос модели (так же делает станция). Три сбоя подряд — озвучка выключается
 * до конца разговора.
 *
 * Без DOM и без React: звук отдаётся колбэком, сеть — через переданный fetch,
 * поэтому модуль проверяется обычным тестом.
 */

export const SPEECH_RELAY_SAMPLE_RATE = 24_000
/** Фраза без точки длиннее этого режется по запятой или пробелу. */
const LONG_PHRASE_CHARS = 220
const MAX_PHRASE_CHARS = 900
const FAILURES_TO_DISABLE = 3

export type SpeechRelayOptions = Readonly<{
  voiceSessionId: string
  /** PCM уже в Float32 −1…1, 24 кГц моно. */
  play: (samples: Float32Array) => void
  /** Первый звук очередной фразы: помощник говорит. */
  onAudio?: () => void
  /**
   * Озвучка не удалась: дальше в этом ходе играет голос модели.
   * `heardAny` — звучало ли в этом ходе уже что-то голосом линии.
   */
  onFallback: (heardAny: boolean) => void
  fetch?: typeof fetch
}>

/**
 * Где кончается последняя законченная фраза; −1 — ещё нигде. Знак конца
 * считается концом, только когда за ним уже пришёл пробел: «3.» в конце куска
 * может оказаться «3.5».
 */
export function lastSentenceEnd(text: string): number {
  let end = -1
  const pattern = /[.!?…]+(?=\s)|\n/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) end = match.index + match[0].length
  return end
}

export function pcm16BytesToFloat32(bytes: Uint8Array): Float32Array {
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2))
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000
  }
  return samples
}

type Phrase = Readonly<{ response: Promise<Response | null>; controller: AbortController }>

export class SpeechRelay {
  private buffer = ""
  private queue: Phrase[] = []
  private playing = false
  private failedThisTurn = false
  private heardThisTurn = false
  private failures = 0
  private disabled = false
  private epoch = 0
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: SpeechRelayOptions) {
    // Bound, not wrapped: the wrapper existed only to keep `fetch` from losing
    // its receiver, and a bare `fetch(...)` call here reads to the timeout
    // guard as a server call to another service with no limit. The one real
    // call this makes is to this app's own route, with a signal (below).
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis)
  }

  /** Озвучивает ли модуль этот ход сам (иначе играет голос модели). */
  get speaking(): boolean {
    return !this.disabled && !this.failedThisTurn
  }

  /** Кусок расшифровки ответа модели. */
  addText(text: string): void {
    if (!this.speaking || !text) return
    this.buffer += text
    const end = lastSentenceEnd(this.buffer)
    if (end > 0) {
      this.say(this.buffer.slice(0, end))
      this.buffer = this.buffer.slice(end)
    }
    if (this.buffer.length > LONG_PHRASE_CHARS) {
      const cut = Math.max(this.buffer.lastIndexOf(", "), this.buffer.lastIndexOf(" "))
      if (cut > 40) {
        this.say(this.buffer.slice(0, cut + 1))
        this.buffer = this.buffer.slice(cut + 1)
      }
    }
  }

  /** Ход модели кончился: договорить остаток. */
  flush(): void {
    if (this.speaking && this.buffer.trim()) this.say(this.buffer)
    this.buffer = ""
  }

  /** Следующий ход начнётся заново; уже сказанное доиграет. */
  endTurn(): void {
    this.flush()
    this.failedThisTurn = false
    this.heardThisTurn = false
  }

  /** Перебили или разговор кончился: всё, что не прозвучало, отменить. */
  interrupt(): void {
    this.epoch += 1
    for (const phrase of this.queue) phrase.controller.abort()
    this.queue = []
    this.buffer = ""
    this.playing = false
    this.failedThisTurn = false
    this.heardThisTurn = false
  }

  private say(raw: string): void {
    const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_PHRASE_CHARS)
    if (!/[\p{L}\p{N}]/u.test(text)) return
    const controller = new AbortController()
    const response = this.fetchImpl("/api/v1/ai/voice/speech", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voiceSessionId: this.options.voiceSessionId, text }),
      signal: controller.signal,
    }).then((result) => (result.ok && result.body ? result : null), () => null)
    this.queue.push({ response, controller })
    if (!this.playing) void this.drain(this.epoch)
  }

  private async drain(epoch: number): Promise<void> {
    this.playing = true
    while (this.queue.length > 0 && epoch === this.epoch) {
      const phrase = this.queue[0]
      const played = await this.playPhrase(phrase, epoch)
      if (epoch !== this.epoch) return
      this.queue.shift()
      if (!played) {
        this.fail()
        return
      }
    }
    if (epoch === this.epoch) this.playing = false
  }

  /** true — фраза прозвучала (хоть частью); false — озвучки не было. */
  private async playPhrase(phrase: Phrase, epoch: number): Promise<boolean> {
    const response = await phrase.response
    if (!response || epoch !== this.epoch) return Boolean(response)
    const reader = response.body!.getReader()
    let carry: Uint8Array | null = null
    let any = false
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done || epoch !== this.epoch) break
        let bytes = value
        if (carry) {
          const joined = new Uint8Array(carry.length + value.length)
          joined.set(carry)
          joined.set(value, carry.length)
          bytes = joined
          carry = null
        }
        if (bytes.length % 2 === 1) {
          carry = bytes.slice(bytes.length - 1)
          bytes = bytes.slice(0, bytes.length - 1)
        }
        if (bytes.length === 0) continue
        if (!any) {
          any = true
          this.heardThisTurn = true
          this.failures = 0
          this.options.onAudio?.()
        }
        this.options.play(pcm16BytesToFloat32(bytes))
      }
    } catch {
      // Обрыв посреди фразы: сыграно то, что пришло.
    }
    return any
  }

  private fail(): void {
    for (const phrase of this.queue) phrase.controller.abort()
    this.queue = []
    this.buffer = ""
    this.playing = false
    this.failedThisTurn = true
    this.failures += 1
    if (this.failures >= FAILURES_TO_DISABLE) this.disabled = true
    this.options.onFallback(this.heardThisTurn)
  }
}
