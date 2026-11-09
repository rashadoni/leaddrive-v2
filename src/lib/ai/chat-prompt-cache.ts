/**
 * Prompt caching for Da Vinci's chat requests to Anthropic.
 *
 * Until 2026-11-09 every request sent the tool definitions and the whole
 * system prompt as fresh input — on every question and again on every tool
 * round of the same question. A cache is a byte-exact PREFIX match in the
 * order tools → system → messages, so the request is laid out by how often
 * each part changes:
 *
 *   tools                         same for the org, role and locale
 *   system[0]  stable rules       same for the agent and locale   ← breakpoint 1
 *   system[1]  this request       page, reporting clock, deal insights
 *   messages   history, question, tool rounds of this turn        ← breakpoint 2
 *
 * Breakpoint 1 makes the next question (any user of the same org, role,
 * agent and locale within the cache lifetime) read tools + rules from the
 * cache. Breakpoint 2 sits on the last block of the request, so the next tool
 * round of the same question reads everything the previous round sent.
 *
 * Anything that differs between requests — the clock, the page, deal
 * insights, history, the question — must stay out of system[0]: one changed
 * byte there and nothing after it is ever read back.
 */
import type Anthropic from "@anthropic-ai/sdk"

const EPHEMERAL = { type: "ephemeral" } as const

/**
 * The system prompt as two blocks: the stable rules, marked for caching, then
 * what belongs to this request alone (no marker, read fresh every time).
 */
export function cachedSystemPrompt(stable: string, perRequest: string): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [{ type: "text", text: stable, cache_control: EPHEMERAL }]
  if (perRequest.trim()) blocks.push({ type: "text", text: perRequest })
  return blocks
}

/**
 * A copy of the conversation with the cache marker on the last block of the
 * last message. The marker is put on the request copy only: the turn's own
 * message list stays unmarked, so earlier rounds never pile up markers
 * (Anthropic allows four per request; this request uses two).
 *
 * Every message goes out in block form: the question that carried the marker
 * as `[{type:"text"}]` in one round is sent the same way in the next, so the
 * next round's prefix repeats the previous request exactly.
 */
export function withCachedTail(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out = messages.map((message): Anthropic.MessageParam => ({
    ...message,
    content: typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : [...message.content],
  }))
  const content = out.at(-1)?.content as Anthropic.ContentBlockParam[] | undefined
  const tail = content?.at(-1)
  // Thinking blocks cannot carry a marker; the chat does not use thinking.
  if (!content || !tail || tail.type === "thinking" || tail.type === "redacted_thinking") return out
  content[content.length - 1] = { ...tail, cache_control: EPHEMERAL } as Anthropic.ContentBlockParam
  return out
}

/** The token counts of one model response that cost and the timing log need. */
export type ChatRoundUsage = {
  /** Input read at full price — after the last cache hit. */
  inputTokens: number
  /** Input read from the cache (0.1× the input price). */
  cacheReadTokens: number
  /** Input written to the cache (1.25× the input price, 5-minute lifetime). */
  cacheWriteTokens: number
  outputTokens: number
}

export function roundUsage(usage: Partial<Anthropic.Usage> | null | undefined): ChatRoundUsage {
  return {
    inputTokens: usage?.input_tokens || 0,
    cacheReadTokens: usage?.cache_read_input_tokens || 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
  }
}
