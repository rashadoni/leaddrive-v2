import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Placeholder
    return NextResponse.json({ success: true, message: "Seed not implemented yet" })
  } catch (error) {
    console.error("Seed clients error:", error)
    return NextResponse.json({ error: "Failed to seed" }, { status: 500 })
  }
}
