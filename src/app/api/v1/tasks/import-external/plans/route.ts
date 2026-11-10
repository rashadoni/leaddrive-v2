import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { isAdminRole } from "@/lib/tasks/board-permission"
import { withRlsAuth } from "@/lib/with-rls"
import { ExternalImportError, externalPlansSchema, importExternalPlans } from "@/lib/tasks/external-import"

/**
 * POST /api/v1/tasks/import-external/plans — each person's day for tasks
 * already brought over from another tool (Bordio's calendar → «Mənim işlərim →
 * Təqvim», 2026-11-10). Up to 2000 task-and-person pairs a request, by the
 * other tool's task ids and the people's e-mails, across all boards.
 * `dryRun: true` only counts. Admins only, like the rest of the import.
 * Contract: importExternalPlans in src/lib/tasks/external-import.ts.
 */
export const POST = withRlsAuth("tasks", "write", async (req, auth) => {
  if (!isAdminRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden", message: "Only admins can import tasks from another tool" }, { status: 403 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = externalPlansSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: `${issue.path.join(".")}: ${issue.message}` }, { status: 400 })
  }
  try {
    const result = await prisma.$transaction(
      (tx: Prisma.TransactionClient) => importExternalPlans(tx, { organizationId: auth.orgId, input: parsed.data }),
      { timeout: 120_000, maxWait: 10_000 },
    )
    if (!result.dryRun && result.created + result.moved + result.removed > 0) {
      logAudit(auth.orgId, "import", "task", "plans", parsed.data.source, {
        newValue: { source: parsed.data.source, created: result.created, moved: result.moved, removed: result.removed },
      })
    }
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof ExternalImportError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status })
    }
    console.error("[tasks import-external plans]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
