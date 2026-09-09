import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

const mocks = vi.hoisted(() => ({
  withJobLease: vi.fn(),
  getMtmSettings: vi.fn(),
}))

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (callback: () => Promise<unknown>) => callback(),
}))
vi.mock("@/lib/cron/job-lease", () => ({ withJobLease: mocks.withJobLease }))
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: mocks.getMtmSettings }))

import { POST } from "@/app/api/cron/mtm-route-day-close/route"
import { prisma } from "@/lib/prisma"
import {
  MTM_ROUTE_DAY_CLOSE_BATCH,
  MTM_ROUTE_DAY_CLOSE_GRACE_HOURS,
  dayKeyToUtcMidnight,
  executeMtmRouteDayCloseJob,
  firstOpenDayKey,
} from "@/lib/cron/mtm-route-day-close-job"

function cronRequest(url = "http://localhost:3000/api/cron/mtm-route-day-close") {
  return new NextRequest(url, { method: "POST", headers: { Authorization: "Bearer test-cron-secret" } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org-1" }] as never)
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmAuditLog.createMany).mockResolvedValue({ count: 0 } as never)
  mocks.getMtmSettings.mockResolvedValue({ timezone: "Asia/Baku" })
  mocks.withJobLease.mockImplementation(async (
    _options: unknown,
    work: () => Promise<unknown>,
  ) => ({ status: "completed", value: await work() }))
})

describe("firstOpenDayKey", () => {
  it("keeps yesterday open until the grace window has passed in the organization's own timezone", () => {
    // Asia/Baku is UTC+4. 21:00 UTC is 01:00 the next local day — inside the
    // three-hour grace window, so the day that just ended is still open and a
    // late check-out can still land on it.
    expect(firstOpenDayKey(new Date("2026-09-05T21:00:00Z"), "Asia/Baku")).toBe("2026-09-05")
    // 00:00 UTC is 04:00 local: the window has passed and yesterday closes.
    expect(firstOpenDayKey(new Date("2026-09-06T00:00:00Z"), "Asia/Baku")).toBe("2026-09-06")
  })

  it("resolves the boundary per timezone, not per server clock", () => {
    const moment = new Date("2026-09-06T05:00:00Z")
    expect(firstOpenDayKey(moment, "Asia/Baku")).toBe("2026-09-06")   // 09:00 local
    expect(firstOpenDayKey(moment, "America/New_York")).toBe("2026-09-05") // 01:00 local
  })

  it("survives a spring-forward night without moving the boundary by an hour", () => {
    // Europe/Warsaw jumps 02:00 -> 03:00 on 2026-03-29. Asking only for a
    // calendar date means the missing hour cannot shift the day key.
    expect(firstOpenDayKey(new Date("2026-03-29T00:30:00Z"), "Europe/Warsaw")).toBe("2026-03-28")
    expect(firstOpenDayKey(new Date("2026-03-29T04:00:00Z"), "Europe/Warsaw")).toBe("2026-03-29")
  })

  it("refuses an unknown timezone rather than quietly answering in UTC", () => {
    // A UTC answer would close the day three hours early for a Baku tenant.
    expect(firstOpenDayKey(new Date("2026-09-06T00:00:00Z"), "Not/AZone")).toBe("")
  })

  it("uses a grace window measured in hours", () => {
    expect(MTM_ROUTE_DAY_CLOSE_GRACE_HOURS).toBeGreaterThan(0)
    expect(MTM_ROUTE_DAY_CLOSE_GRACE_HOURS).toBeLessThan(12)
  })
})

describe("dayKeyToUtcMidnight", () => {
  it("maps a day key onto the UTC midnight Prisma stores for a DATE column", () => {
    expect(dayKeyToUtcMidnight("2026-09-06").toISOString()).toBe("2026-09-06T00:00:00.000Z")
  })
})

function route(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    agentId: `agent-${id}`,
    status: "IN_PROGRESS",
    date: new Date("2026-08-14T00:00:00.000Z"),
    totalPoints: 8,
    visitedPoints: 3,
    ...overrides,
  }
}

describe("executeMtmRouteDayCloseJob", () => {
  it("asks only for unfinished routes of days that are over, and never for one being worked", async () => {
    await executeMtmRouteDayCloseJob(new Date("2026-09-06T00:00:00Z"))

    const call = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as {
      where: {
        organizationId: string
        deletedAt: null
        status: { in: string[] }
        date: { lt: Date }
        visits: { none: { status: string; deletedAt: null } }
      }
      take: number
    }
    expect(call.where.organizationId).toBe("org-1")
    expect(call.where.deletedAt).toBeNull()
    // A draft was never published and a cancelled route already has its
    // explanation; neither is an unfinished day.
    expect(call.where.status.in).toEqual(["PLANNED", "IN_PROGRESS"])
    expect(call.where.date.lt.toISOString()).toBe("2026-09-06T00:00:00.000Z")
    // An open visit means the agent is still working: closing under them would
    // reject the check-out they are about to send.
    expect(call.where.visits.none).toMatchObject({ status: "CHECKED_IN", deletedAt: null })
    expect(call.take).toBe(MTM_ROUTE_DAY_CLOSE_BATCH + 1)
  })

  it("closes each route it found and keeps every trace of what was done", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([route("r1"), route("r2")] as never)

    const summary = await executeMtmRouteDayCloseJob(new Date("2026-09-06T00:00:00Z"))

    expect(summary).toMatchObject({ organizationsScanned: 1, routesClosed: 2 })
    const update = vi.mocked(prisma.mtmRoute.updateMany).mock.calls[0][0] as {
      where: { id: string; organizationId: string; status: { in: string[] } }
      data: Record<string, unknown>
    }
    expect(update.where).toMatchObject({ id: "r1", organizationId: "org-1" })
    // Re-asserted at write time: a person may have finished the route since the read.
    expect(update.where.status.in).toEqual(["PLANNED", "IN_PROGRESS"])
    expect(update.data).toEqual({ status: "INCOMPLETE" })
    // Writing completedAt would let "completed routes" count days nobody finished;
    // bumping version would mark a closed route as edited since publish.
    expect(update.data).not.toHaveProperty("completedAt")
    expect(update.data).not.toHaveProperty("visitedPoints")
    expect(update.data).not.toHaveProperty("startedAt")
    expect(update.data).not.toHaveProperty("version")
  })

  it("leaves an audit trail naming the route, the day boundary and what it came from", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([route("r1", { status: "PLANNED" })] as never)

    await executeMtmRouteDayCloseJob(new Date("2026-09-06T00:00:00Z"))

    const rows = (vi.mocked(prisma.mtmAuditLog.createMany).mock.calls[0][0] as { data: Array<Record<string, unknown>> }).data
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      organizationId: "org-1",
      agentId: "agent-r1",
      action: "ROUTE_DAY_CLOSE",
      entity: "MtmRoute",
      entityId: "r1",
      metadataKind: "route_day_close",
      oldData: { status: "PLANNED" },
    })
    expect(rows[0].newData).toMatchObject({
      status: "INCOMPLETE",
      closingBefore: "2026-09-06",
      timezone: "Asia/Baku",
      visitedPoints: 3,
      totalPoints: 8,
    })
  })

  it("does not claim a close, or record one, when the route was finished first", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([route("r1")] as never)
    vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 0 } as never)

    const summary = await executeMtmRouteDayCloseJob(new Date("2026-09-06T00:00:00Z"))

    expect(summary.routesClosed).toBe(0)
    expect(vi.mocked(prisma.mtmAuditLog.createMany)).not.toHaveBeenCalled()
  })

  it("bounds the first run and says when more are waiting", async () => {
    const many = Array.from({ length: MTM_ROUTE_DAY_CLOSE_BATCH + 1 }, (_, i) => route(`r${i}`))
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue(many as never)

    const summary = await executeMtmRouteDayCloseJob(new Date("2026-09-06T00:00:00Z"))

    expect(summary.routesClosed).toBe(MTM_ROUTE_DAY_CLOSE_BATCH)
    expect(summary.organizations[0].morePending).toBe(true)
  })

  it("leaves today alone while the grace window is still open", async () => {
    await executeMtmRouteDayCloseJob(new Date("2026-09-05T21:00:00Z"))
    const call = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as { where: { date: { lt: Date } } }
    expect(call.where.date.lt.toISOString()).toBe("2026-09-05T00:00:00.000Z")
  })

  it("applies each organization's own timezone", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org-baku" }, { id: "org-ny" }] as never)
    mocks.getMtmSettings.mockImplementation(async (orgId: string) =>
      ({ timezone: orgId === "org-ny" ? "America/New_York" : "Asia/Baku" }))

    const summary = await executeMtmRouteDayCloseJob(new Date("2026-09-06T05:00:00Z"))

    expect(summary.organizations.map((o) => o.closingBefore)).toEqual(["2026-09-06", "2026-09-05"])
  })

  it("skips a tenant whose timezone this runtime does not know", async () => {
    mocks.getMtmSettings.mockResolvedValue({ timezone: "Mars/Olympus" })

    const summary = await executeMtmRouteDayCloseJob(new Date("2026-09-06T05:00:00Z"))

    expect(summary.organizations).toEqual([])
    expect(summary.routesClosed).toBe(0)
    expect(vi.mocked(prisma.mtmRoute.findMany)).not.toHaveBeenCalled()
  })

  it("keeps sweeping when one tenant's settings cannot be read", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org-broken" }, { id: "org-ok" }] as never)
    mocks.getMtmSettings.mockImplementation(async (orgId: string) => {
      if (orgId === "org-broken") throw new Error("settings unavailable")
      return { timezone: "Asia/Baku" }
    })

    const summary = await executeMtmRouteDayCloseJob(new Date("2026-09-06T05:00:00Z"))

    expect(summary.organizations.map((o) => o.organizationId)).toEqual(["org-ok"])
    expect(vi.mocked(prisma.mtmRoute.findMany)).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/cron/mtm-route-day-close", () => {
  it("closes the day and reports what it changed", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([
      { id: "r1", agentId: "a1", status: "IN_PROGRESS", date: new Date("2026-08-14T00:00:00.000Z"), totalPoints: 8, visitedPoints: 3 },
      { id: "r2", agentId: "a2", status: "PLANNED", date: new Date("2026-08-15T00:00:00.000Z"), totalPoints: 4, visitedPoints: 0 },
      { id: "r3", agentId: "a3", status: "IN_PROGRESS", date: new Date("2026-08-16T00:00:00.000Z"), totalPoints: 6, visitedPoints: 6 },
    ] as never)

    const response = await POST(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.routesClosed).toBe(3)
  })

  it("reports a lease skip instead of claiming the work was done", async () => {
    mocks.withJobLease.mockResolvedValue({ status: "skipped", reason: "already_running" })

    const body = await (await POST(cronRequest())).json()

    expect(body).toMatchObject({ success: true, skipped: true, reason: "already_running" })
  })

  it("answers the deploy smoke check without writing a row", async () => {
    const body = await (await POST(cronRequest(
      "http://localhost:3000/api/cron/mtm-route-day-close?smoke=1",
    ))).json()

    expect(body.data.smoke).toBe(true)
    expect(vi.mocked(prisma.mtmRoute.updateMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.mtmRoute.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.organization.findMany)).not.toHaveBeenCalled()
  })
})

describe("the INCOMPLETE migration", () => {
  const migration = readFileSync(join(
    process.cwd(),
    "prisma/migrations/20260905220000_mtm_route_incomplete_status/migration.sql",
  ), "utf8")

  it("adds the enum value and nothing that uses it", () => {
    expect(migration).toContain(`ALTER TYPE "MtmRouteStatus" ADD VALUE IF NOT EXISTS 'INCOMPLETE'`)
    // Postgres refuses to use a value added in the same transaction, and Prisma
    // runs each migration in one. The August backlog is closed by the job's
    // first run instead — per tenant, in that tenant's own timezone.
    expect(migration).not.toMatch(/UPDATE\s+"?mtm_routes"?/i)
    expect(migration).not.toContain("'INCOMPLETE'::")
    // No backfill means no RLS snapshot/disable/restore dance is needed either.
    expect(migration).not.toContain("app.org_id")
  })

  it("indexes the question the hourly sweep asks", () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "mtm_routes_organizationId_status_date_idx"')
    expect(migration).toContain('ON "mtm_routes"("organizationId", "status", "date")')
  })

  it("is mirrored in the Prisma schema so the next migration does not drift", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8")
    const enumBlock = schema.slice(schema.indexOf("enum MtmRouteStatus {"))
    expect(enumBlock.slice(0, enumBlock.indexOf("}"))).toContain("INCOMPLETE")
    expect(schema).toContain("@@index([organizationId, status, date])")
  })
})

describe("the day-close schedule is actually installed and verified", () => {
  const installer = readFileSync(join(process.cwd(), "scripts/install-resilience-crons.sh"), "utf8")
  const deployWorkflow = readFileSync(join(process.cwd(), ".github/workflows/deploy.yml"), "utf8")

  function installCrontab(initialCrontab: string) {
    const root = mkdtempSync(join(tmpdir(), "leaddrive-route-day-close-cron-"))
    const bin = join(root, "bin")
    const scripts = join(root, "scripts")
    const state = join(root, "crontab")
    try {
      mkdirSync(bin)
      mkdirSync(scripts)
      writeFileSync(state, initialCrontab)
      writeFileSync(
        join(bin, "crontab"),
        `#!/bin/sh\nset -eu\nif [ "\${1:-}" = "-l" ]; then\n  cat "$CRONTAB_STATE"\nelse\n  cp "$1" "$CRONTAB_STATE"\nfi\n`,
      )
      chmodSync(join(bin, "crontab"), 0o755)
      writeFileSync(join(bin, "flock"), "#!/bin/sh\nexit 0\n")
      chmodSync(join(bin, "flock"), 0o755)
      writeFileSync(join(scripts, "cron-trigger.sh"), "#!/bin/sh\nexit 0\n")
      chmodSync(join(scripts, "cron-trigger.sh"), 0o755)

      execFileSync("bash", [join(process.cwd(), "scripts/install-resilience-crons.sh")], {
        env: {
          ...process.env,
          CRONTAB_STATE: state,
          LOG: join(root, "cron.log"),
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          SCRIPTS: scripts,
        },
        stdio: "pipe",
      })
      return readFileSync(state, "utf8")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  function activeSchedules(crontab: string, endpoint: string) {
    return crontab
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#") && line.includes(`cron-trigger.sh ${endpoint}`))
  }

  it("runs hourly, because the boundary is each tenant's local morning", () => {
    expect(installer).toContain("20 * * * * $TRIGGER /api/cron/mtm-route-day-close")
  })

  it("installs exactly one schedule and stays single after a reinstall", () => {
    const installed = installCrontab("")
    expect(activeSchedules(installed, "/api/cron/mtm-route-day-close")).toHaveLength(1)

    const reinstalled = installCrontab(installed)
    expect(activeSchedules(reinstalled, "/api/cron/mtm-route-day-close")).toHaveLength(1)
  })

  it("removes a stale hand-installed copy pointing at an old checkout", () => {
    const installed = installCrontab("30 2 * * * /opt/old/cron-trigger.sh /api/cron/mtm-route-day-close\n")
    expect(activeSchedules(installed, "/api/cron/mtm-route-day-close")).toHaveLength(1)
    expect(installed).not.toContain("/opt/old/cron-trigger.sh")
  })

  it("is verified after deployment through the side-effect-free smoke path", () => {
    expect(deployWorkflow).toContain("Verify the MTM route day-close scheduler")
    expect(deployWorkflow).toContain("/api/cron/mtm-route-day-close?smoke=1")
    // The lock is named after the whole target string, so the smoke call and
    // the scheduled run never contend for it.
    expect(deployWorkflow).toContain("CRON_TRIGGER_LOCK_WAIT_SECONDS=120")
  })
})
