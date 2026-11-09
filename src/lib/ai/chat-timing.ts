/**
 * One log line per Da Vinci chat turn: how long it took to prepare, to the
 * first word the person saw, and in total — and whether it was this process's
 * first turn. Written to measure the cold start after a deploy (2026-11-08:
 * 13.2 s to the first word on the first question, 1.2 s on the next), which
 * cannot be reproduced without restarting production.
 *
 *   {"evt":"ai_chat_timing","turn":1,"uptimeS":42,"prepMs":380,
 *    "firstTextMs":1450,"totalMs":3100,"status":200,"streamed":true,"proc":"web"}
 *
 * Numbers only: no question, no answer, no organization or person.
 */
import { processRole } from "@/lib/station-timing"

let turnsInProcess = 0

export type ChatTiming = {
  /** The first request to the model is about to go out. */
  modelCall(): void
  /** The first text the person sees: a streamed word, or the whole reply. */
  firstText(): void
  finish(status: number, streamed: boolean): void
}

export function startChatTiming(now: () => number = Date.now): ChatTiming {
  const startedAt = now()
  const turn = ++turnsInProcess
  let modelAt: number | undefined
  let firstTextAt: number | undefined
  let finished = false
  return {
    modelCall() { modelAt ??= now() },
    firstText() { firstTextAt ??= now() },
    finish(status, streamed) {
      if (finished) return
      finished = true
      const end = now()
      const line = {
        evt: "ai_chat_timing",
        turn,
        uptimeS: Math.round(process.uptime()),
        prepMs: modelAt === undefined ? null : modelAt - startedAt,
        firstTextMs: (firstTextAt ?? end) - startedAt,
        totalMs: end - startedAt,
        status,
        streamed,
        proc: processRole(),
      }
      // stdout, not console: route tests spy on console.
      process.stdout.write(`${JSON.stringify(line)}\n`)
    },
  }
}
