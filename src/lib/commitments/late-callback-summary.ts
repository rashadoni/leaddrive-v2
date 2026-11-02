/**
 * How one promised callback is judged, and how a list of them adds up — the
 * arithmetic of the late-callback report without its database reads, so the
 * guided demo counts its invented week with the very rules the report uses.
 *
 * The rules themselves are explained in `late-callbacks.ts`: evidence (an
 * outbound call or message to that lead after the promise was made), never
 * whether somebody ticked the task.
 */

export type CallbackStatus = "on_time" | "late" | "missed"

export type SellerSummary = {
  sellerId: string | null
  sellerName: string
  promises: number
  onTime: number
  late: number
  missed: number
  /** Worst overrun in minutes among the late ones; null when none were late. */
  worstLateMinutes: number | null
}

export type LateCallbackTotals = { promises: number; onTime: number; late: number; missed: number }

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000))
}

/**
 * The first touch after the promise was made is the callback; it is on time
 * up to the promised moment plus the grace, late after it, and missing when
 * there is none.
 */
export function settleCallback(input: {
  promisedFor: Date
  /** When the promise was made — the task's creation, on the call itself. */
  madeAt: Date
  /** Outbound calls and messages to the lead, oldest first. */
  touches: readonly Date[]
  toleranceMinutes?: number
}): { contactedAt: Date | null; status: CallbackStatus; lateByMinutes: number | null } {
  const tolerance = Math.max(0, input.toleranceMinutes ?? 0)
  // The promise was made on the call that produced the task, so only a touch
  // after that moment can be the promised callback.
  const contactedAt = input.touches.find((at) => at >= input.madeAt) ?? null
  const deadline = new Date(input.promisedFor.getTime() + tolerance * 60_000)
  const status: CallbackStatus = !contactedAt
    ? "missed"
    : contactedAt <= deadline ? "on_time" : "late"
  return {
    contactedAt,
    status,
    lateByMinutes: status === "late" && contactedAt
      ? minutesBetween(deadline, contactedAt)
      : status === "on_time" ? 0 : null,
  }
}

/** Per seller, worst first, and the totals over every row. */
export function summarizeLateCallbacks(rows: ReadonlyArray<{
  sellerId: string | null
  sellerName: string
  status: CallbackStatus
  lateByMinutes: number | null
}>): { sellers: SellerSummary[]; totals: LateCallbackTotals } {
  const bySeller = new Map<string, SellerSummary>()
  for (const row of rows) {
    const key = row.sellerId ?? "__unassigned__"
    const summary = bySeller.get(key) ?? {
      sellerId: row.sellerId,
      sellerName: row.sellerId ? row.sellerName : "—",
      promises: 0, onTime: 0, late: 0, missed: 0, worstLateMinutes: null,
    }
    summary.promises += 1
    if (row.status === "on_time") summary.onTime += 1
    else if (row.status === "late") {
      summary.late += 1
      summary.worstLateMinutes = Math.max(summary.worstLateMinutes ?? 0, row.lateByMinutes ?? 0)
    } else summary.missed += 1
    bySeller.set(key, summary)
  }

  const sellers = [...bySeller.values()].sort(
    (a, b) => (b.missed + b.late) - (a.missed + a.late) || b.promises - a.promises,
  )
  return {
    sellers,
    totals: {
      promises: rows.length,
      onTime: rows.filter((r) => r.status === "on_time").length,
      late: rows.filter((r) => r.status === "late").length,
      missed: rows.filter((r) => r.status === "missed").length,
    },
  }
}
