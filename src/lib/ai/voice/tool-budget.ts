/**
 * Ceilings on how much the model may do in one breath (roadmap V1.8).
 *
 * The provider decides how many tools to call and how often; nothing in the
 * protocol stops it from calling twenty in a row, or from retrying a proposal
 * the server keeps refusing. Three things already exist and none of them is
 * this: a 15-second timeout on each read call, a stop after two consecutive
 * tool failures, and a server-side rate limit of twenty proposals a minute.
 *
 * A rate limit is not a ceiling. Over an hour-long session twenty a minute is
 * twelve hundred, and the failure it permits is the one the owner would feel:
 * a model that cannot get its draft accepted keeps trying, each attempt costs
 * a name lookup and a refused write, and the user hears the assistant talking
 * about what it is doing instead of doing it.
 *
 * So the budget is counted, not paced, and it is counted in the browser
 * because that is where the loop runs. Two limits, because they catch
 * different shapes:
 *
 * - per turn, so one answer cannot spend a minute gathering data;
 * - per session, so a slow leak across many turns still ends.
 *
 * Exceeding a ceiling is not an error state. The tool returns a sentence
 * telling the model to stop and ask the user, which is what a person would do
 * on the tenth failed attempt.
 */

export const VOICE_TOOL_BUDGET = {
  /** Read calls the model may make while composing one answer. */
  callsPerTurn: 8,
  /** Read calls for the whole conversation. */
  callsPerSession: 120,
  /**
   * Proposal attempts per conversation, successful or not. Deliberately small:
   * a person preparing more than a handful of CRM actions in one conversation
   * is not the case this pilot serves, and a model looping on a refusal is.
   */
  proposalsPerSession: 12,
} as const

export type VoiceToolKind = "read" | "propose"

export type VoiceToolBudgetVerdict =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "turn_exhausted" | "session_exhausted" | "proposals_exhausted" }>

export type VoiceToolBudget = Readonly<{
  /** Claim one call. A refusal is final for this turn or session. */
  claim: (kind: VoiceToolKind) => VoiceToolBudgetVerdict
  /** The provider finished an answer; the per-turn allowance starts again. */
  endTurn: () => void
  counts: () => Readonly<{ turn: number; session: number; proposals: number }>
}>

export function createVoiceToolBudget(
  limits: typeof VOICE_TOOL_BUDGET = VOICE_TOOL_BUDGET,
): VoiceToolBudget {
  let turn = 0
  let session = 0
  let proposals = 0

  return {
    claim: (kind) => {
      if (kind === "propose") {
        // Proposals are counted separately and are NOT reset by a turn: the
        // loop this guards against spans turns, because each refusal ends the
        // turn that carried it.
        if (proposals >= limits.proposalsPerSession) {
          return { ok: false, reason: "proposals_exhausted" }
        }
        proposals += 1
        return { ok: true }
      }
      if (session >= limits.callsPerSession) return { ok: false, reason: "session_exhausted" }
      if (turn >= limits.callsPerTurn) return { ok: false, reason: "turn_exhausted" }
      turn += 1
      session += 1
      return { ok: true }
    },
    endTurn: () => {
      turn = 0
    },
    counts: () => ({ turn, session, proposals }),
  }
}

/**
 * What the model is told when it runs out.
 *
 * Addressed to the model, so it reads as an instruction rather than an error:
 * the useful behaviour here is to stop, say something true to the user, and
 * wait — not to retry with different arguments.
 */
export function voiceToolBudgetMessage(
  reason: Exclude<VoiceToolBudgetVerdict, { ok: true }>["reason"],
): string {
  if (reason === "turn_exhausted") {
    return "TOOL_BUDGET_TURN: you have read enough for one answer. Answer now with what you already have, and say plainly if something is still missing. Do not call another tool before the user speaks again."
  }
  if (reason === "proposals_exhausted") {
    return "TOOL_BUDGET_PROPOSALS: you have prepared too many drafts in this conversation. Stop preparing anything, tell the user plainly that they should finish or cancel the draft on screen, and wait for them."
  }
  return "TOOL_BUDGET_SESSION: this conversation has used its tool budget. Tell the user you cannot look anything else up in this conversation and suggest starting a new one. Do not call another tool."
}
