import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import {
  deleteMonitoringProfile,
  resumeMonitoringProfile,
  setMonitoringProfileStatus,
} from "@/lib/social/monitoring-profiles"
import { monitoringProfilePatchSchema } from "@/lib/social/monitoring-profile-schema"

type Context = { params: Promise<{ id: string }> }

/**
 * Pause / resume / stop one profile. `resume` is the Bahruz Şiraliyev path: it
 * rebuilds a collection plan from vocabulary the subject already holds, so the
 * operator retypes nothing and the archive is reused before any external
 * collection.
 */
export const PATCH = withSocialMonitoringMutationFence<Context>("social", "write", async (req: NextRequest, auth, context) => {
  const { id } = await context.params
  const parsed = monitoringProfilePatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  try {
    if (parsed.data.action === "resume") {
      const profile = await resumeMonitoringProfile(auth.orgId, id, auth.userId, {
        platforms: parsed.data.platforms,
        directions: parsed.data.directions,
      })
      await logAudit(auth.orgId, "update", "monitoring_profile", id, `resume:${profile.name}`)
      return NextResponse.json({ success: true, data: profile })
    }

    const status = parsed.data.action === "stop" ? "archived" : "paused"
    await setMonitoringProfileStatus(auth.orgId, id, status)
    await logAudit(auth.orgId, "update", "monitoring_profile", id, `status:${status}`)
    return NextResponse.json({ success: true, data: { id, status } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update monitoring" },
      { status: 400 },
    )
  }
})

export const DELETE = withRlsAuth<Context>("social", "write", async (req: NextRequest, auth, context) => {
  const { id } = await context.params
  // ?force=1 deletes a monitoring that is still collecting (stronger confirm in
  // the UI). Without it the stop-first guard in deleteMonitoringProfile applies.
  const force = new URL(req.url).searchParams.get("force") === "1"
  try {
    await deleteMonitoringProfile(auth.orgId, id, { force })
    logAudit(auth.orgId, "delete", "monitoring_profile", id, force ? "deleted:force" : "deleted")
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete monitoring" },
      { status: 400 },
    )
  }
})
