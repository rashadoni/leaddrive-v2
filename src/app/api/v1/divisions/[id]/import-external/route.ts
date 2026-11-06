import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { isAdminRole } from "@/lib/tasks/board-permission"
import { withRlsAuth } from "@/lib/with-rls"
import {
  ExternalImportError,
  externalImportSchema,
  importExternalTasks,
} from "@/lib/tasks/external-import"

/**
 * POST /api/v1/divisions/[id]/import-external — bring another tool's tasks onto
 * this board (Bordio for Zeytun, 2026-11-06). Up to 200 tasks per request;
 * a larger board is sent in batches, each one all-or-nothing and safe to resend.
 *
 * `dryRun: true` writes nothing and answers how many tasks would be created or
 * updated and which e-mails match nobody in the organization — run it first.
 * Admins only: the import creates task types and the `brand` field for the
 * whole organization and writes tasks for other people without telling them.
 * Contract and mapping: src/lib/tasks/external-import.ts.
 */
export const POST = withRlsAuth("tasks", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  if (!isAdminRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden", message: "Only admins can import tasks from another tool" }, { status: 403 })
  }
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = externalImportSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: `${issue.path.join(".")}: ${issue.message}` }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(
      (tx: Prisma.TransactionClient) => importExternalTasks(tx, {
        organizationId: auth.orgId,
        actorUserId: auth.userId || null,
        divisionId: id,
        input: parsed.data,
      }),
      { timeout: 120_000, maxWait: 10_000 },
    )
    if (!result.dryRun) {
      logAudit(auth.orgId, "import", "division", id, parsed.data.source, {
        newValue: { source: parsed.data.source, created: result.created, updated: result.updated },
      })
    }
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof ExternalImportError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status })
    }
    console.error("[divisions import-external]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
