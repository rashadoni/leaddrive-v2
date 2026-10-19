/**
 * The schedule that unbinds prospects' Facebook Pages
 * (src/app/api/cron/demo-social-release/route.ts).
 *
 * Who may run it, what its smoke call does, and that the host really runs it:
 * the real installer runs here against a stand-in `crontab`, so the test
 * asserts what ends up scheduled rather than what the script contains. What
 * the engine does to rows and to Meta is proven on a real Postgres in
 * demo-social-release-postgres.test.ts.
 */
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const engine = vi.hoisted(() => ({
  releaseDueDemoSocialConnections: vi.fn(async () => ({ checked: 2, due: 1, released: 1, retrying: 0, incomplete: 0 })),
  demoSocialReleaseHealth: vi.fn(async () => ({ live: 1, due: 0, stranded: 0, incompleteLast7d: 0 })),
}))
vi.mock("@/lib/demo-center/demo-social-release", () => engine)

import { POST } from "@/app/api/cron/demo-social-release/route"

const ENDPOINT = "/api/cron/demo-social-release"
const SECRET = "cron-secret-for-this-test"

function request(query = "", headers: Record<string, string> = { "x-cron-secret": SECRET }) {
  return new NextRequest(`http://localhost:3001${ENDPOINT}${query}`, { method: "POST", headers })
}

describe("POST /api/cron/demo-social-release", () => {
  const previous = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    vi.clearAllMocks()
  })
  afterEach(() => {
    if (previous === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previous
  })

  it("refuses a caller without the cron secret, and runs nothing", async () => {
    expect((await POST(request("", {}))).status).toBe(401)
    expect((await POST(request("", { "x-cron-secret": "wrong" }))).status).toBe(401)
    expect((await POST(request("?smoke=1", {}))).status).toBe(401)
    expect(engine.releaseDueDemoSocialConnections).not.toHaveBeenCalled()
    expect(engine.demoSocialReleaseHealth).not.toHaveBeenCalled()
  })

  it("answers the smoke call with health only: the engine is not run", async () => {
    const response = await POST(request("?smoke=1"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, smoke: true, live: 1, due: 0, stranded: 0, incompleteLast7d: 0 })
    expect(engine.releaseDueDemoSocialConnections).not.toHaveBeenCalled()
  })

  it("writes the smoke answer in the shape the deploy step greps for", async () => {
    const text = await (await POST(request("?smoke=1"))).text()
    expect(text).toContain('"smoke":true')
    expect(text).toMatch(/"stranded":0[,}]/)
  })

  it("runs the engine on a scheduled tick and reports its counts", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, checked: 2, due: 1, released: 1, retrying: 0, incomplete: 0 })
    expect(engine.releaseDueDemoSocialConnections).toHaveBeenCalledTimes(1)
  })

  it("fails loudly, without the error's text, when the engine throws", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {})
    engine.releaseDueDemoSocialConnections.mockRejectedValueOnce(new Error("token EAAG-secret in a message"))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(JSON.stringify(warn.mock.calls)).not.toContain("EAAG-secret")
    warn.mockRestore()
  })
})

function installCrontab(initialCrontab: string) {
  const root = mkdtempSync(join(tmpdir(), "leaddrive-demo-social-cron-"))
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
      env: { ...process.env, CRONTAB_STATE: state, LOG: join(root, "cron.log"), PATH: `${bin}:${process.env.PATH ?? ""}`, SCRIPTS: scripts },
      stdio: "pipe",
    })
    return readFileSync(state, "utf8")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function activeSchedules(crontab: string) {
  return crontab
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#") && line.includes(`cron-trigger.sh ${ENDPOINT} `))
    .map((line) => line.trim().split(/\s+/).slice(0, 5).join(" "))
}

describe("the release schedule on the production host", () => {
  it("runs every five minutes, exactly once, also after the installer runs again", () => {
    expect(activeSchedules(installCrontab(""))).toEqual(["*/5 * * * *"])
    expect(activeSchedules(installCrontab(installCrontab("")))).toEqual(["*/5 * * * *"])
  })

  it("replaces a hand-installed copy", () => {
    const installed = installCrontab(`* * * * * /opt/old/cron-trigger.sh ${ENDPOINT} >> /var/log/old.log 2>&1\n`)
    expect(installed).not.toContain("/opt/old/cron-trigger.sh")
    expect(activeSchedules(installed)).toEqual(["*/5 * * * *"])
  })

  it("is proven by the deploy: one active line, a smoke answer, nothing stranded", () => {
    const deploy = readFileSync(join(process.cwd(), ".github/workflows/deploy.yml"), "utf8")
    const start = deploy.indexOf("- name: Verify the demo social release scheduler")
    expect(start).toBeGreaterThan(-1)
    const step = deploy.slice(start, deploy.indexOf("- name:", start + 10))
    expect(step).toContain("if: ${{ !cancelled() && steps.deploy_atomic.outcome == 'success' }}")
    expect(step).toContain("cron-trigger\\.sh \\/api\\/cron\\/demo-social-release/")
    expect(step).toContain('if [ "$ACTIVE_COUNT" -ne 1 ]; then')
    // The smoke target differs from the schedule's line, so it never waits on the tick's lock.
    expect(step).toContain(`CRON_TRIGGER_LOCK_WAIT_SECONDS=120 /usr/local/lib/leaddrive-v2/ops/current/cron-scripts/cron-trigger.sh "${ENDPOINT}?smoke=1"`)
    expect(step).toContain(`grep -Fq '\\''"smoke":true'\\''`)
    expect(step).toContain(`grep -Eq '\\''"stranded":0[,}]'\\''`)
  })
})
