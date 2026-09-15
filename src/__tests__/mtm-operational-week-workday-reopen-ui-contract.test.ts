import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  WORKFORCE_WORKDAY_MANAGER_ACTION_DENIAL_CODES,
  WORKFORCE_WORKDAY_REOPEN_CONFLICT_CODES,
  WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH,
  WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH,
  WORKFORCE_WORKDAY_REOPEN_UNDO_CONFLICT_CODES,
} from "@/lib/workforce/workday-reopen-contract"

/**
 * Owner decision 2026-09-15: a manager reopens an employee's finished day from
 * the operational week, or undoes that reopen, with a mandatory reason. These
 * pins keep the dialog honest about what the server allows and says.
 */
const ui = readFileSync("src/components/mtm/operational-week-home.tsx", "utf8")
const LOCALES = ["az", "ru", "en"] as const
const managerWorkdayMessages = Object.fromEntries(LOCALES.map((locale) => [
  locale,
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmDashboardPage.operationalWeek.managerWorkday,
]))

/** The source from `start` up to the next `end` after it. */
function sourceBetween(start: string, end: string): string {
  const from = ui.indexOf(start)
  const to = from < 0 ? -1 : ui.indexOf(end, from + start.length)
  expect([start, from >= 0 && to > from]).toEqual([start, true])
  return ui.slice(from, to)
}

describe("operational week: manager reopen of today's workday", () => {
  it("offers reopen or undo only as the week API allows, in the manager branch of the workday cell", () => {
    const controls = sourceBetween("function renderManagerWorkdayControls()", "\n  }\n")
    // Never on the agent's own view or from a saved snapshot; disabled while stale.
    expect(controls).toContain("if (!actions || !managerView || facts?.workdayCapability.canMutateSelf || cachedSnapshot) return null")
    expect(controls.match(/disabled=\{managerWorkdayPending \|\| !workdayMutationLive\}/g)).toHaveLength(2)
    expect(controls).toContain("if (actions.reopen.allowed)")
    expect(controls).toContain('data-testid="mtm-week-workday-reopen"')
    expect(controls).toContain('t("managerWorkday.reopenAction")')
    expect(controls).toContain("if (actions.undoReopen.allowed)")
    expect(controls).toContain('data-testid="mtm-week-workday-reopen-undo"')
    expect(controls).toContain('t("managerWorkday.undoAction")')

    // It takes the place of the read-only notice, right above the left-open banner.
    const slot = ui.indexOf(")) : renderManagerWorkdayControls() ?? <span")
    expect(slot).toBeGreaterThan(0)
    expect(slot).toBeLessThan(ui.indexOf('data-testid="mtm-week-workday-left-open"'))

    // An action arrives from workdayContext.managerActions and is offered only
    // together with the target and version the request needs.
    expect(ui).toContain("managerWorkdayActions: normalizeManagerWorkdayActions(workdayContext.managerActions)")
    expect(ui).toContain("allowed: source.allowed === true && Boolean(workdayId && updatedAt)")
  })

  it("explains a known refusal in one muted line instead of the button, but not an ordinary day state", () => {
    const controls = sourceBetween("function renderManagerWorkdayControls()", "\n  }\n")
    expect(controls).toContain('<span className="inline-flex items-center gap-2 text-xs text-muted-foreground" data-testid="mtm-week-workday-manager-blocked">')
    expect(controls).toContain("MANAGER_WORKDAY_EXPLAINED_REFUSALS.has(reason)")
    // The line names the action it explains (reopen or undo).
    expect(controls).toContain("managerWorkdayFailureMessage(actions[refusalKind].blockedReason, refusalKind)")

    const explained = sourceBetween("const MANAGER_WORKDAY_EXPLAINED_REFUSALS", "])")
    const listed = [...explained.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]).sort()
    expect(listed).toEqual([
      "WORKFORCE_ATTENDANCE_MFA_REQUIRED",
      "WORKFORCE_SCOPE_DENIED",
      "WORKFORCE_SESSION_PERMISSION_REQUIRED",
      "WORKFORCE_WORKDAY_REOPEN_CORRECTED",
      "WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING",
      "WORKFORCE_WORKDAY_REOPEN_HISTORY_INVALID",
      "WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS",
      "WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED",
      "WORKFORCE_WORKDAY_REOPEN_UNDO_HISTORY_INVALID",
    ])
  })

  it("opens a dialog with the consequence and one operation id per opening", () => {
    const open = sourceBetween("function openManagerWorkdayDialog(kind: ManagerWorkdayActionKind)", "\n  }\n")
    expect(open).toContain("if (!action?.allowed || !action.workdayId || !action.updatedAt) return")
    expect(open).toContain("expectedUpdatedAt: action.updatedAt")
    expect(open).toContain("operationId: clientOperationId(")
    expect(open).toContain('setManagerWorkdayReason("")')
    expect(sourceBetween("function clientOperationId(prefix: string)", "\n}\n")).toContain("crypto.randomUUID()")

    const dialog = sourceBetween("<Dialog open={Boolean(managerWorkdayTarget)}", "</Dialog>")
    expect(dialog).toContain('"managerWorkday.undoTitle" : "managerWorkday.reopenTitle"')
    expect(dialog).toContain('"managerWorkday.undoConsequence" : "managerWorkday.reopenConsequence"')
    expect(dialog).toContain('t("managerWorkday.historyNote")')
    expect(dialog).toContain('data-testid="mtm-week-workday-manager-error"')
    expect(dialog).toContain('role="alert"')
  })

  it("requires a reason of 3 to 1000 characters before the confirm button enables", () => {
    expect([WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH, WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH]).toEqual([3, 1000])
    expect(ui).toContain("const managerWorkdayReasonLength = managerWorkdayReason.trim().length")
    expect(ui).toContain("managerWorkdayReasonLength >= WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH")
    expect(ui).toContain("managerWorkdayReasonLength <= WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH")

    const dialog = sourceBetween("<Dialog open={Boolean(managerWorkdayTarget)}", "</Dialog>")
    expect(dialog).toContain("<Textarea")
    expect(dialog).toContain("maxLength={WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH}")
    expect(dialog).toContain("disabled={managerWorkdayPending || !managerWorkdayReasonValid || Boolean(managerWorkdayError?.final)}")

    const submit = sourceBetween("async function submitManagerWorkdayAction()", "\n  }\n")
    expect(submit).toContain("if (!target || managerWorkdayPending || !managerWorkdayReasonValid || managerWorkdayError?.final) return")
  })

  it("sends the operation id, the version the week showed and the trimmed reason, then refetches", () => {
    const submit = sourceBetween("async function submitManagerWorkdayAction()", "\n  }\n")
    expect(submit).toContain('const action = target.kind === "reopen" ? "reopen" : "reopen/undo"')
    expect(submit).toContain("`/api/v1/workforce/workdays/${encodeURIComponent(target.workdayId)}/${action}`")
    expect(submit).toContain("operationId: target.operationId")
    expect(submit).toContain("expectedUpdatedAt: target.expectedUpdatedAt")
    expect(submit).toContain("reason: managerWorkdayReason.trim()")
    expect(submit).toContain('toast.success(t(target.kind === "reopen" ? "managerWorkday.reopenSucceeded" : "managerWorkday.undoSucceeded"))')
    // A refusal keeps the dialog and the typed reason; a 409 also ends this attempt.
    expect(submit).toContain("const final = response.status === 409")
    expect(submit).toContain('managerWorkdayFailureMessage(firstString(result, "code"), target.kind, response.status)')
    expect(submit.match(/refreshAfterPlanMutation\(\)/g)).toHaveLength(2)
  })

  it("has a localized message for every 409 code of both endpoints, the denials and a missing MFA factor", () => {
    const table = sourceBetween("const MANAGER_WORKDAY_REFUSAL_MESSAGE_KEYS", "const MANAGER_WORKDAY_EXPLAINED_REFUSALS")
    const codes = [
      ...WORKFORCE_WORKDAY_REOPEN_CONFLICT_CODES,
      ...WORKFORCE_WORKDAY_REOPEN_UNDO_CONFLICT_CODES,
      ...WORKFORCE_WORKDAY_MANAGER_ACTION_DENIAL_CODES,
    ]
    expect(codes).toContain("WORKFORCE_ATTENDANCE_MFA_REQUIRED")
    expect(codes.filter((code) => !new RegExp(`\\b${code}: ["{]`).test(table))).toEqual([])

    const keys = [...new Set([
      ...[...table.matchAll(/\b\w+: "(\w+)"/g)].map((match) => match[1]),
      "forbidden",
      "rateLimited",
      "generic",
    ])]
    const missing: string[] = []
    for (const locale of LOCALES) {
      for (const key of keys) {
        const text = managerWorkdayMessages[locale]?.failure?.[key]
        if (typeof text !== "string" || !text.trim()) missing.push(`${locale}.managerWorkday.failure.${key}`)
      }
    }
    expect(missing).toEqual([])
    // The distinct refusals do not collapse into one generic sentence.
    expect(new Set(keys.map((key) => managerWorkdayMessages.az.failure[key])).size).toBe(keys.length)

    const message = sourceBetween("function managerWorkdayFailureMessage(code: string | null, kind: ManagerWorkdayActionKind, status = 0)", "\n  }\n")
    expect(message).toContain("if (key) return t(`managerWorkday.failure.${key}`)")
    expect(message).toContain('return t("managerWorkday.failure.generic")')
  })

  it("says before any reason is typed that the endpoints' mandatory 2FA is missing, and where it is switched on", () => {
    // The same code the Workforce access screen localizes, per action here.
    const access = readFileSync("src/components/workforce/workforce-access-management.tsx", "utf8")
    expect(access).toContain('if (code === "WORKFORCE_ATTENDANCE_MFA_REQUIRED") return t("mfaRequired")')
    expect(ui).toContain('WORKFORCE_ATTENDANCE_MFA_REQUIRED: { reopen: "mfaRequiredReopen", undoReopen: "mfaRequiredUndo" },')
    expect(sourceBetween("function managerWorkdayFailureMessageKey(", "\n}\n")).toContain('return typeof key === "string" ? key : key[kind]')
    // Explained in the workday cell instead of a button, so no dialog opens.
    expect(sourceBetween("const MANAGER_WORKDAY_EXPLAINED_REFUSALS", "])")).toContain('"WORKFORCE_ATTENDANCE_MFA_REQUIRED"')

    expect(managerWorkdayMessages.az.failure.mfaRequiredReopen).toBe("Günü bərpa etmək üçün hesabınızda 2FA məcburi olmalıdır — Parametrlər → İstifadəçilər")
    expect(managerWorkdayMessages.az.failure.mfaRequiredUndo).toBe("Bərpanı ləğv etmək üçün hesabınızda 2FA məcburi olmalıdır — Parametrlər → İstifadəçilər")
    const unclear: string[] = []
    for (const locale of LOCALES) {
      for (const key of ["mfaRequiredReopen", "mfaRequiredUndo"]) {
        const text = String(managerWorkdayMessages[locale]?.failure?.[key] ?? "")
        if (!text.includes("2FA") || !text.includes("→")) unclear.push(`${locale}.managerWorkday.failure.${key}`)
      }
    }
    expect(unclear).toEqual([])
  })

  it("speaks the owner's Azerbaijani and localizes every dialog string", () => {
    expect(managerWorkdayMessages.az.reopenAction).toBe("Günü bərpa et")
    expect(managerWorkdayMessages.az.undoAction).toBe("Bərpanı ləğv et")
    expect(managerWorkdayMessages.az.reopenConsequence).toContain("Agent iş gününü davam etdirə biləcək; bağlı olduğu vaxt fasilə sayılır, işə düşmür")
    expect(managerWorkdayMessages.az.undoConsequence).toContain("Gün ilkin bitmə vaxtında yenidən bağlanacaq")

    const used = [...new Set([...ui.matchAll(/"managerWorkday\.([A-Za-z]+)"/g)].map((match) => match[1]))]
    expect(used.length).toBeGreaterThan(10)
    const missing: string[] = []
    for (const locale of LOCALES) {
      for (const key of used) {
        const text = managerWorkdayMessages[locale]?.[key]
        if (typeof text !== "string" || !text.trim()) missing.push(`${locale}.managerWorkday.${key}`)
      }
      if (!String(managerWorkdayMessages[locale]?.reasonHint).includes("{count}")) missing.push(`${locale}.managerWorkday.reasonHint{count}`)
    }
    expect(missing).toEqual([])
  })
})
