import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { getTenantCapabilityAccess } from "@/lib/tenant-capability-access"
import { checkPermission, type Role } from "@/lib/permissions"
import { getMtmAttendanceAccess } from "@/lib/mtm/attendance-access"
import { MtmAttendanceFeatureSwitch } from "@/components/mtm/attendance-feature-switch"

export const dynamic = "force-dynamic"

export default async function AttendanceLayout({ children }: { children: ReactNode }) {
  const session = await runWithRlsBypass(async () => auth())
  const user = session?.user
  if (!user?.id || !user.organizationId || !checkPermission(user.role as Role, "mtm", "read")
    || user.hiddenModules?.includes("mtm")) notFound()
  const { id: userId, organizationId, role } = user
  const state = await runWithTenant(organizationId, async () => {
    const capability = await getTenantCapabilityAccess(organizationId, "personnel")
    if (!capability.allowed) return "closed" as const
    const access = await getMtmAttendanceAccess(organizationId, userId, role)
    return !access.enabled ? "off" as const : access.actor ? "open" as const : "closed" as const
  })
  // The switch lives in Personnel → Settings only, so with attendance off an
  // administrator still reaches the section — every page of it shows the switch.
  if (state === "off" && (role === "admin" || role === "superadmin")) return <MtmAttendanceFeatureSwitch enabled={false} canChange />
  if (state !== "open") notFound()
  return children
}
