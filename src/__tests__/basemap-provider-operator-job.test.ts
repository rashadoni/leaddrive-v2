/**
 * The operator job that names a backup tile provider on the running
 * deployment, and makes it the background of every map
 * (.github/workflows/set-map-provider.yml).
 *
 * It runs as root against production, so what it does is tested by RUNNING
 * it: the job's own script, taken from the workflow file as GitHub would run
 * it, with stand-ins for the four things it reaches outside itself — `ssh`
 * (runs the remote half here), `pm2` (starts a process that holds the
 * exported environment, as the app would), `curl` (the provider's tile, the
 * app's ping and the app's own answer about its provider) and `stat` (the
 * env file is root's on production). Everything else — bash, sed, flock, the
 * file itself, /proc — is real.
 *
 * A reading of the script's text would have passed while the job printed a
 * key or restarted production for an empty run; this does not.
 */
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const WORKFLOW = readFileSync(".github/workflows/set-map-provider.yml", "utf8")

/** The `run:` block of the step, as the runner's bash receives it. */
function jobScript(): string {
  const start = WORKFLOW.indexOf("        run: |\n", WORKFLOW.indexOf("Write map provider settings"))
  const end = WORKFLOW.indexOf("      - name: Cleanup SSH key")
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  return WORKFLOW.slice(start + "        run: |\n".length, end)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    // GitHub fills these in before bash sees the script.
    .replace(/\$\{\{ secrets\.SERVER_USER \}\}@\$\{\{ secrets\.SERVER_HOST \}\}/g, "root@production.example")
}

const URL_OK = "https://tiles.backup.example/v1/streets/{z}/{y}/{x}?token=SECRET-browser-key&style=a%20b"
const CREDIT = "Powered by Backup & Co | © Backup, $pecial `chars` (2026)"
const FILE_BEFORE = "NEXTAUTH_URL=https://app.leaddrivecrm.org\nCRON_SECRET=keep-me\nLAST_KEY=last-value\n"

let dir: string
let envFile: string

const stub = (name: string, body: string) => {
  const path = join(dir, "bin", name)
  writeFileSync(path, `#!/bin/bash\n${body}\n`)
  chmodSync(path, 0o755)
}
const calls = (name: string) => (existsSync(join(dir, `${name}.calls`)) ? readFileSync(join(dir, `${name}.calls`), "utf8").split("\n").filter(Boolean) : [])
const fileNow = () => readFileSync(envFile, "utf8")
/** The environment of the process that «pm2» started last — what the app would be reading. */
function appEnv(): Record<string, string> {
  const pidFile = join(dir, "pm2.pid")
  if (!existsSync(pidFile)) return {}
  const raw = readFileSync(`/proc/${readFileSync(pidFile, "utf8").trim()}/environ`, "utf8")
  return Object.fromEntries(raw.split("\0").filter(Boolean).map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]))
}

interface Run { status: number; log: string }
function runJob(given: {
  primary?: string
  url?: string
  credit?: string
  size?: string
  tile?: string
  ping?: "up" | "down"
}): Run {
  const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", jobScript()], {
    encoding: "utf8",
    env: {
      PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
      HOME: dir,
      LC_ALL: "C.UTF-8",
      SIM_DIR: dir,
      SIM_TILE: given.tile ?? "200 image/png",
      SIM_PING: given.ping ?? "up",
      APP_ENV_FILE: envFile,
      APP_ENV_LOCK_FILE: join(dir, "lock", "app-env.lock"),
      PRIMARY_CHOICE: given.primary ?? "keep",
      MTM_BASEMAP_BACKUP_TILE_URL: given.url ?? "",
      MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION: given.credit ?? "",
      MTM_BASEMAP_BACKUP_TILE_SIZE: given.size ?? "",
    },
  })
  return { status: result.status ?? -1, log: `${result.stdout}\n${result.stderr}` }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "map-provider-job-"))
  mkdirSync(join(dir, "bin"))
  mkdirSync(join(dir, "lock"))
  mkdirSync(join(dir, "etc"))
  envFile = join(dir, "etc", "app.env")
  writeFileSync(envFile, FILE_BEFORE)

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
  // over it. Nothing the shell did not export is lost, nothing it did is missed.
  stub("pm2", `
case "$1" in
  restart)
    echo "restart" >> "$SIM_DIR/pm2.calls"
    had=(); given=()
    if [ -f "$SIM_DIR/pm2.pid" ] && [ -r "/proc/$(cat "$SIM_DIR/pm2.pid")/environ" ]; then
      mapfile -d '' had < "/proc/$(cat "$SIM_DIR/pm2.pid")/environ"
      kill "$(cat "$SIM_DIR/pm2.pid")" 2>/dev/null || true
    fi
    while IFS= read -r -d '' pair; do case "$pair" in MTM_BASEMAP_*) given+=("$pair") ;; esac; done < /proc/self/environ
    ( exec env -i "\${had[@]}" "\${given[@]}" /bin/sleep 300 ) </dev/null >/dev/null 2>&1 9>&- &
    echo $! > "$SIM_DIR/pm2.pid"
    echo "│ id │ name │ status │"
    ;;
  pid) cat "$SIM_DIR/pm2.pid" 2>/dev/null || echo 0 ;;
  # This simulated host runs the web app alone: no scheduler process to restart.
  describe) exit 1 ;;
esac`)
  // The job waits for the app between its pings; the test does not have to.
  stub("sleep", "exit 0")
  // The provider's tile, the app's ping, and the app's own answer — built from
  // the environment of the process «pm2» started, by the app's own rule.
  stub("curl", `
url="\${@: -1}"
printf '%s\\n' "$*" >> "$SIM_DIR/curl.calls"
case "$url" in
  *127.0.0.1:3001/api/v1/ping) [ "$SIM_PING" = up ] ;;
  *127.0.0.1:3001/api/v1/public/basemap-provider)
    pid="$(cat "$SIM_DIR/pm2.pid")"
    held() { tr '\\0' '\\n' < "/proc/$pid/environ" | sed -n "s/^$1=//p"; }
    u="$(held MTM_BASEMAP_BACKUP_TILE_URL)"; c="$(held MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION)"; p="$(held MTM_BASEMAP_PRIMARY)"
    if [ -n "$u" ] && [ -n "$c" ]; then
      [ "$p" = backup ] || p=carto
      printf '{"success":true,"data":{"primary":"%s","backup":{"url":"%s","attribution":"x","tileSize":256}}}' "$p" "$u"
    else
      printf '{"success":true,"data":{"primary":"carto","backup":null}}'
    fi
    ;;
  *) printf '%s' "$SIM_TILE" ;;
esac`)
})

afterEach(() => {
  const pidFile = join(dir, "pm2.pid")
  if (existsSync(pidFile)) spawnSync("kill", [readFileSync(pidFile, "utf8").trim()])
  rmSync(dir, { recursive: true, force: true })
})

describe("the operator job, run", () => {
  it("started with nothing — `keep`, no secrets — touches nothing on production", () => {
    const run = runJob({})
    expect(run.status, run.log).toBe(0)
    expect(fileNow()).toBe(FILE_BEFORE)
    expect(calls("pm2")).toEqual([])
    expect(run.log).toContain("PM2 was not restarted")
  })

  it("names a provider: the values reach the file and the running process byte for byte, and the app says so", () => {
    const run = runJob({ url: URL_OK, credit: CREDIT, size: "512" })
    expect(run.status, run.log).toBe(0)

    expect(fileNow()).toBe(`${FILE_BEFORE}MTM_BASEMAP_BACKUP_TILE_URL=${URL_OK}\nMTM_BASEMAP_BACKUP_TILE_ATTRIBUTION=${CREDIT}\nMTM_BASEMAP_BACKUP_TILE_SIZE=512\n`)
    expect(calls("pm2")).toEqual(["restart"])
    const app = appEnv()
    expect(app.MTM_BASEMAP_BACKUP_TILE_URL).toBe(URL_OK)
    expect(app.MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION).toBe(CREDIT)
    expect(app.MTM_BASEMAP_BACKUP_TILE_SIZE).toBe("512")
    // `keep`: the choice of background is not among what was handed over.
    expect(app.MTM_BASEMAP_PRIMARY).toBeUndefined()
    expect(run.log).toContain("CARTO is the background and the backup steps in when CARTO refuses")
  })

  it("never prints a value — not the address, not its key, not the credit", () => {
    const run = runJob({ primary: "backup", url: URL_OK, credit: CREDIT, size: "512" })
    expect(run.status, run.log).toBe(0)
    for (const secret of ["SECRET-browser-key", "tiles.backup.example", "Powered by Backup", "$pecial"]) {
      expect(run.log, secret).not.toContain(secret)
    }
    expect(run.log).toContain("MTM_BASEMAP_BACKUP_TILE_URL: staged")
  })

  it("asks the provider for a tile the way our pages do before it names it — and names nobody who does not answer", () => {
    for (const tile of ["403 text/plain", "200 text/html", "000 ", "404 image/png"]) {
      const run = runJob({ primary: "backup", url: URL_OK, credit: CREDIT, tile })
      expect(run.status, tile).not.toBe(0)
      expect(run.log, tile).toContain("nothing was changed")
      expect(calls("ssh"), tile).toEqual([])
      expect(fileNow(), tile).toBe(FILE_BEFORE)
    }
    const asked = calls("curl")[0]
    // One real tile over Baku, every place filled in, our site as the referrer.
    expect(asked).toContain("Referer: https://app.leaddrivecrm.org/")
    expect(asked).toContain("https://tiles.backup.example/v1/streets/12/1552/2615?token=SECRET-browser-key&style=a%20b")
  })

  it("refuses, before anything leaves the runner, a provider the app would ignore or the map would choke on", () => {
    const halfSaid: Array<[string, Parameters<typeof runJob>[0]]> = [
      ["not https", { url: URL_OK.replace("https://", "http://"), credit: CREDIT }],
      ["no {z}", { url: URL_OK.replace("{z}", "12"), credit: CREDIT }],
      ["no {x}", { url: URL_OK.replace("{x}", "1"), credit: CREDIT }],
      ["no {y}", { url: URL_OK.replace("{y}", "1"), credit: CREDIT }],
      ["a key that was never put in", { url: URL_OK.replace("SECRET-browser-key", "{key}"), credit: CREDIT }],
      ["a brace that closes nothing", { url: `${URL_OK}&x={`, credit: CREDIT }],
      ["no credit", { url: URL_OK }],
      ["a credit of spaces", { url: URL_OK, credit: "   " }],
      ["a credit nobody would read", { url: URL_OK, credit: "я".repeat(301) }],
      ["a size that is not a size", { url: URL_OK, credit: CREDIT, size: "300" }],
      ["a quote that would end the quoting", { url: URL_OK, credit: "Backup's maps" }],
      ["a quote the env file would strip", { url: URL_OK, credit: "\"Backup\"" }],
      ["two lines", { url: URL_OK, credit: "Backup\nMTM_BASEMAP_PRIMARY=backup" }],
      ["a choice that is not one", { primary: "esri", url: URL_OK, credit: CREDIT }],
    ]
    for (const [why, given] of halfSaid) {
      const run = runJob(given)
      expect(run.status, why).not.toBe(0)
      expect(run.log, why).toContain("::error::")
      expect(calls("ssh"), why).toEqual([])
      expect(fileNow(), why).toBe(FILE_BEFORE)
    }
    // A credit of exactly 300 characters, in any language, is taken.
    expect(runJob({ url: URL_OK, credit: "я".repeat(300) }).status).toBe(0)
  })

  it("does not make the backup the background while no backup is named — every map would stay on CARTO while the job said otherwise", () => {
    const run = runJob({ primary: "backup" })
    expect(run.status).not.toBe(0)
    expect(run.log).toContain("no backup provider is named yet")
    expect(fileNow()).toBe(FILE_BEFORE)
    expect(calls("pm2")).toEqual([])
  })

  it("moves every map to the backup and back, with the provider named once before", () => {
    expect(runJob({ url: URL_OK, credit: CREDIT }).status).toBe(0)

    // Another day, no secrets retyped: only the choice.
    const over = runJob({ primary: "backup" })
    expect(over.status, over.log).toBe(0)
    expect(appEnv().MTM_BASEMAP_PRIMARY).toBe("backup")
    // The values named before are still what the app holds.
    expect(appEnv().MTM_BASEMAP_BACKUP_TILE_URL).toBe(URL_OK)
    expect(over.log).toContain("it is the background of every map")
    expect(fileNow().match(/^MTM_BASEMAP_PRIMARY=/gm)).toHaveLength(1)

    const back = runJob({ primary: "carto" })
    expect(back.status, back.log).toBe(0)
    expect(appEnv().MTM_BASEMAP_PRIMARY).toBe("carto")
    expect(fileNow().match(/^MTM_BASEMAP_PRIMARY=/gm)).toHaveLength(1)
    expect(fileNow()).toContain("MTM_BASEMAP_PRIMARY=carto\n")
    expect(calls("pm2")).toHaveLength(3)
  })

  it("run again with the same values changes nothing and does not restart production", () => {
    expect(runJob({ primary: "backup", url: URL_OK, credit: CREDIT }).status).toBe(0)
    const fileAfterFirst = fileNow()
    const again = runJob({ primary: "backup", url: URL_OK, credit: CREDIT })
    expect(again.status, again.log).toBe(0)
    expect(fileNow()).toBe(fileAfterFirst)
    expect(calls("pm2")).toHaveLength(1)
    expect(again.log).toContain("PM2 was not restarted")
  })

  it("but a process that lost the values — a reboot — is given them again by the same run", () => {
    expect(runJob({ primary: "backup", url: URL_OK, credit: CREDIT }).status).toBe(0)
    // The server came back from its saved state: the file has the values, the process does not.
    spawnSync("bash", ["-c", `kill "$(cat "${join(dir, "pm2.pid")}")"; ( exec env -i /bin/sleep 300 ) </dev/null >/dev/null 2>&1 & echo $! > "${join(dir, "pm2.pid")}"`])
    expect(appEnv().MTM_BASEMAP_PRIMARY).toBeUndefined()

    const again = runJob({ primary: "backup", url: URL_OK, credit: CREDIT })
    expect(again.status, again.log).toBe(0)
    expect(calls("pm2")).toHaveLength(2)
    expect(appEnv().MTM_BASEMAP_PRIMARY).toBe("backup")
  })

  it("replaces a provider instead of adding a second one, and leaves every other line of the file alone", () => {
    expect(runJob({ url: URL_OK, credit: CREDIT }).status).toBe(0)
    const other = URL_OK.replace("SECRET-browser-key", "rotated-key")
    expect(runJob({ url: other, credit: CREDIT }).status).toBe(0)

    const file = fileNow()
    expect(file.match(/^MTM_BASEMAP_BACKUP_TILE_URL=/gm)).toHaveLength(1)
    expect(file).toContain(`MTM_BASEMAP_BACKUP_TILE_URL=${other}\n`)
    expect(file.startsWith(FILE_BEFORE)).toBe(true)
    expect(appEnv().MTM_BASEMAP_BACKUP_TILE_URL).toBe(other)
    // Nothing that was in the process is blanked by a run that did not mention it.
    expect(appEnv().MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION).toBe(CREDIT)
  })

  it("does not glue its first key onto the last line of a file that ends without a line break", () => {
    writeFileSync(envFile, FILE_BEFORE.trimEnd())
    expect(runJob({ url: URL_OK, credit: CREDIT }).status).toBe(0)
    expect(fileNow()).toContain("LAST_KEY=last-value\nMTM_BASEMAP_BACKUP_TILE_URL=")
  })

  it("is red when the app does not come back after the restart — the operator must know", () => {
    const run = runJob({ url: URL_OK, credit: CREDIT, ping: "down" })
    expect(run.status).not.toBe(0)
    expect(run.log).toContain("does not answer /api/v1/ping")
  })
})
