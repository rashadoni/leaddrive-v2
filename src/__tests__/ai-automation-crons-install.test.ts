/**
 * The schedules behind «Настройки → ИИ-автоматизация» are installed by the same
 * installer every deploy runs.
 *
 * Why this exists: every switch on that page — auto-acknowledge, follow-ups,
 * payment reminders, triage, sentiment, KB close, duplicates, credit limit,
 * hot leads, stage advance, social, renewals, meeting recaps — is carried out
 * only when /api/cron/ai-auto-actions (and, for renewals, /api/cron/ai-renewal)
 * is called. When production moved hosts in September 2026 those schedules did
 * not move with it: the last run on record is 2026-09-04, and for almost three
 * months admins could switch automations on while nothing happened. Nothing
 * failed, so nothing reported it.
 *
 * The real installer runs here against a stand-in `crontab`, so the test
 * asserts what ends up scheduled rather than what the script contains.
 */
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { runnableCronLines } from "./helpers/installed-cron"

const AUTO_ACTIONS = "/api/cron/ai-auto-actions"
const RENEWAL = "/api/cron/ai-renewal"

function installCrontab(initialCrontab: string) {
  const root = mkdtempSync(join(tmpdir(), "leaddrive-ai-automation-cron-"))
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
    writeFileSync(join(scripts, "cron-dispatch.sh"), "#!/bin/sh\nexit 0\n")
    chmodSync(join(scripts, "cron-dispatch.sh"), 0o755)

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
  return runnableCronLines(crontab).filter((line) => line.includes(`cron-trigger.sh ${endpoint} `))
    .map((line) => line.trim().split(/\s+/).slice(0, 5).join(" "))
}

describe("AI automation schedules on the production host", () => {
  it("runs the automations every ten minutes and the renewal drafts nightly", () => {
    const installed = installCrontab("")

    expect(activeSchedules(installed, AUTO_ACTIONS)).toEqual(["2-59/10 * * * *"])
    expect(activeSchedules(installed, RENEWAL)).toEqual(["35 2 * * *"])
  })

  it("keeps exactly one of each after the installer runs again", () => {
    const reinstalled = installCrontab(installCrontab(""))

    expect(activeSchedules(reinstalled, AUTO_ACTIONS)).toEqual(["2-59/10 * * * *"])
    expect(activeSchedules(reinstalled, RENEWAL)).toEqual(["35 2 * * *"])
  })

  it("replaces a hand-installed copy left behind by an older host", () => {
    const installed = installCrontab([
      "*/10 * * * * /opt/old/cron-trigger.sh /api/cron/ai-auto-actions >> /var/log/old.log 2>&1",
      "0 2 * * * /opt/old/cron-trigger.sh ai-renewal >> /var/log/old.log 2>&1",
      "",
    ].join("\n"))

    expect(installed).not.toContain("/opt/old/cron-trigger.sh")
    expect(activeSchedules(installed, AUTO_ACTIONS)).toEqual(["2-59/10 * * * *"])
    expect(activeSchedules(installed, RENEWAL)).toEqual(["35 2 * * *"])
  })

  it("leaves unrelated lines of the crontab alone", () => {
    const installed = installCrontab("15 2 * * * /usr/local/bin/unrelated-backup\n")

    expect(installed).toContain("15 2 * * * /usr/local/bin/unrelated-backup")
  })

  it("calls endpoints that exist and answer the trigger's POST", () => {
    for (const endpoint of [AUTO_ACTIONS, RENEWAL]) {
      const route = readFileSync(join(process.cwd(), `src/app${endpoint}/route.ts`), "utf8")
      expect([endpoint, route.includes("export async function POST("), route.includes("requireCronAuth(req)")]).toEqual([endpoint, true, true])
    }
  })
})
