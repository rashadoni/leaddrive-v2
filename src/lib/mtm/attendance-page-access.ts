import { getMtmAttendanceAccess } from "@/lib/mtm/attendance-access"
import { isCrmAdminRole } from "@/lib/mtm/attendance-manager"
import { runWithTenant } from "@/lib/rls-context"

/** Whether this signed-in person runs Personnel: the pages' tabs and cards follow the same answer as the API. */
export async function canManagePersonnelPage(
  user: { id?: string | null; organizationId?: string | null; role?: string | null } | null | undefined,
): Promise<boolean> {
  if (isCrmAdminRole(user?.role)) return true
  if (!user?.id || !user.organizationId || !user.role) return false
  const { id, organizationId, role } = user
  const access = await runWithTenant(organizationId, () => getMtmAttendanceAccess(organizationId, id, role))
  return access.enabled && access.canManagePersonnel === true
}
