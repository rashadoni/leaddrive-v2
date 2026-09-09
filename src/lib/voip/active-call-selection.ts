export type VoipPopupCall = {
  id: string
  direction: string
  status: string
  provider?: string | null
  claimedByUserId?: string | null
  browserAnswerClaimExpiresAt?: string | Date | null
}

const ACTIVE_WHATSAPP_STATUSES = new Set(["initiated", "ringing", "in-progress"])
const ACTIVE_ASTERISK_BROWSER_STATUSES = new Set(["ringing", "answering", "in-progress"])

function claimExpiresAtMs(value: VoipPopupCall["browserAnswerClaimExpiresAt"]): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value !== "string") return Number.NaN
  return Date.parse(value)
}

/**
 * Pick the one call that should own the global popup.
 *
 * The server already hides another seller's current Asterisk claim. Repeating
 * the rule here is intentional defence-in-depth for a polling response that
 * was fetched just before a competing atomic claim committed.
 */
export function selectVoipPopupCall<T extends VoipPopupCall>(
  calls: readonly T[],
  dismissedIds: ReadonlySet<string>,
  currentUserId: string | null,
  now: number = Date.now(),
): T | undefined {
  return calls.find((call) => {
    if (dismissedIds.has(call.id)) return false

    if (call.provider === "asterisk" && call.direction === "inbound") {
      if (!ACTIVE_ASTERISK_BROWSER_STATUSES.has(call.status)) return false
      if (call.status === "ringing") {
        const freshClaim = Boolean(call.claimedByUserId)
          && claimExpiresAtMs(call.browserAnswerClaimExpiresAt) > now
        return !freshClaim || call.claimedByUserId === currentUserId
      }
      return Boolean(currentUserId) && call.claimedByUserId === currentUserId
    }

    if (call.direction === "inbound" && call.status === "ringing") return true
    return call.provider === "whatsapp"
      && call.direction === "outbound"
      && ACTIVE_WHATSAPP_STATUSES.has(call.status)
      && Boolean(currentUserId)
      && call.claimedByUserId === currentUserId
  })
}
