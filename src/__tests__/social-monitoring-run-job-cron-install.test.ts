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
import { describe, expect, it } from "vitest"

const script = readFileSync(
  join(process.cwd(), "scripts/install-resilience-crons.sh"),
  "utf8",
)
const deployWorkflow = readFileSync(
  join(process.cwd(), ".github/workflows/deploy.yml"),
  "utf8",
)

function installCrontab(initialCrontab: string) {
  const root = mkdtempSync(join(tmpdir(), "leaddrive-social-queue-cron-"))
  const bin = join(root, "bin")
  const scripts = join(root, "scripts")
  const state = join(root, "crontab")

  try {
    mkdirSync(bin)
    mkdirSync(scripts)
    writeFileSync(state, initialCrontab)
    writeFileSync(
      join(bin, "crontab"),
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "-l" ]; then
  cat "$CRONTAB_STATE"
else
  cp "$1" "$CRONTAB_STATE"
fi
`,
    )
    chmodSync(join(bin, "crontab"), 0o755)
    writeFileSync(join(bin, "flock"), "#!/bin/sh\nexit 0\n")
    chmodSync(join(bin, "flock"), 0o755)
    writeFileSync(join(scripts, "cron-trigger.sh"), "#!/bin/sh\nexit 0\n")
    chmodSync(join(scripts, "cron-trigger.sh"), 0o755)

    execFileSync(
      "bash",
      [join(process.cwd(), "scripts/install-resilience-crons.sh")],
      {
        env: {
          ...process.env,
          CRONTAB_STATE: state,
          LOG: join(root, "cron.log"),
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          SCRIPTS: scripts,
        },
        stdio: "pipe",
      },
    )

    return readFileSync(state, "utf8")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function activeSchedules(crontab: string, endpoint: string) {
  return crontab
    .split("\n")
    .filter(
      (line) =>
        !line.trimStart().startsWith("#") &&
        line.includes(`cron-trigger.sh ${endpoint}`),
    )
}

describe("durable Social Monitoring queue schedule", () => {
  it("installs a dedicated minute runner without accelerating cadence collection", () => {
    expect(script).toContain(
      "* * * * * $TRIGGER /api/cron/social-monitoring-run-jobs",
    )
    expect(script).toContain(
      "*/5 * * * * $TRIGGER /api/cron/social-monitoring-sources",
    )
  })

  it("keeps exactly one queue drain active while legacy social crons stay disabled", () => {
    const installed = installCrontab(`# BEGIN LEADDRIVE RESILIENCE CRONS
# LEADDRIVE SOCIAL CRONS DISABLED
# */5 * * * * /old/cron-trigger.sh /api/cron/social-monitoring-sources
# * * * * * /old/cron-trigger.sh /api/cron/social-monitoring-run-jobs
# END LEADDRIVE RESILIENCE CRONS
`)

    expect(
      activeSchedules(installed, "/api/cron/social-monitoring-run-jobs"),
    ).toHaveLength(1)
    expect(
      activeSchedules(installed, "/api/cron/social-monitoring-sources"),
    ).toHaveLength(0)
    expect(installed).toContain("# LEADDRIVE SOCIAL CRONS DISABLED")
    expect(
      installed
        .split("\n")
        .some(
          (line) =>
            line.trimStart().startsWith("#") &&
            line.includes(
              "cron-trigger.sh /api/cron/social-monitoring-sources",
            ),
        ),
    ).toBe(true)

    const reinstalled = installCrontab(installed)
    expect(
      activeSchedules(reinstalled, "/api/cron/social-monitoring-run-jobs"),
    ).toHaveLength(1)
    expect(reinstalled).toContain("# LEADDRIVE SOCIAL CRONS DISABLED")
  })
})

describe("sequential AI-call queue schedule", () => {
  it("installs exactly one minute runner and removes legacy duplicates", () => {
    expect(script).toContain(
      "* * * * * $TRIGGER /api/cron/voice-call-queues",
    )

    const installed = installCrontab(`# BEGIN LEADDRIVE RESILIENCE CRONS
* * * * * /old/cron-trigger.sh /api/cron/voice-call-queues
# END LEADDRIVE RESILIENCE CRONS
* * * * * /older/cron-trigger.sh /api/cron/voice-call-queues
`)

    expect(
      activeSchedules(installed, "/api/cron/voice-call-queues"),
    ).toHaveLength(1)

    const reinstalled = installCrontab(installed)
    expect(
      activeSchedules(reinstalled, "/api/cron/voice-call-queues"),
    ).toHaveLength(1)
  })
})

describe("MTM route notification outbox schedule", () => {
  it("installs exactly one minute worker and removes legacy duplicates", () => {
    expect(script).toContain(
      "* * * * * $TRIGGER mtm-route-notification-outbox",
    )

    const installed = installCrontab(`# BEGIN LEADDRIVE RESILIENCE CRONS
* * * * * /old/cron-trigger.sh mtm-route-notification-outbox
# END LEADDRIVE RESILIENCE CRONS
* * * * * /older/cron-trigger.sh mtm-route-notification-outbox
`)

    expect(
      activeSchedules(installed, "mtm-route-notification-outbox"),
    ).toHaveLength(1)

    const reinstalled = installCrontab(installed)
    expect(
      activeSchedules(reinstalled, "mtm-route-notification-outbox"),
    ).toHaveLength(1)
  })
})

describe("retired branch-only MTM mobile sync v2 snapshot cleanup schedule", () => {
  it("removes legacy duplicate schedules without reinstalling the removed route", () => {
    expect(script).not.toContain(
      "*/15 * * * * $TRIGGER mtm-mobile-sync-v2-snapshot-cleanup",
    )

    const installed = installCrontab(`# BEGIN LEADDRIVE RESILIENCE CRONS
*/15 * * * * /old/cron-trigger.sh mtm-mobile-sync-v2-snapshot-cleanup
# END LEADDRIVE RESILIENCE CRONS
*/15 * * * * /older/cron-trigger.sh mtm-mobile-sync-v2-snapshot-cleanup
`)

    expect(
      activeSchedules(installed, "mtm-mobile-sync-v2-snapshot-cleanup"),
    ).toHaveLength(0)

    const reinstalled = installCrontab(installed)
    expect(
      activeSchedules(reinstalled, "mtm-mobile-sync-v2-snapshot-cleanup"),
    ).toHaveLength(0)
  })
})

describe("Chatwoot TikTok inbound backstop schedule", () => {
  it("installs exactly one minute runner and removes legacy duplicates", () => {
    expect(script).toContain(
      "* * * * * $TRIGGER /api/cron/chatwoot-inbound-poll",
    )

    const installed = installCrontab(`# BEGIN LEADDRIVE RESILIENCE CRONS
* * * * * /old/cron-trigger.sh /api/cron/chatwoot-inbound-poll
# END LEADDRIVE RESILIENCE CRONS
* * * * * /older/cron-trigger.sh /api/cron/chatwoot-inbound-poll
`)

    expect(
      activeSchedules(installed, "/api/cron/chatwoot-inbound-poll"),
    ).toHaveLength(1)

    const reinstalled = installCrontab(installed)
    expect(
      activeSchedules(reinstalled, "/api/cron/chatwoot-inbound-poll"),
    ).toHaveLength(1)
  })
})

describe("missed inbound reconciliation schedule", () => {
  it("installs exactly one minute runner and removes managed and legacy duplicates", () => {
    expect(script).toContain(
      "* * * * * $TRIGGER /api/cron/missed-inbound-reconciliation",
    )

    const installed = installCrontab(`# BEGIN LEADDRIVE RESILIENCE CRONS
* * * * * /old/cron-trigger.sh /api/cron/missed-inbound-reconciliation
# END LEADDRIVE RESILIENCE CRONS
* * * * * /older/cron-trigger.sh /api/cron/missed-inbound-reconciliation
`)

    expect(
      activeSchedules(installed, "/api/cron/missed-inbound-reconciliation"),
    ).toHaveLength(1)

    const reinstalled = installCrontab(installed)
    expect(
      activeSchedules(reinstalled, "/api/cron/missed-inbound-reconciliation"),
    ).toHaveLength(1)
  })

  it("blocks deployment unless the exact schedule and authenticated side-effect-free smoke work", () => {
    expect(deployWorkflow).toContain(
      "Verify missed inbound reconciliation scheduler",
    )
    expect(deployWorkflow).toContain(
      "/api/cron/missed-inbound-reconciliation?smoke=1",
    )
    expect(deployWorkflow).toContain(
      "expected exactly one active missed inbound reconciliation cron",
    )
    expect(deployWorkflow).toContain(
      "missed inbound reconciliation cron smoke was not side-effect-free and successful",
    )
  })
})

describe("manual callback commitment reminder schedule", () => {
  it("installs exactly one minute runner and removes legacy duplicates", () => {
    expect(script).toContain(
      "* * * * * $TRIGGER /api/cron/commitment-escalation",
    )

    const installed = installCrontab(`# BEGIN LEADDRIVE RESILIENCE CRONS
* * * * * /old/cron-trigger.sh /api/cron/commitment-escalation
# END LEADDRIVE RESILIENCE CRONS
* * * * * /older/cron-trigger.sh /api/cron/commitment-escalation
`)

    expect(
      activeSchedules(installed, "/api/cron/commitment-escalation"),
    ).toHaveLength(1)

    const reinstalled = installCrontab(installed)
    expect(
      activeSchedules(reinstalled, "/api/cron/commitment-escalation"),
    ).toHaveLength(1)
  })
})

describe("MTM mobile sync retention schedule", () => {
  it("installs one bounded retention heartbeat and removes legacy duplicates", () => {
    expect(script).toContain(
      "*/15 * * * * $TRIGGER /api/cron/mtm-cleanup",
    )

    const installed = installCrontab(`# BEGIN LEADDRIVE RESILIENCE CRONS
*/15 * * * * /old/cron-trigger.sh /api/cron/mtm-cleanup
# END LEADDRIVE RESILIENCE CRONS
*/15 * * * * /older/cron-trigger.sh /api/cron/mtm-cleanup
`)

    expect(
      activeSchedules(installed, "/api/cron/mtm-cleanup"),
    ).toHaveLength(1)

    const reinstalled = installCrontab(installed)
    expect(
      activeSchedules(reinstalled, "/api/cron/mtm-cleanup"),
    ).toHaveLength(1)
  })

  it("blocks deployment unless the exact schedule, trigger and lease heartbeat succeed", () => {
    const start = deployWorkflow.indexOf("- name: Verify MTM mobile sync retention scheduler")
    expect(start).toBeGreaterThan(-1)

    const nextStep = deployWorkflow.indexOf("\n      - name:", start + 1)
    const step = deployWorkflow.slice(start, nextStep === -1 ? undefined : nextStep)

    expect(step).toContain("/api/cron/mtm-cleanup")
    expect(step).toContain("ACTIVE_COUNT")
    expect(step).toContain('if [ "$ACTIVE_COUNT" -ne 1 ]')
    expect(step).toContain("system_job_leases")
    expect(step).toContain("lastCompletedAt")
    expect(step).toContain("mtm-cleanup\\|t")
  })
})
