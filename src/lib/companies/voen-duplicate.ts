/**
 * «This VÖEN is already in your companies»: VÖEN is not unique in the table —
 * a branch or an old duplicate may share it — so the form warns instead of
 * refusing. Runs inside the route's tenant scope.
 */
import { prisma } from "@/lib/prisma"

export async function companyWithVoen(orgId: string, voen: string, excludeId?: string | null): Promise<{ id: string; name: string } | null> {
  return prisma.company.findFirst({
    where: { organizationId: orgId, voen, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })
}
