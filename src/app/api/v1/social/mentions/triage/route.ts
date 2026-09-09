import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import { runSocialTriageForOrganization } from "@/lib/social/ai-triage"

const triageSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  force: z.boolean().optional().default(false),
}).optional()

export const POST = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth) => {
  const parsed = triageSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const result = await runSocialTriageForOrganization(auth.orgId, {
    limit: parsed.data?.limit,
    force: parsed.data?.force,
  })

  return NextResponse.json({ success: true, data: result })
})
