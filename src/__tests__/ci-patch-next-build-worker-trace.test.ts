/**
 * Every CI production build runs scripts/ci/patch-next-build-worker-trace.mjs
 * before `next build`: with the webpack build worker, the server compiler's
 * result crosses IPC as one JSON string, and on 2026-10-21 its debug trace
 * events alone were 349,059,529 of V8's 536,870,888-character limit — the
 * build died there and hung until the step timeout.
 *
 * The patch edits node_modules, so it is tested on COPIES of the installed
 * Next files, never on the installed ones: that it changes exactly the one
 * line, says so again without changing anything, and refuses — changing
 * nothing — on a Next it was not written for. The last case checks behaviour,
 * not text: with the value the patched launcher passes, the installed Next
 * trace module keeps no spans for the worker to send back.
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, "scripts", "ci", "patch-next-build-worker-trace.mjs")
const requireFromRoot = createRequire(path.join(ROOT, "package.json"))
const NEXT_DIR = path.dirname(requireFromRoot.resolve("next/package.json"))
const INSTALLED_VERSION: string = JSON.parse(readFileSync(path.join(NEXT_DIR, "package.json"), "utf8")).version
const LAUNCHER = "dist/build/webpack-build/index.js"
const WORKER = "dist/build/webpack-build/impl.js"
const TRACE = "dist/trace/trace.js"
const COPIED = [LAUNCHER, WORKER, TRACE]

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
const installedBefore = Object.fromEntries(COPIED.map((file) => [file, sha256(path.join(NEXT_DIR, file))]))

const scratch = mkdtempSync(path.join(tmpdir(), "next-build-worker-trace-"))
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
  // The installed Next is shared by every worktree on the box: it must leave
  // this file exactly as it found it.
  for (const file of COPIED) expect(sha256(path.join(NEXT_DIR, file)), file).toBe(installedBefore[file])
})

let projects = 0
function project(options: { version?: string; edit?: Partial<Record<string, (source: string) => string>> } = {}) {
  const root = path.join(scratch, `project-${++projects}`)
  const next = path.join(root, "node_modules", "next")
  mkdirSync(next, { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "probe", private: true }))
  writeFileSync(path.join(next, "package.json"), JSON.stringify({ name: "next", version: options.version ?? INSTALLED_VERSION }))
  for (const file of COPIED) {
    mkdirSync(path.dirname(path.join(next, file)), { recursive: true })
    cpSync(path.join(NEXT_DIR, file), path.join(next, file))
    const edit = options.edit?.[file]
    if (edit) writeFileSync(path.join(next, file), edit(readFileSync(path.join(next, file), "utf8")))
  }
  return {
    root,
    file: (file: string) => path.join(next, file),
    read: (file: string) => readFileSync(path.join(next, file), "utf8"),
  }
}

function patch(root: string, cwd = ROOT) {
  const args = cwd === root ? [SCRIPT] : [SCRIPT, root]
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8" })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

const count = (text: string, needle: string) => text.split(needle).length - 1

describe("patch-next-build-worker-trace", () => {
  it("is written for the Next this repository installs", () => {
    expect(INSTALLED_VERSION).toMatch(/^16\.2\.\d+$/)
  })

  it("finds the installed Next unpatched — the patch runs only in CI build jobs", () => {
    expect(
      readFileSync(path.join(NEXT_DIR, LAUNCHER), "utf8"),
      "node_modules/next was patched in place; reinstall it (npm ci) — the patch belongs to CI build jobs only",
    ).not.toContain("leaddrive: scripts/ci/patch-next-build-worker-trace.mjs")
  })

  it("turns off saving trace events in the worker launch, on exactly one line", () => {
    const copy = project()
    const original = copy.read(LAUNCHER)
    const others = [WORKER, TRACE].map((file) => sha256(copy.file(file)))

    const run = patch(copy.root)
    expect(run.status, run.out).toBe(0)
    expect(run.out).toContain("patched")
    expect(run.out).toContain(`next ${INSTALLED_VERSION}`)

    const patched = copy.read(LAUNCHER)
    const before = original.split("\n")
    const after = patched.split("\n")
    expect(after).toHaveLength(before.length)
    const changed = after.flatMap((line, index) => (line === before[index] ? [] : [[before[index], line]]))
    expect(changed).toEqual([
      [
        "                shouldSaveTraceEvents: true",
        "                shouldSaveTraceEvents: false /* leaddrive: scripts/ci/patch-next-build-worker-trace.mjs */",
      ],
    ])
    // The changed line is the one inside the worker launch's traceState.
    const launch = patched.slice(patched.indexOf("await worker.workerMain({"), patched.indexOf("recordTraceEvents)(curResult.debugTraceEvents)"))
    expect(launch).toContain("shouldSaveTraceEvents: false")
    expect(count(patched, "shouldSaveTraceEvents: true")).toBe(0)
    // Read, never written.
    expect([WORKER, TRACE].map((file) => sha256(copy.file(file)))).toEqual(others)
  })

  it("says «already patched» on a second run and changes nothing", () => {
    const copy = project()
    expect(patch(copy.root).status).toBe(0)
    const once = sha256(copy.file(LAUNCHER))

    const again = patch(copy.root)
    expect(again.status, again.out).toBe(0)
    expect(again.out).toContain("already patched")
    expect(sha256(copy.file(LAUNCHER))).toBe(once)
  })

  it("resolves Next from the current directory by default, not from its own checkout", () => {
    const copy = project()
    const run = patch(copy.root, copy.root)
    expect(run.status, run.out).toBe(0)
    expect(run.out).toContain(copy.file(LAUNCHER))
    expect(copy.read(LAUNCHER)).toContain("shouldSaveTraceEvents: false")
  })

  it.each(["16.3.0", "16.1.7", "17.0.0", "15.5.4"])("refuses Next %s and changes nothing", (version) => {
    const copy = project({ version })
    const before = sha256(copy.file(LAUNCHER))
    const run = patch(copy.root)
    expect(run.status).toBe(1)
    expect(run.out).toContain(`installed next is ${version}`)
    expect(run.out).toContain("::error::")
    expect(sha256(copy.file(LAUNCHER))).toBe(before)
  })

  it.each([
    ["the line is gone", (source: string) => source.replace("shouldSaveTraceEvents: true", "shouldSaveTraceEvents: process.env.TRACE === '1'"), /found 0 unpatched and 0 patched/],
    [
      "the line occurs twice",
      (source: string) => {
        const at = source.indexOf("                defaultParentSpanId: nextBuildSpan")
        const block = source.slice(at, source.indexOf("}", at) + 1)
        return source.replace(block, `${block},\n${block}`)
      },
      /found 2 unpatched and 0 patched/,
    ],
  ])("refuses when %s and changes nothing", (_label, edit, message) => {
    const copy = project({ edit: { [LAUNCHER]: edit } })
    const before = sha256(copy.file(LAUNCHER))
    const run = patch(copy.root)
    expect(run.status).toBe(1)
    expect(run.out).toMatch(message)
    expect(sha256(copy.file(LAUNCHER))).toBe(before)
  })

  it.each([
    [WORKER, "debugTraceEvents: (0, _trace.getTraceEvents)()", "debugTraceEvents: collectTraceEvents()", /no longer returns getTraceEvents/],
    [WORKER, "(0, _trace.initializeTraceState)(workerData.traceState);", "(0, _trace.initializeTraceState)(workerData.trace);", /no longer takes its trace state/],
    [TRACE, "shouldSaveTraceEvents = state.shouldSaveTraceEvents;", "shouldSaveTraceEvents = true;", /no longer reads shouldSaveTraceEvents/],
  ])("refuses when %s no longer works the way the patch assumes", (file, from, to, message) => {
    const copy = project({ edit: { [file]: (source: string) => source.replace(from, to) } })
    const before = sha256(copy.file(LAUNCHER))
    const run = patch(copy.root)
    expect(run.status).toBe(1)
    expect(run.out).toMatch(message)
    expect(sha256(copy.file(LAUNCHER))).toBe(before)
  })

  it("refuses when there is no Next to patch", () => {
    const root = path.join(scratch, "no-next")
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, "package.json"), "{}")
    const run = patch(root)
    expect(run.status).toBe(1)
    expect(run.out).toContain("cannot resolve next")
  })

  it("with the value the patched launcher passes, the installed trace module keeps no spans to send", () => {
    const copy = project()
    expect(patch(copy.root).status).toBe(0)
    const passed = copy.read(LAUNCHER).match(/shouldSaveTraceEvents: (true|false)\b/)?.[1]
    expect(passed).toBe("false")

    const trace = requireFromRoot(path.join(NEXT_DIR, TRACE))
    const kept = (shouldSaveTraceEvents: boolean) => {
      trace.clearTraceEvents()
      trace.initializeTraceState({ lastId: 0, defaultParentSpanId: undefined, shouldSaveTraceEvents })
      const span = trace.trace("build-module", undefined, { name: "next-app-loader?page=%2Fapi%2Fprobe" })
      span.traceChild("add-entry").stop()
      span.stop()
      return trace.getTraceEvents().length
    }
    try {
      // The comparison can say «different»: the original value keeps both spans.
      expect(kept(true)).toBe(2)
      expect(kept(passed === "true")).toBe(0)
    } finally {
      trace.clearTraceEvents()
      trace.initializeTraceState({ lastId: 0, defaultParentSpanId: undefined, shouldSaveTraceEvents: undefined })
    }
  })
})
