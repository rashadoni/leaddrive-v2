import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"

export const POST = withRlsAuth("profitability", "write", async () => {
  try {
    // Placeholder
    return NextResponse.json({ success: true, message: "Seed not implemented yet" })
  } catch (error) {
    console.error("Seed clients error:", error)
    return NextResponse.json({ error: "Failed to seed" }, { status: 500 })
  }
})
