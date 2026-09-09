/**
 * One call may be analysed, retried, and labelled manually in either order.
 * A database primary key is the only race-proof natural identity shared by all
 * of those writers; the JSON marker remains useful for legacy rows and reads.
 */
export const COMMITMENT_CALL_FIELD = "commitmentCallId"

export function callbackReminderId(callId: string): string {
  return `call_callback_${callId}`
}
