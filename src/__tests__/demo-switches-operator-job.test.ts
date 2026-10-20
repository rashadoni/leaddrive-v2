/**
 * The operator job that turns the demo's two switches on and off on the
 * running deployment — the prospect's own Facebook Page
 * (DEMO_SOCIAL_META_APP_CONFIG_ID) and the guide's voice (DEMO_ASSISTANT_VOICE)
 * — .github/workflows/set-demo-switches.yml.
 *
 * It runs as root against production, so what it does is tested by RUNNING
 * it: the job's own steps, taken from the workflow file and run one after
 * another as GitHub runs them (a step that fails stops the ones after it),
 * with stand-ins for what they reach outside themselves — `ssh` (runs the
 * remote half here), `pm2` (starts a process that holds the exported
 * environment, as the app would), `curl` (the app's ping), `stat` (the env
 * file is root's on production) and `sleep`. Everything else — bash, sed,
 * grep, flock, the file itself, /proc — is real.
 *
 * A reading of the script's text would have passed while the job blanked the
 * Facebook switch on a voice-only run, or restarted production for an empty
 * one; this does not.
 */
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const WORKFLOW = readFileSync(".github/workflows/set-demo-switches.yml", "utf8")

const VALIDATE = "Validate inputs"
const WRITE = "Write demo switches to canonical app env and restart PM2"

/** The `run:` block of a step, as the runner's bash receives it. */
function stepScript(name: string): string {
  const at = WORKFLOW.indexOf(`      - name: ${name}\n`)
  expect(at, name).toBeGreaterThan(0)
  const start = WORKFLOW.indexOf("        run: |\n", at)
  const end = WORKFLOW.indexOf("\n      - name: ", start)
  expect(start, name).toBeGreaterThan(at)
  expect(end, name).toBeGreaterThan(start)
  return WORKFLOW.slice(start + "        run: |\n".length, end + 1)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    // GitHub fills these in before bash sees the script.
    .replace(/\$\{\{ secrets\.SERVER_USER \}\}@\$\{\{ secrets\.SERVER_HOST \}\}/g, "root@production.example")
}

/** Two staged-app rows, by the shape Prisma gives a channel_configs id. */
const APP_ROW = "ctestdemoapprow0000000001"
const OTHER_ROW = "ctestdemoapprow0000000002"
const REDIRECT = "https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback"
const FILE_BEFORE = `NEXTAUTH_URL=https://app.leaddrivecrm.org\nFACEBOOK_REDIRECT_URI=${REDIRECT}\nCRON_SECRET=keep-me\nLAST_KEY=last-value\n`
/** What the running app holds before the job: what the deploy gave it. */
const APP_BEFORE = { NODE_ENV: "production", FACEBOOK_REDIRECT_URI: REDIRECT, CRON_SECRET: "keep-me" }

let dir: string
let envFile: string

const stub = (name: string, body: string) => {
  const path = join(dir, "bin", name)
  writeFileSync(path, `#!/bin/bash\n${body}\n`)
  chmodSync(path, 0o755)
}
const calls = (name: string) => (existsSync(join(dir, `${name}.calls`)) ? readFileSync(join(dir, `${name}.calls`), "utf8").split("\n").filter(Boolean) : [])
const fileNow = () => readFileSync(envFile, "utf8")
const pidFile = () => join(dir, "pm2.pid")

/** A running «app» whose environment is exactly `env` — as PM2 would have it after a deploy or a reboot. */
function startApp(env: Record<string, string>): void {
  if (existsSync(pidFile())) spawnSync("kill", [readFileSync(pidFile(), "utf8").trim()])
  const child = spawn("/bin/sleep", ["300"], { env, detached: true, stdio: "ignore" })
  child.unref()
  writeFileSync(pidFile(), `${child.pid}\n`)
}
/** The environment of the process «pm2» runs now — what the app would be reading. */
function appEnv(): Record<string, string> {
  if (!existsSync(pidFile())) return {}
  const raw = readFileSync(`/proc/${readFileSync(pidFile(), "utf8").trim()}/environ`, "utf8")
  return Object.fromEntries(raw.split("\0").filter(Boolean).map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]))
}

interface Run { status: number; log: string }
function runJob(
  given: { social?: string; id?: string; voice?: string; ping?: "up" | "down" },
  steps: string[] = [VALIDATE, WRITE],
): Run {
  let log = ""
  for (const step of steps) {
    const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", stepScript(step)], {
      encoding: "utf8",
      env: {
        PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
        HOME: dir,
        LC_ALL: "C.UTF-8",
        SIM_DIR: dir,
        SIM_PING: given.ping ?? "up",
        APP_ENV_FILE: envFile,
        APP_ENV_LOCK_FILE: join(dir, "lock", "app-env.lock"),
        SOCIAL_PAGE_CHOICE: given.social ?? "keep",
        SOCIAL_APP_CONFIG_ID: given.id ?? "",
        VOICE_CHOICE: given.voice ?? "keep",
      },
    })
    log += `${result.stdout}\n${result.stderr}\n`
    // A failed step ends the job: GitHub runs nothing after it but the cleanup.
    if (result.status !== 0) return { status: result.status ?? -1, log }
  }
  return { status: 0, log }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "demo-switches-job-"))
  mkdirSync(join(dir, "bin"))
  mkdirSync(join(dir, "lock"))
  mkdirSync(join(dir, "etc"))
  envFile = join(dir, "etc", "app.env")
  writeFileSync(envFile, FILE_BEFORE)
  startApp(APP_BEFORE)

  // «ssh … host "KEY='value' … bash -s"» with the remote half on stdin: run it here.
  stub("ssh", `
echo "ssh" >> "$SIM_DIR/ssh.calls"
while [ $# -gt 0 ]; do case "$1" in -o|-i) shift 2 ;; *) break ;; esac; done
shift
exec bash -c "$1"`)
  // The env file is root's, 0600, in a directory nobody else may write: say so, as production does.
  stub("stat", `
case "$2" in
  '%U:%G') echo "root:root" ;;
  '%a') echo "755" ;;
  '%U:%G:%a') echo "root:root:600" ;;
  *) exec /usr/bin/stat "$@" ;;
esac`)
  // «pm2 restart --update-env», as PM2 does it: a new process whose
  // environment is the old process's with this shell's exported values merged
  // over it. Nothing the shell did not export is lost, nothing it did is missed
  // — and an empty value it exported arrives empty.
  stub("pm2", `
case "$1" in
  restart)
    echo "restart" >> "$SIM_DIR/pm2.calls"
    had=(); given=()
    if [ -f "$SIM_DIR/pm2.pid" ] && [ -r "/proc/$(cat "$SIM_DIR/pm2.pid")/environ" ]; then
      mapfile -d '' had < "/proc/$(cat "$SIM_DIR/pm2.pid")/environ"
      kill "$(cat "$SIM_DIR/pm2.pid")" 2>/dev/null || true
    fi
    while IFS= read -r -d '' pair; do case "$pair" in DEMO_*|GIVEN_KEYS=*) given+=("$pair") ;; esac; done < /proc/self/environ
    ( exec env -i "\${had[@]}" "\${given[@]}" /bin/sleep 300 ) </dev/null >/dev/null 2>&1 9>&- &
    echo $! > "$SIM_DIR/pm2.pid"
    echo "│ id │ name │ status │"
    ;;
  pid) cat "$SIM_DIR/pm2.pid" 2>/dev/null || echo 0 ;;
esac`)
  // The job waits for the app between its pings; the test does not have to.
  stub("sleep", "exit 0")
  // The app's ping — and nothing else: there is no read-only endpoint that
  // says whether the demo's app row resolves, and the job must not pretend one.
  stub("curl", `
url="\${@: -1}"
printf '%s\\n' "$*" >> "$SIM_DIR/curl.calls"
case "$url" in
  *127.0.0.1:3001/api/v1/ping) [ "$SIM_PING" = up ] ;;
  *) exit 7 ;;
esac`)
})

afterEach(() => {
  if (existsSync(pidFile())) spawnSync("kill", [readFileSync(pidFile(), "utf8").trim()])
  rmSync(dir, { recursive: true, force: true })
})

describe("the demo switches operator job, run", () => {
  it("started with keep and keep, touches nothing — production is not even contacted", () => {
    const run = runJob({})
    expect(run.status, run.log).toBe(0)
    expect(fileNow()).toBe(FILE_BEFORE)
    expect(calls("ssh")).toEqual([])
    expect(calls("pm2")).toEqual([])
    expect(run.log).toContain("PM2 was not restarted")
  })

  it("on with an id: the id reaches the file and the running process, and nothing else moves", () => {
    const run = runJob({ social: "on", id: APP_ROW })
    expect(run.status, run.log).toBe(0)

    expect(fileNow()).toBe(`${FILE_BEFORE}DEMO_SOCIAL_META_APP_CONFIG_ID=${APP_ROW}\n`)
    expect(calls("pm2")).toEqual(["restart"])
    const app = appEnv()
    expect(app.DEMO_SOCIAL_META_APP_CONFIG_ID).toBe(APP_ROW)
    // What the process had is still what it has.
    expect(app.FACEBOOK_REDIRECT_URI).toBe(REDIRECT)
    expect(app.CRON_SECRET).toBe("keep-me")
    // `keep`: the voice is not among what was handed over, nor the job's own bookkeeping.
    expect(app.DEMO_ASSISTANT_VOICE).toBeUndefined()
    expect(app.GIVEN_KEYS).toBeUndefined()
    expect(run.log).toContain("ping ok")
    expect(run.log).toContain("running process holds: DEMO_SOCIAL_META_APP_CONFIG_ID")
    expect(run.log).toContain("Facebook Page in the demo: on")
    // Only the ping is asked — no endpoint the app does not have.
    expect(calls("curl").length).toBeGreaterThan(0)
    for (const asked of calls("curl")) expect(asked).toContain("127.0.0.1:3001/api/v1/ping")
  })

  it("off writes the key empty — what the app reads as no id — and the process holds no id", () => {
    expect(runJob({ social: "on", id: APP_ROW }).status).toBe(0)
    const run = runJob({ social: "off" })
    expect(run.status, run.log).toBe(0)

    expect(fileNow()).toBe(`${FILE_BEFORE}DEMO_SOCIAL_META_APP_CONFIG_ID=\n`)
    expect(fileNow().match(/^DEMO_SOCIAL_META_APP_CONFIG_ID=/gm)).toHaveLength(1)
    expect(appEnv().DEMO_SOCIAL_META_APP_CONFIG_ID).toBe("")
    expect(appEnv().FACEBOOK_REDIRECT_URI).toBe(REDIRECT)
    expect(calls("pm2")).toHaveLength(2)
    expect(run.log).toContain("Facebook Page in the demo: off")
  })

  it("off where the switch was never on changes nothing — but off reaches a process that holds an id the file does not", () => {
    const never = runJob({ social: "off" })
    expect(never.status, never.log).toBe(0)
    expect(never.log).toContain("DEMO_SOCIAL_META_APP_CONFIG_ID: already so")
    expect(fileNow()).toBe(FILE_BEFORE)
    expect(calls("pm2")).toEqual([])

    // The file says nothing, the process was given an id some other way.
    startApp({ ...APP_BEFORE, DEMO_SOCIAL_META_APP_CONFIG_ID: APP_ROW })
    const run = runJob({ social: "off" })
    expect(run.status, run.log).toBe(0)
    expect(calls("pm2")).toEqual(["restart"])
    expect(appEnv().DEMO_SOCIAL_META_APP_CONFIG_ID).toBe("")
    expect(fileNow()).toBe(`${FILE_BEFORE}DEMO_SOCIAL_META_APP_CONFIG_ID=\n`)
  })

  it("refuses a bad id, or an id without on, before the production key is installed", () => {
    // The order GitHub runs them in: the inputs are judged before the key exists on the runner.
    expect(WORKFLOW.indexOf(`- name: ${VALIDATE}`)).toBeLessThan(WORKFLOW.indexOf("- name: Setup pinned production SSH"))
    expect(WORKFLOW.indexOf("- name: Setup pinned production SSH")).toBeLessThan(WORKFLOW.indexOf(`- name: ${WRITE}`))

    const refused: Array<[string, Parameters<typeof runJob>[0]]> = [
      ["on without an id", { social: "on" }],
      ["not a cuid", { social: "on", id: "not-a-cuid" }],
      ["upper case", { social: "on", id: APP_ROW.toUpperCase() }],
      ["too short", { social: "on", id: "c123" }],
      ["too long", { social: "on", id: `c${"a".repeat(31)}` }],
      ["a quote that would end the quoting", { social: "on", id: `${APP_ROW}'; touch /tmp/owned; '` }],
      ["two lines", { social: "on", id: `${APP_ROW}\nDEMO_ASSISTANT_VOICE=on` }],
      ["a space before it", { social: "on", id: ` ${APP_ROW}` }],
      ["an id with keep", { social: "keep", id: APP_ROW }],
      ["an id with off", { social: "off", id: APP_ROW }],
      ["a social choice that is not one", { social: "yes" }],
      ["a voice choice that is not one", { voice: "loud" }],
    ]
    for (const [why, given] of refused) {
      // Refused by the step that runs before the key is installed, on its own.
      expect(runJob(given, [VALIDATE]).status, why).not.toBe(0)
      const run = runJob(given)
      expect(run.status, why).not.toBe(0)
      expect(run.log, why).toContain("::error::")
      expect(run.log, why).toContain("nothing was changed")
      if (given.id?.trim()) expect(run.log, why).not.toContain(given.id.trim())
      expect(calls("ssh"), why).toEqual([])
      expect(calls("pm2"), why).toEqual([])
      expect(fileNow(), why).toBe(FILE_BEFORE)
    }

    // And where the id is put into the remote command line, it is held to its shape again.
    for (const id of [`${APP_ROW}'; touch /tmp/owned; '`, `${APP_ROW}\nDEMO_ASSISTANT_VOICE=on`, "not-a-cuid"]) {
      const run = runJob({ social: "on", id }, [WRITE])
      expect(run.status, id).not.toBe(0)
      expect(calls("ssh"), id).toEqual([])
    }

    // A cuid of 21 or 31 characters is taken.
    expect(runJob({ social: "on", id: `c${"a".repeat(20)}` }).status).toBe(0)
    expect(runJob({ social: "on", id: `c${"0".repeat(30)}` }).status).toBe(0)
  })

  it("does not switch the Facebook Page on while the running app has no redirect URI — the app would ignore the id", () => {
    startApp({ NODE_ENV: "production", CRON_SECRET: "keep-me" })
    const run = runJob({ social: "on", id: APP_ROW })
    expect(run.status).not.toBe(0)
    expect(run.log).toContain("no FACEBOOK_REDIRECT_URI")
    expect(run.log).toContain("nothing was changed")
    expect(fileNow()).toBe(FILE_BEFORE)
    expect(calls("pm2")).toEqual([])

    // Nor while the app cannot be asked at all.
    spawnSync("kill", [readFileSync(pidFile(), "utf8").trim()])
    rmSync(pidFile())
    const down = runJob({ social: "on", id: APP_ROW })
    expect(down.status).not.toBe(0)
    expect(down.log).toContain("cannot be read")
    expect(fileNow()).toBe(FILE_BEFORE)

    // Off needs nothing of the kind.
    startApp({ NODE_ENV: "production" })
    expect(runJob({ social: "off" }).status).toBe(0)
  })

  it("voice on and off take turns on one line, and leave the Facebook switch where it was", () => {
    expect(runJob({ social: "on", id: APP_ROW }).status).toBe(0)

    const on = runJob({ voice: "on" })
    expect(on.status, on.log).toBe(0)
    expect(fileNow()).toContain("DEMO_ASSISTANT_VOICE=on\n")
    expect(appEnv().DEMO_ASSISTANT_VOICE).toBe("on")
    // `keep` arrived on the server as an empty id; it must not have reached the app as off.
    expect(appEnv().DEMO_SOCIAL_META_APP_CONFIG_ID).toBe(APP_ROW)
    expect(on.log).toContain("DEMO_SOCIAL_META_APP_CONFIG_ID: not asked")
    expect(on.log).toContain("Guide voice: on")

    const off = runJob({ voice: "off" })
    expect(off.status, off.log).toBe(0)
    expect(fileNow().match(/^DEMO_ASSISTANT_VOICE=/gm)).toHaveLength(1)
    expect(fileNow()).toContain("DEMO_ASSISTANT_VOICE=off\n")
    expect(appEnv().DEMO_ASSISTANT_VOICE).toBe("off")
    expect(appEnv().DEMO_SOCIAL_META_APP_CONFIG_ID).toBe(APP_ROW)
    expect(off.log).toContain("Guide voice: off")

    expect(fileNow()).toBe(`${FILE_BEFORE}DEMO_SOCIAL_META_APP_CONFIG_ID=${APP_ROW}\nDEMO_ASSISTANT_VOICE=off\n`)
    expect(calls("pm2")).toHaveLength(3)
  })

  it("run again with the same values changes nothing and does not restart production", () => {
    expect(runJob({ social: "on", id: APP_ROW, voice: "on" }).status).toBe(0)
    const fileAfterFirst = fileNow()
    const again = runJob({ social: "on", id: APP_ROW, voice: "on" })
    expect(again.status, again.log).toBe(0)
    expect(fileNow()).toBe(fileAfterFirst)
    expect(calls("pm2")).toHaveLength(1)
    expect(again.log).toContain("DEMO_SOCIAL_META_APP_CONFIG_ID: already so")
    expect(again.log).toContain("DEMO_ASSISTANT_VOICE: already so")
    expect(again.log).toContain("PM2 was not restarted")

    expect(runJob({ social: "off", voice: "off" }).status).toBe(0)
    const fileAfterOff = fileNow()
    const offAgain = runJob({ social: "off", voice: "off" })
    expect(offAgain.status, offAgain.log).toBe(0)
    expect(fileNow()).toBe(fileAfterOff)
    expect(calls("pm2")).toHaveLength(2)
  })

  it("but a process that lost the values — a reboot — is given them again by the same run", () => {
    expect(runJob({ social: "on", id: APP_ROW }).status).toBe(0)
    // The server came back from its saved state: the file has the id, the process does not.
    startApp(APP_BEFORE)
    expect(appEnv().DEMO_SOCIAL_META_APP_CONFIG_ID).toBeUndefined()

    const again = runJob({ social: "on", id: APP_ROW })
    expect(again.status, again.log).toBe(0)
    expect(calls("pm2")).toHaveLength(2)
    expect(appEnv().DEMO_SOCIAL_META_APP_CONFIG_ID).toBe(APP_ROW)
    expect(fileNow().match(/^DEMO_SOCIAL_META_APP_CONFIG_ID=/gm)).toHaveLength(1)
  })

  it("replaces an id instead of adding a second one, and leaves every other line of the file alone", () => {
    expect(runJob({ social: "on", id: APP_ROW }).status).toBe(0)
    expect(runJob({ social: "on", id: OTHER_ROW }).status).toBe(0)
    expect(fileNow()).toBe(`${FILE_BEFORE}DEMO_SOCIAL_META_APP_CONFIG_ID=${OTHER_ROW}\n`)
    expect(appEnv().DEMO_SOCIAL_META_APP_CONFIG_ID).toBe(OTHER_ROW)
  })

  it("never prints a value — not the id, not the voice's, not what the process already had", () => {
    const logs = [
      runJob({ social: "on", id: APP_ROW, voice: "on" }).log,
      runJob({ social: "on", id: OTHER_ROW, voice: "off" }).log,
      runJob({ social: "off" }).log,
    ]
    for (const log of logs) {
      for (const value of [APP_ROW, OTHER_ROW, REDIRECT, "keep-me", "DEMO_ASSISTANT_VOICE=on", "DEMO_ASSISTANT_VOICE=off", "CONFIG_ID="]) {
        expect(log, value).not.toContain(value)
      }
    }
    expect(logs[0]).toContain("DEMO_SOCIAL_META_APP_CONFIG_ID: staged")
    expect(logs[0]).toContain("DEMO_ASSISTANT_VOICE: staged")
  })

  it("does not glue its first key onto the last line of a file that ends without a line break", () => {
    writeFileSync(envFile, FILE_BEFORE.trimEnd())
    expect(runJob({ social: "on", id: APP_ROW }).status).toBe(0)
    expect(fileNow()).toContain("LAST_KEY=last-value\nDEMO_SOCIAL_META_APP_CONFIG_ID=")
  })

  it("is red when the app does not come back after the restart — the operator must know", () => {
    const run = runJob({ social: "on", id: APP_ROW, ping: "down" })
    expect(run.status).not.toBe(0)
    expect(run.log).toContain("does not answer /api/v1/ping")
  })
})
