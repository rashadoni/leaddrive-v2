import { NextResponse } from "next/server"
import { z } from "zod"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { hasMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { checkRateLimit } from "@/lib/rate-limit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { returnOwnMtmWorkday } from "@/lib/mtm/workday-return"
import { prisma } from "@/lib/prisma"
import { requireAttendanceSelf } from "@/lib/mtm/attendance-self-access"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"

/** A person returns to a day a handful of times at most; this stops a loop, not a person. */
const RETURN_RATE_LIMIT = { maxRequests: 20, windowMs: 60 * 60_000 }

const bodySchema = z.object({
  /** The app's own id of this tap: a repeated sending is the same return. */
  operationId: z.string().trim().min(8).max(128),
  workdayId: z.string().trim().min(1).max(128),
}).strict()

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, { ...init, headers })
}

/**
 * POST /api/v2/mtm/mobile/route-field/workday-return
 *
 * The employee returns to the workday they closed earlier today (owner,
 * 2026-10-13 — see src/lib/mtm/workday-return.ts). Their own day only, the same
 * calendar day only; the closure and the return both stay in the journal and
 * the time between them is not worked time.
 *
 * Whoever may start and finish a workday in the app may return to it: the same
 * capability the sync endpoint asks of a workday operation.
 */
export const POST = withMobileRls(async (req, auth) => {
  const attendanceOnly = !hasMobileCapability(auth.role, "FIELD_EXECUTE")
  // An office employee's own day is Personnel (sold apart from routes since 2026-10-14).
  if (!auth.agentId || (attendanceOnly && auth.tenantCapabilities?.personnel!==true)) {
    return noStoreJson({ error: "Forbidden", code: "MTM_WORKDAY_RETURN_FORBIDDEN" }, { status: 403 })
  }
  if (attendanceOnly) {
    try {
      await requireAttendanceSelf(prisma,{organizationId:auth.orgId,agentId:auth.agentId,role:auth.role},"attendanceWorkday")
    } catch (error) {
      if (!(error instanceof AttendanceRequestError)) return noStoreJson({error:"Attendance access unavailable"},{status:503})
      return noStoreJson({error:"Forbidden",code:"MTM_WORKDAY_RETURN_FORBIDDEN"},{status:403})
    }
  }
  if (!checkRateLimit(`mtm-workday-return:${auth.orgId}:${auth.agentId}`, RETURN_RATE_LIMIT)) {
    return noStoreJson({ error: "Too many requests", code: "MTM_WORKDAY_RETURN_RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "600" } })
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return noStoreJson({ error: parsed.error.issues[0]?.message || "Invalid request", code: "MTM_WORKDAY_RETURN_INVALID" }, { status: 400 })
  }

  let result
  try { result = await returnOwnMtmWorkday({
    organizationId: auth.orgId,
    agentId: auth.agentId,
    workdayId: parsed.data.workdayId,
    operationId: parsed.data.operationId,
    installationId: req.headers.get("x-field-device-id"),
    ...(attendanceOnly?{attendanceRole:auth.role}:{}),
  }) } catch(error) {
    if (!(error instanceof AttendanceRequestError)) throw error
    if (["MTM_ATTENDANCE_INSTALLATION_APP_REQUIRED", "MTM_ATTENDANCE_INSTALLATION_APPROVAL_REQUIRED"].includes(error.code)) {
      return noStoreJson({ error: error.code, code: error.code, data: { committed: false } }, { status: 409 })
    }
    return noStoreJson({error:"Forbidden",code:"MTM_WORKDAY_RETURN_FORBIDDEN"},{status:403})
  }
  if (result.kind === "not_found") {
    return noStoreJson({ error: "Workday not found", code: "MTM_WORKDAY_NOT_FOUND" }, { status: 404 })
  }
  if (result.kind === "conflict") {
    return noStoreJson({
      error: "The workday cannot be returned to",
      code: result.code,
      data: { workday: result.workday ?? null },
    }, { status: 409 })
  }

  if (!result.idempotent) {
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      action: "WORKDAY_RETURN",
      entity: "workday",
      entityId: result.workday.id,
      metadataKind: "workday_return",
      newData: { status: result.workday.status, totalPausedSeconds: result.workday.totalPausedSeconds },
      req,
    }).catch((error) => console.warn("[MTM/route-field/workday-return] audit failed", error))
  }
  return noStoreJson({ success: true, data: { workday: result.workday }, idempotent: result.idempotent })
// The same as the sync endpoint that carries START and FINISH: a workday is the
// field session itself, not a function of one purchased module. A v2 handler
// that states nothing here is refused by the wrapper.
}, { requiredCapability: null })
