/**
 * The deploy copies a runtime directory (client files, PM2 logs, help videos)
 * only when it is about to move it. On 2026-11-13 production carried 42 GiB of
 * copies of every client file: since the one-time move of 2026-08-30 the
 * checkout path is a link, nothing moves, yet each deploy copied all of uploads
 * into its backup and five were kept. The function is run here for real, in
 * bash, on real directories — not read as text.
 */
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const script = readFileSync("scripts/server-deploy.sh", "utf8")
const start = script.indexOf("backup_runtime_directory() {")
const body = script.slice(start, script.indexOf("\n}\n", start) + 3)

const backup = (source: string, destination: string) =>
  execFileSync("bash", ["-c", `set -euo pipefail
log() { printf '%s\\n' "$*"; }
fatal() { printf 'FATAL %s\\n' "$*"; exit 1; }
${body}
backup_runtime_directory "$1" "$2" "canonical uploads"`, "test", source, destination], { encoding: "utf8" })

describe("the deploy's backup of a runtime directory", () => {
  const root = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "runtime-backup-"))
  const runtime = path.join(root, "var-lib", "uploads")
  mkdirSync(path.join(runtime, "tasks"), { recursive: true })
  writeFileSync(path.join(runtime, "tasks", "visual.png"), "client bytes")

  it("found the function it runs", () => {
    expect(start).toBeGreaterThan(0)
    expect(body).toContain("cp -a")
  })

  it("copies nothing when the checkout path is already a link to the runtime home", () => {
    const app = path.join(root, "app-linked")
    mkdirSync(app)
    symlinkSync(runtime, path.join(app, "uploads"))
    const destination = path.join(root, "backup-1", "uploads")
    mkdirSync(path.dirname(destination))
    const out = backup(path.join(app, "uploads"), destination)
    expect(existsSync(destination)).toBe(false)
    expect(out).toContain("nothing is moved, so nothing is copied")
    // The client files themselves are untouched.
    expect(readFileSync(path.join(runtime, "tasks", "visual.png"), "utf8")).toBe("client bytes")
  })

  it("still copies a real checkout directory before it is moved", () => {
    const app = path.join(root, "app-real")
    mkdirSync(path.join(app, "uploads", "tasks"), { recursive: true })
    writeFileSync(path.join(app, "uploads", "tasks", "old.pdf"), "pdf")
    const destination = path.join(root, "backup-2", "uploads")
    mkdirSync(path.dirname(destination))
    const out = backup(path.join(app, "uploads"), destination)
    expect(readFileSync(path.join(destination, "tasks", "old.pdf"), "utf8")).toBe("pdf")
    expect(out).toContain("Backed up canonical uploads runtime data")
  })

  it("leaves nothing behind", () => {
    rmSync(root, { recursive: true, force: true })
    expect(existsSync(root)).toBe(false)
  })
})
