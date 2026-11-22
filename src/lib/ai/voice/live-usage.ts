/**
 * What a Gemini Live conversation used, as Google counts it: every model turn
 * arrives with `usageMetadata` for that turn — and each turn bills the whole
 * conversation so far again, so a minute of talk costs far more than a minute
 * of audio. The browser holds the session (the server never sees the stream),
 * so the console adds the turns up and hands the totals over when the
 * conversation closes; the server prices them (src/lib/ai/voice/budget.ts).
 *
 * The same split as the phone line's (scripts/pbx/fanum-zeytun-inbound.py,
 * `add_usage`): text and audio as the provider marks them, and the tokens it
 * reports with no modality apart — `otherIn`, `otherOut`. Until 2026-11-22
 * those went into the audio column, «the dearer kind», and the Google bill
 * showed that Google does not charge them as audio (`LiveTokenCounts` in
 * src/lib/ai/gateway/pricing.ts): the server prices them as text.
 */
import type { LiveTokenCounts } from "@/lib/ai/gateway/pricing"

export type LiveUsageTotals = LiveTokenCounts & { turns: number }

type ModalityCount = { modality?: string; tokenCount?: number }
export type LiveUsageMetadata = {
  promptTokenCount?: number
  responseTokenCount?: number
  thoughtsTokenCount?: number
  toolUsePromptTokenCount?: number
  promptTokensDetails?: ModalityCount[]
  responseTokensDetails?: ModalityCount[]
}

export const EMPTY_LIVE_USAGE: LiveUsageTotals = Object.freeze({ textIn: 0, audioIn: 0, otherIn: 0, textOut: 0, audioOut: 0, otherOut: 0, turns: 0 })

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

/**
 * One side of a turn: what the provider marked as text, what it marked as
 * anything else (audio — a voice session carries nothing else; the dearer
 * kind if it ever does), and the rest of the total, which it did not mark.
 */
function split(details: ModalityCount[] | undefined, total: unknown): { text: number; audio: number; other: number } {
  let text = 0
  let audio = 0
  for (const detail of Array.isArray(details) ? details : []) {
    if (detail?.modality === "TEXT") text += count(detail.tokenCount)
    else audio += count(detail?.tokenCount)
  }
  return { text, audio, other: Math.max(0, count(total) - text - audio) }
}

/** The totals with one turn's `usageMetadata` added. */
export function addLiveUsage(totals: LiveUsageTotals, usage: LiveUsageMetadata): LiveUsageTotals {
  const input = split(usage.promptTokensDetails, usage.promptTokenCount)
  // A prompt with no breakdown at all says nothing of what it holds — not seen
  // in 951 stand turns, every one of which marks its text — and is counted as
  // audio, the dearer kind, as before. A response with none is a function
  // call: no sound was made.
  if (input.text + input.audio === 0) {
    input.audio = input.other
    input.other = 0
  }
  const output = split(usage.responseTokensDetails, usage.responseTokenCount)
  return {
    // Tool results go back to the model as text input.
    textIn: totals.textIn + input.text + count(usage.toolUsePromptTokenCount),
    audioIn: totals.audioIn + input.audio,
    otherIn: (totals.otherIn ?? 0) + input.other,
    // Thinking is billed as output text.
    textOut: totals.textOut + output.text + count(usage.thoughtsTokenCount),
    audioOut: totals.audioOut + output.audio,
    otherOut: (totals.otherOut ?? 0) + output.other,
    turns: totals.turns + 1,
  }
}

/** A session's longest run is minutes; anything beyond these is not a real count. */
const MAX_TOKENS = 50_000_000
const MAX_TURNS = 10_000

/**
 * The totals a console sent, or null for anything that is not a plausible
 * count. A console loaded before the split sends no `otherIn` / `otherOut`
 * (its audio columns hold them); present, they must be counts too.
 *
 * No turns and no tokens is a count as well: the model never answered, Google
 * sent no `usageMetadata`, and the conversation cost its listening alone
 * (budget.ts prices it by that). Tokens with no turn is not a count.
 */
export function parseLiveUsage(raw: unknown): LiveUsageTotals | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  const field = (name: keyof LiveUsageTotals, max: number) => {
    const n = value[name]
    return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max ? n : null
  }
  const totals = {
    textIn: field("textIn", MAX_TOKENS),
    audioIn: field("audioIn", MAX_TOKENS),
    textOut: field("textOut", MAX_TOKENS),
    audioOut: field("audioOut", MAX_TOKENS),
    turns: field("turns", MAX_TURNS),
  }
  if (Object.values(totals).some((n) => n === null)) return null
  const other: { otherIn?: number; otherOut?: number } = {}
  for (const name of ["otherIn", "otherOut"] as const) {
    if (value[name] === undefined) continue
    const n = field(name, MAX_TOKENS)
    if (n === null) return null
    other[name] = n
  }
  const all = { ...totals, ...other } as LiveUsageTotals
  if (all.turns > 0) return all
  const tokens = [all.textIn, all.audioIn, all.textOut, all.audioOut, all.otherIn ?? 0, all.otherOut ?? 0]
  return tokens.every((n) => n === 0) ? all : null
}
