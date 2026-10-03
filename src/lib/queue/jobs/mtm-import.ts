import type { Job } from "bullmq"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { applyMtmExcelImportJob } from "@/lib/mtm/excel-import"
import { canImportMtmExcelType, resolveMtmExcelAccess } from "@/lib/mtm/excel-permissions"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"

interface MtmImportJobData {
  organizationId: string
  jobId: string
  requestedBy: string
  /** Web role of the person who pressed "apply"; a client import resolves its actor from it. */
  requestedByRole?: string
  allowConflictOverride: boolean
}

export async function runMtmImport(job: Job<MtmImportJobData>) {
  const data = job.data
  if (!data.organizationId || !data.jobId || !data.requestedBy) throw new Error("Invalid MTM import job payload")
  return runWithTenant(data.organizationId, async () => {
    const importJob = await prisma.mtmImportJob.findFirst({
      where: { id: data.jobId, organizationId: data.organizationId },
      select: { type: true },
    })
    // Clients and their owners are written under the acting person's role and
    // scope, so the worker has to know who that is, not only that a job exists.
    let contacts: { actor: MtmRouteActor; effectiveFrom: string } | null = null
    if (importJob?.type === "CONTACTS") {
      const access = await resolveMtmExcelAccess(prisma, {
        orgId: data.organizationId,
        userId: data.requestedBy,
        role: data.requestedByRole ?? "",
      })
      if (!access.actor || !canImportMtmExcelType(access, "CONTACTS")) throw new Error("The requesting user may not import clients")
      const settings = await getMtmSettings(data.organizationId)
      contacts = {
        actor: access.actor,
        effectiveFrom: currentDateKey(new Date(), isValidTimezone(settings.timezone) ? settings.timezone : "UTC"),
      }
    }
    return applyMtmExcelImportJob({
      db: prisma,
      organizationId: data.organizationId,
      jobId: data.jobId,
      requestedBy: data.requestedBy,
      allowConflictOverride: data.allowConflictOverride === true,
      actor: contacts?.actor,
      effectiveFrom: contacts?.effectiveFrom,
    })
  })
}
