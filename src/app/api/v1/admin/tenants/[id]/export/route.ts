import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { exportTenantData } from "@/lib/tenant-export"
import { runWithRlsBypass } from "@/lib/rls-context"

// GET /api/v1/admin/tenants/[id]/export — Download tenant data as JSON
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  return runWithRlsBypass(async () => {
    try {
      const result = await exportTenantData(id)

      return new NextResponse(JSON.stringify(result.data, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
        },
      })
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || "Export failed" },
        { status: 500 }
      )
    }
  })
}
