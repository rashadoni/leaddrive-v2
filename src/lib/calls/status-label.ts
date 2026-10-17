/**
 * The `voip.statusLabels` key for a call's status. The call log had this map
 * to itself, and the call widget printed the raw status instead — «initiated»,
 * «ringing» in English on an Azerbaijani screen.
 */
const CALL_STATUS_LABEL_KEYS: Record<string, string> = {
  initiated: "initiated",
  ringing: "ringing",
  "in-progress": "inProgress",
  completed: "completed",
  "no-answer": "noAnswer",
  busy: "busy",
  failed: "failed",
  canceled: "canceled",
}

export function callStatusLabelKey(status: string): string {
  return CALL_STATUS_LABEL_KEYS[status] ?? "unknown"
}
