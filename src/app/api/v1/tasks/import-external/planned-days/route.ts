import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { isAdminRole } from "@/lib/tasks/board-permission"
import { withRlsAuth } from "@/lib/with-rls"
import { ExternalImportError, externalPlannedDaysSchema, setExternalPlannedDays } from "@/lib/tasks/external-import"

/**
 * POST /api/v1/tasks/import-external/planned-days — the day another tool's
 * calendar shows each already brought-over task on becomes its «Başlama
 * tarixi» (Bordio's time blocks → «Mənim işlərim → Təqvim», 2026-11-10).
 * Up to 1000 tasks a request, by the other tool's ids, across all boards.
 * `dryRun: true` only counts. Admins only, like the rest of the import.
 * Contract: setExternalPlannedDays in src/lib/tasks/external-import.ts.
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
  const parsed = externalPlannedDaysSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: `${issue.path.join(".")}: ${issue.message}` }, { status: 400 })
  }
  try {
    const result = await prisma.$transaction(
      (tx: Prisma.TransactionClient) => setExternalPlannedDays(tx, { organizationId: auth.orgId, input: parsed.data }),
      { timeout: 120_000, maxWait: 10_000 },
    )
    if (!result.dryRun && result.changed > 0) {
      logAudit(auth.orgId, "import", "task", "planned-days", parsed.data.source, {
        newValue: { source: parsed.data.source, changed: result.changed, cleared: result.cleared },
      })
    }
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof ExternalImportError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status })
    }
    console.error("[tasks import-external planned-days]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
