import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTranslator } from "next-intl"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { getTenantCapabilityAccess } from "@/lib/tenant-capability-access"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { getMtmAttendanceAccess } from "@/lib/mtm/attendance-access"
import { attendanceSchedule, enqueueAttendanceDelivery, type AttendanceDeliveryRow, type AttendanceScheduleRow } from "@/lib/mtm/attendance-delivery-store"
import { attendanceDeliveryConfig } from "@/lib/mtm/attendance-delivery-contract"
import { AttendanceViewConfigSchema } from "@/lib/mtm/attendance-view-contract"
import { readMtmAttendanceReport } from "@/lib/mtm/attendance-report-store"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { buildAttendancePdf, buildAttendanceXlsx } from "@/lib/mtm/attendance-export"
import { sendEmail } from "@/lib/email"

const emailCopy = {
  ru: { subject: "Учёт рабочего времени", body: "Отчёт во вложении. Время указано по журналу отметок на момент формирования; незавершённые и неполные дни отмечены в файле." },
  az: { subject: "İş vaxtının uçotu", body: "Hesabat əlavə olunub. Vaxt hesabat hazırlanan anda qeyd jurnalına əsaslanır; tamamlanmamış və natamam günlər faylda göstərilir." },
  en: { subject: "Attendance report", body: "The report is attached. Times reflect the recorded events when the file was prepared; open and incomplete days are marked in the file." },
}
const htmlText = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)

/** Background work has no session: re-resolve every live web authorization gate. */
export async function attendanceDeliveryActor(organizationId: string, userId: string) {
  const org = await prisma.organization.findFirst({ where: { id: organizationId, isActive: true }, select: { id: true } })
  if (!org) return null
  const user = await prisma.user.findFirst({ where: { organizationId, id: userId, isActive: true, anonymizedAt: null }, select: { role: true, hiddenModules: true } })
  if (!user || !checkPermission(user.role as Role, "mtm", "read") || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) return null
  if (!(await getTenantCapabilityAccess(organizationId, "route-field")).allowed) return null
  const access = await getMtmAttendanceAccess(organizationId, userId, user.role)
  return access.enabled ? access.actor : null
}
const actorScope = (actor: NonNullable<Awaited<ReturnType<typeof attendanceDeliveryActor>>>) => JSON.stringify({ role: actor.role, agentId: actor.agentId, ids: actor.scopedAgentIds === null ? null : [...actor.scopedAgentIds].sort() })

async function finish(organizationId: string, id: string, previous: "PENDING" | "SENDING", status: "SENT" | "UNKNOWN" | "CANCELLED" | "FAILED", errorCode: string | null, messageId: string | null = null) {
  await prisma.$executeRaw`UPDATE "mtm_attendance_deliveries" SET "status" = ${status}, "completedAt" = ${new Date()}, "errorCode" = ${errorCode}, "providerMessageId" = ${messageId} WHERE "organizationId" = ${organizationId} AND "id" = ${id} AND "status" = ${previous}`
  return status
}

/** A claimed provider handoff is never automatically retried, even after a crash. */
export async function deliverAttendanceReceipt(organizationId: string, receiptId: string) {
  let directory: string | undefined
  let claimed = false
  try {
    const [receipt] = await prisma.$queryRaw<AttendanceDeliveryRow[]>`SELECT * FROM "mtm_attendance_deliveries" WHERE "organizationId" = ${organizationId} AND "id" = ${receiptId} AND "status" = 'PENDING'`
    if (!receipt) return "SKIPPED" as const
    const [row] = await prisma.$queryRaw<AttendanceScheduleRow[]>`SELECT * FROM "mtm_attendance_schedules" WHERE "organizationId" = ${organizationId} AND "id" = ${receipt.scheduleId}`
    if (!row || !row.enabled || row.archivedAt || row.updatedAt.getTime() !== receipt.scheduleVersion.getTime()) return finish(organizationId, receiptId, "PENDING", "CANCELLED", "SCHEDULE_CHANGED")
    const schedule = attendanceSchedule(row)
    const latest = attendanceDeliveryConfig(schedule.config, schedule.frequency, schedule.timezone, new Date()).filters
    if (latest.from !== receipt.from.toISOString().slice(0, 10) || latest.to !== receipt.to.toISOString().slice(0, 10)) return finish(organizationId, receiptId, "PENDING", "CANCELLED", "PERIOD_EXPIRED")
    const actor = await attendanceDeliveryActor(organizationId, row.userId)
    if (!actor) return finish(organizationId, receiptId, "PENDING", "CANCELLED", "ACCESS_REVOKED")
    const config = AttendanceViewConfigSchema.parse({ ...schedule.config, filters: { ...schedule.config.filters, from: receipt.from.toISOString().slice(0, 10), to: receipt.to.toISOString().slice(0, 10) } })
    const report = await readMtmAttendanceReport({ organizationId, actor, query: config.filters })
    const messages = (await import(`../../../messages/${schedule.locale}.json`)).default
    const table = buildAttendanceTable(report, config, schedule.locale, createTranslator({ locale: schedule.locale, messages, namespace: "mtmAttendance" }))
    const bytes = schedule.format === "pdf" ? buildAttendancePdf(table) : Buffer.from(await buildAttendanceXlsx(table).xlsx.writeBuffer())
    directory = await mkdtemp(join(tmpdir(), "mtm-attendance-delivery-"))
    const filename = `attendance-${config.filters.from}-${config.filters.to}.${schedule.format}`
    const path = join(directory, filename)
    await writeFile(path, bytes, { mode: 0o600 })
    // Building a large file may take seconds. Recheck both the opt-in and scope
    // immediately before the conditional claim, then hand off exactly once.
    const currentActor = await attendanceDeliveryActor(organizationId, row.userId)
    if (!currentActor || actorScope(currentActor) !== actorScope(actor)) return finish(organizationId, receiptId, "PENDING", "CANCELLED", "ACCESS_CHANGED")
    const count = await prisma.$executeRaw`UPDATE "mtm_attendance_deliveries" d SET "status" = 'SENDING', "claimedAt" = ${new Date()} FROM "mtm_attendance_schedules" s WHERE d."organizationId" = ${organizationId} AND d."id" = ${receiptId} AND d."status" = 'PENDING' AND s."organizationId" = d."organizationId" AND s."id" = d."scheduleId" AND s."enabled" AND s."archivedAt" IS NULL AND s."updatedAt" = d."scheduleVersion"`
    if (count !== 1) return "SKIPPED" as const
    claimed = true
    const copy = emailCopy[schedule.locale]
    const result = await sendEmail({ to: receipt.recipient, subject: `${copy.subject}: ${schedule.name}`, html: `<p>${htmlText(copy.body)}</p><p>${htmlText(table.details[0])}</p>`, text: `${copy.body}\n\n${table.details[0]}`, organizationId, sentBy: row.userId, transactional: true, allowProviderFallback: false, attachments: [{ filename, path }] })
    return finish(organizationId, receiptId, "SENDING", result.success ? "SENT" : "UNKNOWN", result.success ? null : "PROVIDER_UNCONFIRMED", result.success ? result.messageId ?? null : null)
  } catch {
    // Do not log provider payloads, recipient addresses or private report cells.
    return finish(organizationId, receiptId, claimed ? "SENDING" : "PENDING", claimed ? "UNKNOWN" : "FAILED", claimed ? "PROVIDER_UNCONFIRMED" : "PREPARATION_FAILED")
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function executeMtmAttendanceDeliveryJob(now = new Date()) {
  const started = Date.now()
  // Cross-tenant discovery is bounded; every actual report/send enters its tenant.
  const due = await prisma.$queryRaw<{ id: string; organizationId: string }[]>`SELECT "id", "organizationId" FROM "mtm_attendance_schedules" WHERE "enabled" AND "archivedAt" IS NULL AND "nextRunAt" <= ${now} ORDER BY "nextRunAt", "id" LIMIT 10`
  let queued = 0
  for (const row of due) {
    await runWithTenant(row.organizationId, async () => {
      try {
        // Advancing while disabled avoids a burst of historic mail on re-enable.
        queued += await enqueueAttendanceDelivery(row.organizationId, row.id, now)
      } catch {
        // A malformed old schedule cannot starve every later tenant. Keep it
        // visible for its owner, with a bounded retry time and generic log.
        console.error("[MTM Cron] attendance schedule could not be queued")
        await prisma.$executeRaw`UPDATE "mtm_attendance_schedules" SET "nextRunAt" = ${new Date(now.getTime() + 3_600_000)} WHERE "organizationId" = ${row.organizationId} AND "id" = ${row.id} AND "nextRunAt" <= ${now}`
      }
    })
  }
  const abandoned = await prisma.$queryRaw<{ id: string; organizationId: string }[]>`SELECT "id", "organizationId" FROM "mtm_attendance_deliveries" WHERE "status" = 'SENDING' AND "claimedAt" < ${new Date(now.getTime() - 3_600_000)} ORDER BY "claimedAt", "id" LIMIT 100`
  for (const row of abandoned) await runWithTenant(row.organizationId, () => finish(row.organizationId, row.id, "SENDING", "UNKNOWN", "WORKER_INTERRUPTED"))
  const pending = await prisma.$queryRaw<{ id: string; organizationId: string }[]>`SELECT "id", "organizationId" FROM "mtm_attendance_deliveries" WHERE "status" = 'PENDING' ORDER BY "createdAt", "id" LIMIT 20`
  let processed = 0
  for (const row of pending) {
    if (Date.now() - started > 90_000) break
    await runWithTenant(row.organizationId, () => deliverAttendanceReceipt(row.organizationId, row.id))
    processed++
  }
  return { schedulesScanned: due.length, queued, processed, unknown: abandoned.length }
}

export function runMtmAttendanceDeliveryJob() {
  return runWithRlsBypass(() => withJobLease({ name: "mtm-attendance-reports", ttlMs: 180_000 }, () => executeMtmAttendanceDeliveryJob()))
}
