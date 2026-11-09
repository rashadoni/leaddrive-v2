/**
 * One log line per Da Vinci chat turn: how long it took to prepare, to the
 * first word the person saw, and in total — and whether it was this process's
 * first turn. Written to measure the cold start after a deploy (2026-11-08:
 * 13.2 s to the first word on the first question, 1.2 s on the next), which
 * cannot be reproduced without restarting production.
 *
 *   {"evt":"ai_chat_timing","turn":1,"uptimeS":42,"prepMs":380,
 *    "firstTextMs":1450,"totalMs":3100,"status":200,"streamed":true,"proc":"web",
 *    "rounds":2,"inputTokens":310,"cacheReadTokens":9800,"cacheWriteTokens":5200,
 *    "outputTokens":240,"routedMs":610,"classified":true,"readMs":615,
 *    "insightsMs":null,"namesMs":615}
 *
 * The token counts are summed over the turn's model rounds and show whether
 * the prompt cache works (src/lib/ai/chat-prompt-cache.ts): a second question
 * within five minutes should read the tools and rules from the cache.
 *
 * The `…Ms` marks split the preparation: when the agent was picked
 * (`classified`: an intent model call was needed for it), the org context and
 * timezone were read, deal insights were ready (deal pages only) and the
 * known names for masking were loaded — each counted from the start of the
 * turn, so the largest one before `prepMs` is what the first word waited for.
 *
 * Numbers only: no question, no answer, no organization or person.
 */
import { processRole } from "@/lib/station-timing"
import type { ChatRoundUsage } from "@/lib/ai/chat-prompt-cache"

let turnsInProcess = 0

export type ChatPrepStep = "routed" | "read" | "insights" | "names"

export type ChatTiming = {
  /** The first request to the model is about to go out. */
  modelCall(): void
  /** The first text the person sees: a streamed word, or the whole reply. */
  firstText(): void
  /** A step of the preparation is done (first call counts). */
  mark(step: ChatPrepStep): void
  /** Whether picking the agent needed the intent model. */
  classified(value: boolean): void
  /** One model round finished with these token counts. */
  usage(round: ChatRoundUsage): void
  finish(status: number, streamed: boolean): void
}

export function startChatTiming(now: () => number = Date.now): ChatTiming {
  const startedAt = now()
  const turn = ++turnsInProcess
  let modelAt: number | undefined
  let firstTextAt: number | undefined
  let finished = false
  const marks: Record<`${ChatPrepStep}Ms`, number | null> = {
    routedMs: null, readMs: null, insightsMs: null, namesMs: null,
  }
  let intentModelAsked: boolean | null = null
  const tokens = { rounds: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
  return {
    modelCall() { modelAt ??= now() },
    firstText() { firstTextAt ??= now() },
    mark(step) { marks[`${step}Ms`] ??= now() - startedAt },
    classified(value) { intentModelAsked ??= value },
    usage(round) {
      tokens.rounds += 1
      tokens.inputTokens += round.inputTokens
      tokens.cacheReadTokens += round.cacheReadTokens
      tokens.cacheWriteTokens += round.cacheWriteTokens
      tokens.outputTokens += round.outputTokens
    },
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
        ...tokens,
        ...marks,
        classified: intentModelAsked,
      }
      // stdout, not console: route tests spy on console.
      process.stdout.write(`${JSON.stringify(line)}\n`)
    },
  }
}
