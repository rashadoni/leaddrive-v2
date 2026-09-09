import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { buildSocialMonitoringPdf } from "@/lib/social/social-monitoring-pdf"
import {
  getVisualMonitoringReport,
  VisualReportSubjectsNotFoundError,
} from "@/lib/social/visual-monitoring-report"
import { visualReportRequestSchema } from "@/lib/social/visual-report-schema"

const PRIVATE_HEADERS = { "cache-control": "private, no-store" }

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { error: message, ...(details === undefined ? {} : { details }) },
    { status, headers: PRIVATE_HEADERS },
  )
}

export const POST = withRlsAuth("social", "read", async (request: NextRequest, auth) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const parsed = visualReportRequestSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError("Invalid visual report request", 400, parsed.error.flatten())
  }

  try {
    // Build the tenant-scoped snapshot exactly once. The JSON preview and PDF
    // renderer therefore share the same filters, counts and generatedAt value.
    const snapshot = await getVisualMonitoringReport({
      organizationId: auth.orgId,
      request: parsed.data,
    })

    if (parsed.data.format === "pdf") {
      const pdf = buildSocialMonitoringPdf(snapshot)
      const filename = `social-monitoring-${parsed.data.range.from}-${parsed.data.range.to}.pdf`
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      })
    }

    return NextResponse.json(
      { success: true, data: snapshot },
      { headers: PRIVATE_HEADERS },
    )
  } catch (error) {
    // Treat a cross-tenant ID exactly like a missing ID. The response never
    // confirms whether the requested subject exists in another organization.
    if (error instanceof VisualReportSubjectsNotFoundError) {
      return jsonError("One or more monitoring subjects were not found", 404)
    }
    throw error
  }
})
