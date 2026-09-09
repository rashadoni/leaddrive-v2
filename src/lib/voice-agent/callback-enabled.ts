/**
 * Whether automatic callback may dial at all.
 *
 * Two independent switches, both fail-closed, because this is the one feature
 * in the voice agent that originates a call with no human in the loop.
 *
 *   - `VOICE_AUTOMATIC_CALLBACK_DISABLED` is the emergency brake. It is an env
 *     var rather than a setting on purpose: stopping a misbehaving dialler must
 *     not depend on the database being reachable, on RLS resolving, or on
 *     anyone finding the right screen.
 *   - `automaticCallbackEnabled` on the voice channel config is the ordinary
 *     switch, and it defaults to **off**. A feature that phones customers by
 *     itself should start silent and be turned on deliberately, not arrive
 *     switched on with a deploy.
 *
 * The owner decided that automatic callback keeps working when *manual* AI
 * calls are switched off, since a callback continues a conversation that was
 * already authorised. That decision is what makes this dedicated switch
 * necessary: without it, `manualLeadAiCallsEnabled` would no longer be able to
 * stop every outbound call, and there would be nothing that could.
 */

export type CallbackGateRefusal = "kill_switch" | "not_enabled"

export type CallbackGate =
  | { allowed: true }
  | { allowed: false; reason: CallbackGateRefusal }

function killSwitchEngaged(env: NodeJS.ProcessEnv): boolean {
  const raw = (env.VOICE_AUTOMATIC_CALLBACK_DISABLED ?? "").trim().toLowerCase()
  // Anything set and not an explicit negation stops the dialler. An operator
  // reaching for this is trying to make calls stop, so an unrecognised value
  // must brake rather than be ignored as a typo.
  if (!raw) return false
  return !["0", "false", "no", "off"].includes(raw)
}

export function callbackGate(params: {
  settings: unknown
  env?: NodeJS.ProcessEnv
}): CallbackGate {
  if (killSwitchEngaged(params.env ?? process.env)) {
    return { allowed: false, reason: "kill_switch" }
  }
  const settings = (params.settings || {}) as Record<string, unknown>
  // Strict true: a missing key, a string "true", or any other truthy shape is
  // treated as not configured. Guessing here would switch on a dialler for an
  // organisation that never asked for one.
  if (settings.automaticCallbackEnabled !== true) {
    return { allowed: false, reason: "not_enabled" }
  }
  return { allowed: true }
}
