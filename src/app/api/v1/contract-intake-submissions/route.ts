/**
 * CLM Slice 3d — Contract Intake Submissions queue.
 *
 * GET /api/v1/contract-intake-submissions
 *
 * Org-scoped list of submissions (the processing queue for admins/managers).
 * Supports optional ?status= filter.
 * Returns submission + form name + contract link.
 *
 * Auth: org-scoped + "contracts" module gate.
 * Access: admin or manager (the processing queue).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (req, { orgId, session }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts"))) {
    return moduleDisabledResponse("contracts")
  }

  // Queue view: admin/manager only.
  if (session?.role !== "superadmin" && session?.role !== "admin" && session?.role !== "manager") {
    return NextResponse.json(
      { error: "Only admins and managers can view the intake submissions queue." },
      { status: 403 },
    )
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const where: { organizationId: string; status?: string } = { organizationId: orgId }
    if (status) where.status = status

    const [submissions, total] = await Promise.all([
      prisma.contractIntakeSubmission.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { submittedAt: "desc" },
        include: {
          form: { select: { id: true, name: true, contractType: true } },
          contract: {
            select: {
              id: true,
              contractNumber: true,
              title: true,
              status: true,
              valueAmount: true,
              currency: true,
            },
          },
        },
      }),
      prisma.contractIntakeSubmission.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: {
        submissions: submissions.map((s: {
          contract: { valueAmount: unknown } | null;
          [key: string]: unknown;
        }) => ({
          ...s,
          contract: s.contract
            ? {
                ...s.contract,
                valueAmount:
                  s.contract.valueAmount != null
                    ? Number(s.contract.valueAmount)
                    : null,
              }
            : null,
        })),
        total,
        page,
        limit,
      },
    })
  } catch (e) {
    console.error("[contract-intake-submissions GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
