import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

// E3.1b — atomic usage-count bump when an agent inserts a snippet. Fire-and-forget
// from the composer; tenant-guarded via (id, organizationId); closes the [P3] usageCount tail.
export const POST = withRls(
  async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const result = await prisma.messageSnippet.updateMany({
      where: { id, organizationId: orgId },
      data: { usageCount: { increment: 1 } },
    })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  },
)
