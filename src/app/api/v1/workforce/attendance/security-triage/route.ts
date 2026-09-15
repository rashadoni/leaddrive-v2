import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import { requireWorkforceAttendanceAdminAddon } from "@/lib/workforce/attendance-route"
import {
  triageWorkforceAttendanceSecurity,
  WORKFORCE_ATTENDANCE_TRIAGE_ACTION_WINDOW_MS,
  WORKFORCE_ATTENDANCE_TRIAGE_ENROLLMENT_WINDOW_MS,
} from "@/lib/workforce/attendance-security-triage"

const MAX_TRIAGE_AGENTS = 500

function requestAuditContext(req: NextRequest) {
  const ipAddress = clientIp(req)
  return {
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}

/**
 * A bounded, read-only security triage. It surfaces review prompts but never
 * labels fraud, changes device/workday state or records device identifiers in
 * audit/general logs. C6 owns the eventual accountable case lifecycle.
 */
export const GET = withWorkforceRlsAuth("read", async (req: NextRequest, auth) => {
  const denied = await requireWorkforceAttendanceAdminAddon(auth.orgId, auth, "deviceTrust")
  if (denied) return denied

  const now = new Date()
  const actionSince = new Date(now.getTime() - WORKFORCE_ATTENDANCE_TRIAGE_ACTION_WINDOW_MS)
  const enrollmentSince = new Date(now.getTime() - WORKFORCE_ATTENDANCE_TRIAGE_ENROLLMENT_WINDOW_MS)
  try {
    const agents = await prisma.mtmAgent.findMany({
      where: { organizationId: auth.orgId, status: "ACTIVE" },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: MAX_TRIAGE_AGENTS + 1,
      select: { id: true, name: true },
    })
    if (agents.length > MAX_TRIAGE_AGENTS) {
      return NextResponse.json({
        error: "Too many active employees for one security triage; narrow the cohort before review",
        code: "WORKFORCE_ATTENDANCE_TRIAGE_LIMIT_EXCEEDED",
      }, { status: 413 })
    }
    const agentIds = agents.map((agent) => agent.id)
    const [deviceVerificationRows, enrollmentRows, actionRows] = await Promise.all([
      agentIds.length === 0
        ? Promise.resolve([])
        : prisma.workforceAttendanceVerification.groupBy({
            by: ["agentId", "deviceEnrollmentId"],
            where: {
              organizationId: auth.orgId,
              agentId: { in: agentIds },
              deviceEnrollmentId: { not: null },
              verifiedAt: { gte: actionSince },
            },
          }),
      agentIds.length === 0
        ? Promise.resolve([])
        : prisma.workforceAttendanceDeviceEnrollment.groupBy({
            by: ["agentId"],
            where: {
              organizationId: auth.orgId,
              agentId: { in: agentIds },
              createdAt: { gte: enrollmentSince },
            },
            _count: { _all: true },
          }),
      agentIds.length === 0
        ? Promise.resolve([])
        : prisma.mtmAgentWorkdayEvent.groupBy({
            by: ["agentId"],
            where: {
              organizationId: auth.orgId,
              agentId: { in: agentIds },
              serverReceivedAt: { gte: actionSince },
              // A manager's reopen is journalled on the employee's workday but
              // is not an attendance action the employee performed.
              type: { not: "REOPEN" },
            },
            _count: { _all: true },
          }),
    ])
    const report = triageWorkforceAttendanceSecurity({
      agents,
      deviceVerificationRows,
      enrollmentRows: enrollmentRows.map((row) => ({ agentId: row.agentId, count: row._count._all })),
      actionRows: actionRows.map((row) => ({ agentId: row.agentId, count: row._count._all })),
    })
    const riskCodes = [...new Set(report.reviewCandidates.flatMap((candidate) => candidate.riskCodes))].sort()
    const audit = requestAuditContext(req)
    await prisma.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        action: "WORKFORCE_ATTENDANCE_SECURITY_TRIAGE_VIEWED",
        entity: "workforce_attendance_security_triage",
        entityId: now.toISOString(),
        metadataKind: "workforce_attendance_security",
        newData: {
          observedAt: now.toISOString(),
          examinedAgents: report.examinedAgents,
          reviewCandidateCount: report.reviewCandidates.length,
          riskCodes,
          actionWindowSeconds: WORKFORCE_ATTENDANCE_TRIAGE_ACTION_WINDOW_MS / 1_000,
          enrollmentWindowSeconds: WORKFORCE_ATTENDANCE_TRIAGE_ENROLLMENT_WINDOW_MS / 1_000,
          // No employee, workday, device, QR, token, proof or coordinate ID
          // is copied into the general audit payload.
        },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      },
    })
    return NextResponse.json({
      success: true,
      data: {
        observedAt: now.toISOString(),
        report,
        disposition: "REVIEW_REQUIRED_NO_AUTOMATIC_ACTION",
      },
    }, {
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch (error) {
    console.error("[workforce/attendance/security-triage GET]", error)
    return NextResponse.json({ error: "Failed to triage Workforce attendance security" }, { status: 500 })
  }
})
