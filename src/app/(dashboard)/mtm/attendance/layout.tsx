import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { getTenantCapabilityAccess } from "@/lib/tenant-capability-access"
import { checkPermission, type Role } from "@/lib/permissions"
import { getMtmAttendanceAccess } from "@/lib/mtm/attendance-access"

export const dynamic = "force-dynamic"

export default async function AttendanceLayout({ children }: { children: ReactNode }) {
  const session = await runWithRlsBypass(async () => auth())
  const user = session?.user
  if (!user?.id || !user.organizationId || !checkPermission(user.role as Role, "mtm", "read")
    || user.hiddenModules?.includes("route-field")) notFound()
  const { id: userId, organizationId, role } = user
  const allowed = await runWithTenant(organizationId, async () => {
    const capability = await getTenantCapabilityAccess(organizationId, "route-field")
    if (!capability.allowed) return false
    const access = await getMtmAttendanceAccess(organizationId, userId, role)
    return access.enabled && Boolean(access.actor)
  })
  if (!allowed) notFound()
  return children
}
