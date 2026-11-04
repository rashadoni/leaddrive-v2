import type { Prisma } from "@prisma/client"
import { readOwnAttendanceBreakDay } from "@/lib/mtm/attendance-break-kinds"
import type { AttendanceDeskDay } from "@/lib/mtm/attendance-qr-contract"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"

/**
 * Readers for desk screens and office networks (owner, 2026-11-04; mockups
 * docs/mtm-attendance/mockups/desk-and-breaks/1-desk-computer.png and
 * 3-crm-settings.png). Kept apart from `attendance-desk-screen.ts`, which
 * writes, so the branch screen store can read them without a cycle.
 */
export const ATTENDANCE_DESK_RULE_KEY = "attendanceDeskScreensEnabled"
export const ATTENDANCE_BRANCH_NETWORKS_KEY = "attendanceBranchNetworks"
export const ATTENDANCE_BRANCH_NETWORKS_MAX = 5

type Tx = Prisma.TransactionClient

/** Whether employees may pair their own computer as a desk screen. Off until an administrator turns it on. */
export async function readAttendanceDeskRule(tx: Pick<Tx, "mtmSetting">, organizationId: string) {
  const row = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: ATTENDANCE_DESK_RULE_KEY } }, select: { value: true } })
  return row?.value === true
}

/** Each branch's remembered office addresses: a screen coming from one of them stands at that branch. */
export async function readAttendanceBranchNetworks(tx: Pick<Tx, "mtmSetting">, organizationId: string): Promise<Record<string, string[]>> {
  const row = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: ATTENDANCE_BRANCH_NETWORKS_KEY } }, select: { value: true } })
  const value = row?.value
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result: Record<string, string[]> = {}
  for (const [branchId, addresses] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(addresses)) result[branchId] = addresses.filter((item): item is string => typeof item === "string").slice(0, ATTENDANCE_BRANCH_NETWORKS_MAX)
  }
  return result
}

/**
 * What a desk screen shows of its employee: the name, today's day and the
 * kinds of a break. Null when the card is gone or no longer in attendance —
 * the desk then shows nothing of theirs.
 */
export async function readAttendanceDeskDay(tx: Tx, organizationId: string, agentId: string, now: Date): Promise<AttendanceDeskDay | null> {
  const agent = await tx.mtmAgent.findFirst({ where: { organizationId, id: agentId, status: "ACTIVE" }, select: { name: true } })
  if (!agent) return null
  // Today's day in the company's time zone, or a day still open from before.
  const zone = (await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: "timezone" } }, select: { value: true } }))?.value
  const today = currentDateKey(now, typeof zone === "string" && isValidTimezone(zone) ? zone : "Asia/Baku")
  const workday = await tx.mtmAgentWorkday.findFirst({
    where: { organizationId, agentId, OR: [{ status: { in: ["STARTED", "PAUSED"] } }, { workDate: new Date(`${today}T00:00:00.000Z`) }] },
    orderBy: { startedAt: "desc" }, select: { id: true, status: true, startedAt: true, pausedAt: true, completedAt: true, totalPausedSeconds: true },
  })
  const breaks = await readOwnAttendanceBreakDay(tx, { organizationId, agentId }, workday && workday.status !== "COMPLETED" ? workday.id : null, now)
  const state = !workday ? "NOT_STARTED" : workday.status === "COMPLETED" ? "COMPLETED" : workday.status === "PAUSED" ? "PAUSED" : "RUNNING"
  const open = workday && workday.status !== "COMPLETED" ? workday : null
  // Worked so far: since the start, less the closed breaks and the one going on.
  const workedSeconds = open ? Math.max(0, Math.floor((now.getTime() - open.startedAt.getTime()) / 1000) - open.totalPausedSeconds
    - (open.pausedAt ? Math.max(0, Math.floor((now.getTime() - open.pausedAt.getTime()) / 1000)) : 0)) : null
  return {
    employeeName: agent.name, state,
    startedAt: open?.startedAt.toISOString() ?? null, pausedAt: open?.pausedAt?.toISOString() ?? null,
    workedSeconds, pausedSeconds: open ? open.totalPausedSeconds : null,
    breaks,
  }
}
