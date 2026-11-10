/**
 * What a Gemini Live conversation used, as Google counts it: every model turn
 * arrives with `usageMetadata` for that turn — and each turn bills the whole
 * conversation so far again, so a minute of talk costs far more than a minute
 * of audio. The browser holds the session (the server never sees the stream),
 * so the console adds the turns up and hands the totals over when the
 * conversation closes; the server prices them (src/lib/ai/voice/budget.ts).
 *
 * The same split as the phone line's (scripts/pbx/fanum-zeytun-inbound.py,
 * `add_usage`): tokens the provider does not mark as text are counted as
 * audio, the dearer kind — an estimate errs high, never low.
 */

export type LiveUsageTotals = {
  textIn: number
  audioIn: number
  textOut: number
  audioOut: number
  turns: number
}

type ModalityCount = { modality?: string; tokenCount?: number }
export type LiveUsageMetadata = {
  promptTokenCount?: number
  responseTokenCount?: number
  thoughtsTokenCount?: number
  toolUsePromptTokenCount?: number
  promptTokensDetails?: ModalityCount[]
  responseTokensDetails?: ModalityCount[]
}

export const EMPTY_LIVE_USAGE: LiveUsageTotals = Object.freeze({ textIn: 0, audioIn: 0, textOut: 0, audioOut: 0, turns: 0 })

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

function split(details: ModalityCount[] | undefined, total: unknown): { text: number; audio: number } {
  const text = (Array.isArray(details) ? details : [])
    .filter((detail) => detail?.modality === "TEXT")
    .reduce((sum, detail) => sum + count(detail.tokenCount), 0)
  return { text, audio: Math.max(0, count(total) - text) }
}

/** The totals with one turn's `usageMetadata` added. */
export function addLiveUsage(totals: LiveUsageTotals, usage: LiveUsageMetadata): LiveUsageTotals {
  const input = split(usage.promptTokensDetails, usage.promptTokenCount)
  const output = split(usage.responseTokensDetails, usage.responseTokenCount)
  return {
    // Tool results go back to the model as text input.
    textIn: totals.textIn + input.text + count(usage.toolUsePromptTokenCount),
    audioIn: totals.audioIn + input.audio,
    // Thinking is billed as output text.
    textOut: totals.textOut + output.text + count(usage.thoughtsTokenCount),
    audioOut: totals.audioOut + output.audio,
    turns: totals.turns + 1,
  }
}

/** A session's longest run is minutes; anything beyond these is not a real count. */
const MAX_TOKENS = 50_000_000
const MAX_TURNS = 10_000

/** The totals a console sent, or null for anything that is not a plausible count. */
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
  return (totals.turns ?? 0) > 0 ? (totals as LiveUsageTotals) : null
}
