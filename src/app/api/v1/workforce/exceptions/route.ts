import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionExceptionQueueAuth } from "@/lib/with-workforce-rls-auth"
import {
  projectWorkforceExceptionQueueItem,
  workforceExceptionQueueEmployeeResponseState,
} from "@/lib/workforce/exception-queue"

const MAX_EXCEPTION_CASES = 250

/**
 * Read-only C6 review queue. Generic decision codes are projected into a
 * safe HR lifecycle view. Raw evidence, decision reasons and mutable actions
 * remain unavailable. A tenant-wide queue uses an explicit C7 grant cutover;
 * it never infers a historical case scope from an employee's current team.
 */
export const GET = withWorkforceSessionExceptionQueueAuth(async (_req: NextRequest, auth) => {
  try {
    const cases = await prisma.workforceExceptionCase.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_EXCEPTION_CASES + 1,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        evidenceId: true,
        agent: { select: { name: true } },
        decisions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { decisionCode: true } },
        // A single raw-proof-free existence row is sufficient for the queue.
        // Do not select response text, correction IDs or employee request data.
        employeeResponses: { take: 1, select: { id: true } },
      },
    })
    if (cases.length > MAX_EXCEPTION_CASES) {
      return NextResponse.json({
        error: "Too many exception cases for one safe review page; narrow the review window first",
        code: "WORKFORCE_EXCEPTION_QUEUE_LIMIT_EXCEEDED",
      }, { status: 413 })
    }
    const now = new Date()
    return NextResponse.json({
      success: true,
      data: {
        cases: cases.map((item) => {
          const decisionCodes = item.decisions.map((decision) => decision.decisionCode)
          return projectWorkforceExceptionQueueItem({
            displayReference: `WF-${item.id.slice(-8)}`,
            employeeDisplayName: item.agent.name,
            type: item.kind,
            createdAt: item.createdAt,
            decisionCodes,
            evidenceState: item.evidenceId ? "LINKED_RESTRICTED" : "NOT_REQUIRED",
            employeeResponse: workforceExceptionQueueEmployeeResponseState({
              decisionCodes,
              recordedResponseCount: item.employeeResponses.length,
            }),
            now,
          })
        }),
        disposition: "READ_ONLY_HUMAN_REVIEW_REQUIRED",
      },
    }, { headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } })
  } catch (error) {
    console.error("[workforce/exceptions GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce exception queue" }, { status: 500 })
  }
})
