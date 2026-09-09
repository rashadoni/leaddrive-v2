/**
 * The authoritative business result of one completed call attempt.
 *
 * Keep this separate from `Lead.salesCallOutcomes`, which stores the lead's
 * current multi-select sales qualification, and from
 * `CallLog.conversationOutcome`, which stores PBX/provider finality evidence.
 */
export const CALL_DISPOSITIONS = [
  "interested",
  "not_interested",
  "callback",
  "voicemail",
  "wrong_number",
  "no_answer",
  "other",
] as const

export type CallDisposition = (typeof CALL_DISPOSITIONS)[number]

// The leads queue intentionally favors the five fastest, actionable choices.
// It remains a subset of the canonical vocabulary rather than a second enum.
export const QUICK_CALL_DISPOSITIONS = [
  "interested",
  "callback",
  "no_answer",
  "not_interested",
  "wrong_number",
] as const satisfies readonly CallDisposition[]

export const CALL_DISPOSITION_I18N_KEYS = {
  interested: "outcomeInterested",
  not_interested: "outcomeNotInterested",
  callback: "outcomeCallback",
  voicemail: "outcomeVoicemail",
  wrong_number: "outcomeWrongNumber",
  no_answer: "outcomeNoAnswer",
  other: "outcomeOther",
} as const satisfies Record<CallDisposition, string>

const CALL_DISPOSITION_SET = new Set<string>(CALL_DISPOSITIONS)

export function isCallDisposition(value: unknown): value is CallDisposition {
  return typeof value === "string" && CALL_DISPOSITION_SET.has(value)
}
