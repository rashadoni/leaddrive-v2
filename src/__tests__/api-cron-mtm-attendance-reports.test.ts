import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
const mocks = vi.hoisted(() => ({ job: vi.fn(), bypass: vi.fn() }))
vi.mock("@/lib/cron/mtm-attendance-delivery-job", () => ({ runMtmAttendanceDeliveryJob: mocks.job }))
vi.mock("@/lib/rls-context", () => ({ enterRlsBypass: mocks.bypass }))
import { POST } from "@/app/api/cron/mtm-attendance-reports/route"
const request = (secret = "fixture-secret", smoke = false) => new NextRequest(`http://localhost/api/cron/mtm-attendance-reports${smoke ? "?smoke=1" : ""}`, { method: "POST", headers: { "x-cron-secret": secret } })
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "fixture-secret") })
afterEach(() => { vi.unstubAllEnvs() })
it("authenticates before entering bypass or running the cross-tenant worker", async () => {
  expect((await POST(request("wrong"))).status).toBe(401)
  vi.stubEnv("CRON_SECRET", "")
  expect((await POST(request())).status).toBe(503)
  expect(mocks.bypass).not.toHaveBeenCalled()
  expect(mocks.job).not.toHaveBeenCalled()
})
it("smokes the installed endpoint without querying, enqueueing or sending", async () => {
  const response = await POST(request("fixture-secret", true))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ success: true, data: { smoke: true, processed: 0 } })
  expect(mocks.job).not.toHaveBeenCalled()
})
it("returns a lease skip or bounded summary without leaking mail recipients", async () => {
  mocks.job.mockResolvedValueOnce({ status: "skipped", reason: "already_running" })
  expect(await (await POST(request())).json()).toEqual({ success: true, skipped: true, reason: "already_running" })
  mocks.job.mockResolvedValueOnce({ status: "completed", value: { queued: 2, processed: 2 } })
  expect(await (await POST(request())).json()).toEqual({ success: true, data: { queued: 2, processed: 2 } })
})

function installedCrontab(initial: string) {
  const root = mkdtempSync(join(tmpdir(), "mtm-attendance-cron-test-"))
  try {
    const bin = join(root, "bin"), scripts = join(root, "scripts"), state = join(root, "crontab")
    mkdirSync(bin); mkdirSync(scripts); writeFileSync(state, initial)
    const crontab = join(bin, "crontab")
    writeFileSync(crontab, '#!/bin/sh\nset -eu\nif [ "${1:-}" = "-l" ]; then cat "$CRONTAB_STATE"; else cp "$1" "$CRONTAB_STATE"; fi\n'); chmodSync(crontab, 0o755)
    for (const file of [join(bin, "flock"), join(scripts, "cron-trigger.sh")]) { writeFileSync(file, "#!/bin/sh\nexit 0\n"); chmodSync(file, 0o755) }
    execFileSync("bash", [join(process.cwd(), "scripts/install-resilience-crons.sh")], { env: { ...process.env, CRONTAB_STATE: state, SCRIPTS: scripts, LOG: join(root, "cron.log"), PATH: `${bin}:${process.env.PATH}` }, stdio: "pipe" })
    return readFileSync(state, "utf8")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
describe("attendance schedule registration", () => {
  it("installs once, replaces old endpoint copies and preserves unrelated schedules", () => {
    const before = '17 * * * * /other/job\n*/15 * * * * /opt/old/cron-trigger.sh /api/cron/mtm-attendance-reports\n'
    for (const after of [installedCrontab(before), installedCrontab(installedCrontab(before))]) {
      const active = after.split("\n").filter((line) => !line.trimStart().startsWith("#") && line.includes("cron-trigger.sh /api/cron/mtm-attendance-reports "))
      expect(active).toHaveLength(1)
      expect(active[0].startsWith("*/5 * * * * ")).toBe(true)
      expect(after).toContain("17 * * * * /other/job")
    }
    expect(readFileSync(".github/workflows/deploy.yml", "utf8")).toContain("/api/cron/mtm-attendance-reports?smoke=1")
  })
})
