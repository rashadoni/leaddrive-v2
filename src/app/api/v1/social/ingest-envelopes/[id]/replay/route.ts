import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/prisma"
import { replayIngestEnvelope } from "@/lib/social/ingest-envelope-replay"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

export const POST = withSocialMonitoringMutationFence("social", "write", async (
  _req: NextRequest,
  auth,
  context: { params: Promise<{ id: string }> },
) => {
  const { id } = await context.params
  if (!id?.trim()) return NextResponse.json({ error: "Ingest envelope id is required" }, { status: 400 })

  try {
    const result = await replayIngestEnvelope(auth.orgId, id)
    await logAudit(auth.orgId, "replay", "ingest_envelope", id, result.status)
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not replay ingest envelope"
    const status = message === "Ingest envelope not found" ? 404 : 409
    return NextResponse.json({ error: message }, { status })
  }
})
