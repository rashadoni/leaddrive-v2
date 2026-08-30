import { NextRequest, NextResponse } from "next/server"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"
import {
  recordWorkforceEmploymentEvent,
  resolveWorkforceHistoricalAssignment,
  WorkforceEmploymentEventCreateSchema,
  WorkforceEmploymentHistoryError,
} from "@/lib/workforce/employment-history"

const IDENTIFIER = /^[A-Za-z0-9_-]{1,191}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/**
 * Resolves a delayed Workforce claim from explicit lifecycle/team/site facts.
 * A result of UNKNOWN is intentional and must not be replaced by current
 * directory status, team or Route assignment data.
 */
export const GET = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const agentId = req.nextUrl.searchParams.get("agentId")
  const occurredAtRaw = req.nextUrl.searchParams.get("occurredAt")
  const workDate = req.nextUrl.searchParams.get("workDate")
  if (!agentId || !IDENTIFIER.test(agentId) || !occurredAtRaw || !ISO_INSTANT.test(occurredAtRaw) || !workDate || !isDateKey(workDate)) {
    return NextResponse.json({ error: "agentId, UTC occurredAt and workDate are required", code: "WORKFORCE_EMPLOYMENT_HISTORY_QUERY_INVALID" }, { status: 400 })
  }
  const occurredAt = new Date(occurredAtRaw)
  if (!Number.isFinite(occurredAt.getTime())) {
    return NextResponse.json({ error: "occurredAt is invalid", code: "WORKFORCE_EMPLOYMENT_HISTORY_QUERY_INVALID" }, { status: 400 })
  }
  try {
    const assignment = await resolveWorkforceHistoricalAssignment(prisma, {
      organizationId: auth.orgId,
      agentId,
      occurredAt,
      workDate,
    })
    if (!assignment) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { assignment } })
  } catch (error) {
    console.error("[workforce/configuration/employment-events GET]", error)
    return NextResponse.json({ error: "Failed to resolve Workforce employment history" }, { status: 500 })
  }
})

/** Appends one explicit HR lifecycle fact; existing facts cannot be edited. */
export const POST = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceEmploymentEventCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce employment event" }, { status: 400 })
  }
  try {
    const event = await recordWorkforceEmploymentEvent({
      organizationId: auth.orgId,
      recordedByUserId: auth.userId,
      event: parsed.data,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { event } }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceEmploymentHistoryError) {
      const status = error.code === "WORKFORCE_EMPLOYMENT_AGENT_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/employment-events POST]", error)
    return NextResponse.json({ error: "Failed to record Workforce employment event" }, { status: 500 })
  }
})
