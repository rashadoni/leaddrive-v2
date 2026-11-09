/**
 * Da Vinci's answer, shown while the model writes it (server-sent events).
 *
 * The chat route still decides the final answer exactly as before and sends it
 * last, in a `done` event, with the same JSON body the non-streaming route
 * returns; the client replaces whatever it showed with it. What streams before
 * that is only what the route would have shown anyway, with two holds:
 *
 *  - A number the model writes is held back until its round ends. The route
 *    promises never to show a CRM figure it did not verify: when the model
 *    reaches for an analytics tool, its prose is thrown away and the verified
 *    rendering takes its place. Text up to the first digit of a round streams;
 *    the rest arrives with the final answer. (Digits inside masked names such
 *    as `[PERSON_1]` do not count.)
 *  - The model sees customers' names, e-mails and phones masked
 *    (`[PERSON_1]`, src/lib/ai/pii-masker.ts). A placeholder is shown only
 *    once it is complete, and then unmasked; half of one is held back.
 *
 * A round that turns to a tool sends `reset`: its preamble («let me check…»)
 * is not the answer, exactly as the route drops it from the final reply.
 * After an analytics tool has run nothing more streams — that answer is the
 * verified rendering, sent in `done`.
 */

export type LiveReplyEvent =
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "done"; status: number; body: unknown }

const PLACEHOLDER = /\[[A-Z]+_\d+\]/g

/** Index from which the round's text must not be shown yet. */
export function liveHoldIndex(text: string): number {
  // Hide complete placeholders from the digit scan (same length, no digits).
  const scan = text.replace(PLACEHOLDER, (match) => "#".repeat(match.length))
  const digit = scan.search(/\d/)
  const open = scan.lastIndexOf("[")
  const unclosed = open !== -1 && scan.indexOf("]", open) === -1 ? open : -1
  const holds = [digit, unclosed].filter((index) => index !== -1)
  return holds.length > 0 ? Math.min(...holds) : text.length
}

export class LiveReply {
  private round = ""
  private shown = 0
  private toolInRound = false
  private stopped = false
  private shownAnything = false

  constructor(
    private readonly send: (event: LiveReplyEvent) => void,
    private readonly unmask: (text: string) => string,
  ) {}

  /** Nothing more streams; the answer comes in `done`. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.shownAnything) this.send({ type: "reset" })
    this.shownAnything = false
  }

  startRound(): void {
    this.round = ""
    this.shown = 0
    this.toolInRound = false
  }

  text(delta: string): void {
    if (this.stopped || this.toolInRound || !delta) return
    this.round += delta
    const hold = liveHoldIndex(this.round)
    if (hold <= this.shown) return
    const piece = this.unmask(this.round.slice(this.shown, hold))
    this.shown = hold
    if (!piece) return
    this.shownAnything = true
    this.send({ type: "delta", text: piece })
  }

  /** The round is asked again (its stream stalled): what it showed is taken back. */
  restartRound(): void {
    if (this.shownAnything && !this.stopped) this.send({ type: "reset" })
    this.shownAnything = false
    this.startRound()
  }

  /** The model turned to a tool: what it wrote this round is not the answer. */
  toolUse(): void {
    if (this.toolInRound) return
    this.toolInRound = true
    if (this.shownAnything && !this.stopped) this.send({ type: "reset" })
    this.shownAnything = false
  }

}

/** One server-sent event. */
export function sseFrame(event: LiveReplyEvent): string {
  const { type, ...data } = event
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

/** Splits a server-sent-event byte stream into events; keeps the unfinished tail. */
export function parseSseChunk(buffer: string): { events: LiveReplyEvent[]; rest: string } {
  const events: LiveReplyEvent[] = []
  const frames = buffer.split("\n\n")
  const rest = frames.pop() ?? ""
  for (const frame of frames) {
    let type = ""
    let data = ""
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) type = line.slice(7).trim()
      else if (line.startsWith("data: ")) data += line.slice(6)
    }
    if (!type) continue
    try {
      events.push({ type, ...(data ? JSON.parse(data) : {}) } as LiveReplyEvent)
    } catch {
      /* a malformed frame is skipped, the final answer still comes in done */
    }
  }
  return { events, rest }
}
