import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { getTenantCapabilityAccess } from "@/lib/tenant-capability-access"
import { checkPermission, type Role } from "@/lib/permissions"
import { getMtmAttendanceAccess } from "@/lib/mtm/attendance-access"
import { MtmAttendanceFeatureSwitch } from "@/components/mtm/attendance-feature-switch"
import { MtmAttendanceSectionTabs } from "@/components/mtm/attendance-section-tabs"
import { isNavItemRoleAllowed, navItems, orgFromSession } from "@/lib/nav-items"

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
  // The section's own menu on each of its pages, as the «Kadr uçotu» clip shows it
  // (owner, 2026-10-20): the sidebar's Personnel items this person may open.
  const org = orgFromSession(user)
  const hrefs = navItems.filter(item => item.group === "Personnel" && isNavItemRoleAllowed(org, item)).map(item => item.href)
  return <>
    <MtmAttendanceSectionTabs hrefs={hrefs} />
    {children}
  </>
}
