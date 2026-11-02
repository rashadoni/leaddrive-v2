/**
 * The contract reminders are installed by the installer every deploy runs.
 *
 * They lived in a hand-run script (install-contract-crons.sh) and did not move
 * with production in September 2026: for a month no renewal alert, overdue
 * approval, milestone or signing reminder fired, and nothing reported it
 * (owner, 2026-10-17: «включить, сначала перевести»). The real installer runs
 * here against a stand-in `crontab`, so the test asserts what ends up
 * scheduled rather than what the script contains.
 */
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const SCHEDULES = {
  "/api/cron/renewal-alerts": "5 7 * * *",
  "/api/cron/contract-approval-escalations": "15 * * * *",
  "/api/cron/contract-milestone-reminders": "0 8 * * *",
  "/api/cron/esign-reminders": "0 9 * * *",
} as const

function installCrontab(initialCrontab: string) {
  const root = mkdtempSync(join(tmpdir(), "leaddrive-support-cron-"))
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
    .filter((line) => !line.trimStart().startsWith("#") && line.includes(`cron-trigger.sh ${endpoint} `))
    .map((line) => line.trim().split(/\s+/).slice(0, 5).join(" "))
}

describe("contract reminders on the production host", () => {
  it("schedules each reminder exactly once", () => {
    const installed = installCrontab("")
    for (const [endpoint, schedule] of Object.entries(SCHEDULES)) {
      expect([endpoint, activeSchedules(installed, endpoint)]).toEqual([endpoint, [schedule]])
    }
  })

  it("keeps exactly one of each after the installer runs again", () => {
    const reinstalled = installCrontab(installCrontab(""))
    for (const [endpoint, schedule] of Object.entries(SCHEDULES)) {
      expect([endpoint, activeSchedules(reinstalled, endpoint)]).toEqual([endpoint, [schedule]])
    }
  })

  it("replaces the copies the retired hand-run script installed", () => {
    const installed = installCrontab([
      "0 8 * * * /opt/old/cron-trigger.sh contract-milestone-reminders >> /var/log/leaddrive-cron.log 2>&1",
      "0 9 * * * /opt/old/cron-trigger.sh esign-reminders >> /var/log/leaddrive-cron.log 2>&1",
      "0 * * * * /opt/old/cron-trigger.sh contract-approval-escalations >> /var/log/leaddrive-cron.log 2>&1",
      "",
    ].join("\n"))
    expect(installed).not.toContain("/opt/old/cron-trigger.sh")
    for (const [endpoint, schedule] of Object.entries(SCHEDULES)) {
      expect([endpoint, activeSchedules(installed, endpoint)]).toEqual([endpoint, [schedule]])
    }
  })

  it("leaves revenue recognition alone: it posts ledger entries and is switched on by decision", () => {
    const kept = "0 2 1 * * /opt/old/cron-trigger.sh revenue-recognition >> /var/log/leaddrive-cron.log 2>&1"
    const installed = installCrontab(`${kept}\n`)
    expect(installed).toContain(kept)
    expect(installed).not.toContain("/api/cron/revenue-recognition")
  })

  it("calls endpoints that exist, answer the trigger's POST and have a side-effect-free smoke", () => {
    for (const endpoint of Object.keys(SCHEDULES)) {
      const route = readFileSync(join(process.cwd(), `src/app${endpoint}/route.ts`), "utf8")
      expect([endpoint, route.includes("export async function POST("), route.includes("requireCronAuth(req)"), route.includes('get("smoke") === "1"')]).toEqual([endpoint, true, true, true])
    }
  })

  it("the retired script refuses to run, so nothing schedules them twice", () => {
    expect(() => execFileSync("bash", [join(process.cwd(), "scripts/install-contract-crons.sh")], { stdio: "pipe" })).toThrow()
  })

  it("the deploy proves each one is scheduled once and answers", () => {
    const deploy = readFileSync(join(process.cwd(), ".github/workflows/deploy.yml"), "utf8")
    const step = deploy.slice(deploy.indexOf("name: Verify the contract reminder schedulers"))
    expect(step).toContain("for ENDPOINT in renewal-alerts contract-approval-escalations contract-milestone-reminders esign-reminders; do")
    expect(step).toContain("?smoke=1")
    expect(step).toContain("if: ${{ !cancelled() && steps.deploy_atomic.outcome == 'success' }}")
  })
})
