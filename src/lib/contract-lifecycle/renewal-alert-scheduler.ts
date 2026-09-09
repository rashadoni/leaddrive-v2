/**
 * Renewal-alert scheduler — M5 Phase 6 Block C slice 1.
 *
 * Pure planner: given a Contract.endDate + an "as of" timestamp,
 * compute which ContractRenewalAlert windows should fire and when.
 *
 * Slice-2 calls this on:
 *   • Contract creation (with endDate set)
 *   • Contract endDate edit
 *   • Tenant-config edit (windows subset changed)
 * and UPSERTs into `contract_renewal_alerts` keyed by
 * `(contractId, daysBeforeExpiry)`.
 *
 * Slice-2 cron polls `WHERE status = 'pending' AND dueAt <= now()`
 * and dispatches to delivery channels (Slack/email/in-app).
 *
 * Past-due windows (endDate is sooner than today + window) are
 * intentionally OMITTED from the result. Scheduling at-or-after the
 * window has already missed its purpose — flooding a finance manager
 * with "60-day renewal alert!" when the contract expires in 3 days is
 * worse than silence. They're surfaced via `skippedPastDue` so the
 * caller can log "contract created 5 days before expiry; 90/60/30/
 * 14-day alerts skipped".
 *
 * Pure synchronous.
 */
import {
  RENEWAL_ALERT_WINDOWS,
  type RenewalAlertWindow,
  type ScheduleAlertsInput,
  type ScheduleAlertsResult,
  type ScheduledAlert,
} from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

function isWindow(n: number): n is RenewalAlertWindow {
  return (RENEWAL_ALERT_WINDOWS as readonly number[]).includes(n)
}

export function scheduleRenewalAlerts(input: ScheduleAlertsInput): ScheduleAlertsResult {
  const { endDate, asOf } = input

  // No endDate → no alerts. Caller may treat this as "perpetual" contract.
  if (!endDate || !(endDate instanceof Date) || !Number.isFinite(endDate.getTime())) {
    return { alerts: [], skippedPastDue: [] }
  }
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
    return { alerts: [], skippedPastDue: [] }
  }

  // Resolve which windows the caller wants. Defensive: filter to known windows.
  const requestedWindows: readonly RenewalAlertWindow[] =
    input.windows && input.windows.length > 0
      ? input.windows.filter(isWindow)
      : RENEWAL_ALERT_WINDOWS

  const alerts: ScheduledAlert[] = []
  const skippedPastDue: RenewalAlertWindow[] = []

  // Sort windows largest-first so the resulting alerts array is in
  // chronological order (90-day fires before 7-day).
  const sortedDesc = [...requestedWindows].sort((a, b) => b - a)

  for (const w of sortedDesc) {
    const dueAt = new Date(endDate.getTime() - w * MS_PER_DAY)
    // At-boundary semantic: `dueAt <= asOf` is treated as past-due
    // (skipped). Defensible because firing a "your contract expires
    // in N days" reminder ON day-of-window (same wall-clock as the
    // contract creation) provides no advance warning. Strict-`<`
    // alternative is documented in `architect-review` notes; revisit
    // in slice 2 once we have UI feedback on which feels right.
    if (dueAt.getTime() <= asOf.getTime()) {
      skippedPastDue.push(w)
      continue
    }
    alerts.push({ daysBeforeExpiry: w, dueAt })
  }

  return { alerts, skippedPastDue }
}
