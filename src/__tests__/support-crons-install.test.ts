/**
 * The Support schedules are installed by the same installer every deploy runs.
 *
 * Why this exists: escalation rules and the "closes automatically after seven
 * days" promise are carried out only when their endpoints are called. When
 * production moved hosts in September 2026 the schedule did not move with it.
 * For a month rules could be edited, previewed and switched on while nothing
 * fired; the last escalation on record is from 2 September. Nothing failed, so
 * nothing reported it.
 *
 * The real installer runs here against a stand-in `crontab`, so the test
 * asserts what ends up scheduled rather than what the script contains.
 */
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ESCALATION = "/api/cron/sla-escalation"
const AUTO_CLOSE = "/api/cron/ticket-closure-requests"

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

describe("Support schedules on the production host", () => {
  it("runs escalation rules every five minutes and the auto-close sweep hourly", () => {
    const installed = installCrontab("")

    expect(activeSchedules(installed, ESCALATION)).toEqual(["*/5 * * * *"])
    expect(activeSchedules(installed, AUTO_CLOSE)).toEqual(["37 * * * *"])
  })

  it("keeps exactly one of each after the installer runs again", () => {
    const reinstalled = installCrontab(installCrontab(""))

    expect(activeSchedules(reinstalled, ESCALATION)).toEqual(["*/5 * * * *"])
    expect(activeSchedules(reinstalled, AUTO_CLOSE)).toEqual(["37 * * * *"])
  })

  it("replaces a hand-installed copy left behind by an older host", () => {
    const installed = installCrontab([
      "*/15 * * * * /opt/old/cron-trigger.sh /api/cron/sla-escalation >> /var/log/old.log 2>&1",
      "0 4 * * * /opt/old/cron-trigger.sh /api/cron/ticket-closure-requests >> /var/log/old.log 2>&1",
      "",
    ].join("\n"))

    expect(installed).not.toContain("/opt/old/cron-trigger.sh")
    expect(activeSchedules(installed, ESCALATION)).toEqual(["*/5 * * * *"])
    expect(activeSchedules(installed, AUTO_CLOSE)).toEqual(["37 * * * *"])
  })

  it("leaves unrelated lines of the crontab alone", () => {
    const installed = installCrontab("15 2 * * * /usr/local/bin/unrelated-backup\n")

    expect(installed).toContain("15 2 * * * /usr/local/bin/unrelated-backup")
  })

  it("calls endpoints that exist and answer the trigger's POST", () => {
    for (const endpoint of [ESCALATION, AUTO_CLOSE]) {
      const route = readFileSync(join(process.cwd(), `src/app${endpoint}/route.ts`), "utf8")
      expect([endpoint, route.includes("export async function POST("), route.includes("requireCronAuth(req)")]).toEqual([endpoint, true, true])
    }
  })
})
