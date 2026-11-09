/**
 * A streamed model round that stops talking is cut off and asked once more
 * (owner, 2026-11-09: «Да, ставь»).
 *
 * Production 2026-11-09 18:02 UTC: Da Vinci's first word came after 1.2 s,
 * then Anthropic's stream went silent and the 325-token answer finished 65 s
 * later. Our web process served everyone else meanwhile; the wait was the
 * stream. The SDK's `timeout` (src/lib/ai/anthropic-client.ts) bounds only
 * the wait for the response to begin — once a stream has started, a stall in
 * the middle has no limit but the SDK's ten minutes.
 *
 * So every event resets a clock; `stallMs` without one — from the request on —
 * aborts the stream. The first stall asks the same round again (`onRetry`
 * lets the caller take back what it showed); a second gives up with
 * `ModelStreamStalledError`. Any other failure is passed through untouched.
 */

/** Silence after which a stream is taken as stalled. A healthy one sends an event every few hundred ms. */
export const MODEL_STREAM_STALL_MS = 20_000

export class ModelStreamStalledError extends Error {
  constructor(readonly attempts: number, readonly stallMs: number) {
    super(`Model stream sent nothing for ${stallMs} ms, ${attempts} time(s)`)
    this.name = "ModelStreamStalledError"
  }
}

/** The part of the SDK's MessageStream this needs. */
export interface GuardedStream<M, E> {
  on(event: "streamEvent", listener: (event: E) => void): unknown
  finalMessage(): Promise<M>
  abort(): void
}

export async function streamRoundGuarded<M, E>(options: {
  open: () => GuardedStream<M, E>
  onEvent: (event: E) => void
  /** Before the round is asked again: take back what the stalled attempt showed. */
  onRetry: () => void
  /** Each stall, for the log. */
  onStall?: (attempt: number) => void
  stallMs?: number
  attempts?: number
}): Promise<M> {
  const stallMs = options.stallMs ?? MODEL_STREAM_STALL_MS
  const attempts = options.attempts ?? 2
  for (let attempt = 1; ; attempt += 1) {
    const stream = options.open()
    let stalled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        stalled = true
        stream.abort()
      }, stallMs)
    }
    arm()
    stream.on("streamEvent", (event) => {
      if (stalled) return
      arm()
      options.onEvent(event)
    })
    try {
      return await stream.finalMessage()
    } catch (error) {
      if (!stalled) throw error
      options.onStall?.(attempt)
      if (attempt >= attempts) throw new ModelStreamStalledError(attempt, stallMs)
      options.onRetry()
    } finally {
      clearTimeout(timer)
    }
  }
}
