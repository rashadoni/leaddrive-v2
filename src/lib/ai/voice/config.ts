/**
 * Voice-console configuration. Everything here is env-driven on purpose: the
 * pilot allowlist must not be self-serviceable from inside the app.
 *
 * `PATCH /api/v1/settings/ai-features` can already flip org feature flags, and
 * `UserPreference` rows are written by their own owner — so a DB-backed pilot
 * flag would be a grant the grantee can issue to themselves. Changing who has
 * voice therefore requires a deploy, which is the point.
 */

/**
 * Numeric env with a fallback that survives an EMPTY value.
 *
 * `??` only catches null/undefined, so `process.env.X ?? 300` keeps `""` — and
 * `Number("")` is 0, not NaN, so the zero propagates silently instead of
 * failing loudly. That is not hypothetical: the secret-delivery workflow
 * exports every variable into the remote shell, including ones whose GitHub
 * secret was never set, and `pm2 restart --update-env` then injects them as
 * empty strings. A budget of `Number("") * 60 = 0` made every voice session
 * report "monthly minutes exhausted" on a completely unused budget.
 */
function envNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Hard ceiling per conversation. Also the amount reserved up-front. */
export const MAX_SESSION_SECONDS = envNumber(process.env.VOICE_MAX_SESSION_SECONDS, 300)

/** Per-user monthly budget for the CRM voice assistant. */
export const MONTHLY_BUDGET_SECONDS = envNumber(process.env.VOICE_MONTHLY_MINUTES, 120) * 60

/**
 * Tool calls allowed in one conversation. A runaway agent loop is the cheapest
 * way to burn both minutes and LLM tokens, and it looks like normal traffic.
 */
export const MAX_TOOL_CALLS = envNumber(process.env.VOICE_MAX_TOOL_CALLS, 40)

/** A session with no heartbeat for this long is presumed dead and settled in full. */
export const HEARTBEAT_GRACE_SECONDS = 90

/** Client heartbeat cadence; the reaper's grace is deliberately several beats. */
export const HEARTBEAT_INTERVAL_SECONDS = 15

/** Conversation token lifetime. Short: it only needs to survive the handshake. */
export const SESSION_TOKEN_TTL_SECONDS = 360

export type VoicePilotConfig = {
  orgId: string | null
  userIds: string[]
  realtimeProvider: string | null
  geminiApiKey: string | null
}

/**
 * Read fresh on every call rather than at module load: the value must not be
 * frozen into a warm lambda/PM2 process after a deploy changes it.
 */
export function readVoicePilotConfig(): VoicePilotConfig {
  const raw = process.env.VOICE_PILOT_USER_IDS ?? ""
  return {
    orgId: process.env.VOICE_PILOT_ORG_ID || null,
    userIds: raw.split(",").map((s) => s.trim()).filter(Boolean),
    realtimeProvider: process.env.VOICE_REALTIME_PROVIDER || null,
    // The browser never receives this long-lived key. The token route uses it
    // only to mint a single-use Gemini Live ephemeral token.
    geminiApiKey: process.env.GEMINI_API_KEY || null,
  }
}

/** Tenant-local month key for the usage row, e.g. "2026-08". */
export function yearMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
}
