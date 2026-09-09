import type { Job } from "bullmq"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { applyMtmExcelImportJob } from "@/lib/mtm/excel-import"

interface MtmImportJobData {
  organizationId: string
  jobId: string
  requestedBy: string
  allowConflictOverride: boolean
}

export async function runMtmImport(job: Job<MtmImportJobData>) {
  const data = job.data
  if (!data.organizationId || !data.jobId || !data.requestedBy) throw new Error("Invalid MTM import job payload")
  return runWithTenant(data.organizationId, () => applyMtmExcelImportJob({
    db: prisma,
    organizationId: data.organizationId,
    jobId: data.jobId,
    requestedBy: data.requestedBy,
    allowConflictOverride: data.allowConflictOverride === true,
  }))
}
