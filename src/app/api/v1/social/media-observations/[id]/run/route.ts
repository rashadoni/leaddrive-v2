import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { processMediaObservation } from "@/lib/social/media-pipeline"

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRlsAuth("social", "write", async (_req: NextRequest, auth, context: RouteContext) => {
  const { id } = await context.params
  try {
    return NextResponse.json({ success: true, data: await processMediaObservation(auth.orgId, id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not process media" }, { status: 409 })
  }
})
