#!/usr/bin/env node
/**
 * Stops Next's webpack build worker from sending its debug trace events back
 * to the parent process. Run it after `npm ci` and before every production
 * `next build` that uses the build worker.
 *
 * Why. next.config.ts turns `experimental.webpackBuildWorker` on for
 * LEADDRIVE_COLD_PRODUCTION_BUILD=1, which is every CI production build. Each
 * compiler (server, edge-server, client) then runs in a jest-worker child and
 * returns its result over child_process IPC, and IPC JSON.stringify's the whole
 * message. V8 cannot make a string longer than 536,870,888 characters.
 * Measured 2026-10-21 in GitHub Actions, server compiler, commit b622b96c8:
 *
 *   debugTraceEvents    349,059,529 chars (20,365 events)
 *   buildTraceContext   186,969,077
 *   pluginState           1,273,938
 *   total               ≈ 537,000,000  > 536,870,888
 *
 * Most of the trace events are build-module (172.8M) and add-entry (172.3M):
 * each span of a next-app-loader module carries the ~100 KB loader query of
 * its route, so every route adds about 300 K characters. Past the limit the
 * worker throws "RangeError: Invalid string length" in writeChannelMessage as
 * an unhandled rejection, the parent never hears back, and the step sits on
 * "Creating an optimized production build" until its timeout (60 minutes in
 * that run). The parent commit, one route fewer, still built.
 *
 * What changes: one literal in node_modules/next/dist/build/webpack-build/index.js.
 * The parent starts each worker with `traceState.shouldSaveTraceEvents: true`;
 * this makes it `false`. The worker then keeps no copy of its spans and
 * returns `debugTraceEvents: []`. In the parent those events only feed
 * `recordTraceEvents`, i.e. the .next/trace debug file; no build output reads
 * them. `buildTraceContext` — output file tracing for the standalone bundle —
 * is not touched.
 *
 * It refuses (exit 1) unless the installed Next is 16.2.x, the line it
 * changes occurs exactly once, and the worker still uses that flag the way
 * described above. A second run says "already patched" and exits 0.
 *
 *   node scripts/ci/patch-next-build-worker-trace.mjs [--allow-local] [project-root]
 *
 * It also refuses outside GitHub Actions (GITHUB_ACTIONS !== "true") unless
 * --allow-local is given: on a development box node_modules/next is often a
 * symlink shared by every worktree, and one manual run would patch all of
 * them. Pass the flag only for a node_modules that belongs to that one
 * project, such as the copies the test builds.
 *
 * The project root defaults to the current directory: Next is resolved from
 * there, not from this script's own checkout, so a workflow can patch a
 * checkout of another commit with this script.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const NAME = "patch-next-build-worker-trace"
const SUPPORTED_VERSION = /^16\.2\.\d+$/
const MARKER = "/* leaddrive: scripts/ci/patch-next-build-worker-trace.mjs */"

// The worker launch in webpackBuildWithWorker, exactly as Next 16.2.11 ships it.
const NEEDLE = [
  "                defaultParentSpanId: nextBuildSpan == null ? void 0 : nextBuildSpan.getId(),",
  "                shouldSaveTraceEvents: true",
  "            }",
].join("\n")
const PATCHED = [
  "                defaultParentSpanId: nextBuildSpan == null ? void 0 : nextBuildSpan.getId(),",
  `                shouldSaveTraceEvents: false ${MARKER}`,
  "            }",
].join("\n")

// Read, never written: what makes `false` mean "the worker sends nothing".
const PREMISES = [
  [
    "dist/build/webpack-build/impl.js",
    "(0, _trace.initializeTraceState)(workerData.traceState);",
    "the worker no longer takes its trace state from the parent",
  ],
  [
    "dist/build/webpack-build/impl.js",
    "debugTraceEvents: (0, _trace.getTraceEvents)()",
    "the worker no longer returns getTraceEvents() as debugTraceEvents",
  ],
  [
    "dist/trace/trace.js",
    "shouldSaveTraceEvents = state.shouldSaveTraceEvents;",
    "initializeTraceState no longer reads shouldSaveTraceEvents",
  ],
  [
    "dist/trace/trace.js",
    "if (shouldSaveTraceEvents) {\n                savedTraceEvents.push(traceEvent);",
    "spans are no longer kept only when shouldSaveTraceEvents is set",
  ],
]

function refuse(message) {
  console.error(`::error::${NAME}: ${message}`)
  console.error(
    `${NAME}: nothing was changed. Without this patch a production build with the webpack ` +
      "build worker dies once the server compiler's result passes V8's 536,870,888-character " +
      "string limit (see the header of scripts/ci/patch-next-build-worker-trace.mjs).",
  )
  process.exit(1)
}

function occurrences(text, needle) {
  let count = 0
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count++
  return count
}

const ALLOW_LOCAL = "--allow-local"
const args = process.argv.slice(2)
const positional = args.filter((arg) => arg !== ALLOW_LOCAL)
if (positional.length > 1 || positional.some((arg) => arg.startsWith("-"))) {
  refuse(`usage: node scripts/ci/patch-next-build-worker-trace.mjs [${ALLOW_LOCAL}] [project-root] (got: ${args.join(" ")})`)
}
if (process.env.GITHUB_ACTIONS !== "true" && !args.includes(ALLOW_LOCAL)) {
  refuse(
    "refusing to patch node_modules outside GitHub Actions (GITHUB_ACTIONS is not \"true\"). " +
      "On a development box node_modules/next may be shared by every worktree, and this would " +
      `change all of their builds. Pass ${ALLOW_LOCAL} only for a node_modules that belongs to this one project.`,
  )
}
const root = path.resolve(positional[0] ?? process.cwd())
let packageJson
try {
  packageJson = createRequire(path.join(root, "package.json")).resolve("next/package.json")
} catch (error) {
  refuse(`cannot resolve next from ${root}: ${error.message}`)
}
const nextDir = path.dirname(packageJson)
const { version } = JSON.parse(readFileSync(packageJson, "utf8"))
if (!SUPPORTED_VERSION.test(String(version))) {
  refuse(
    `installed next is ${version} (${nextDir}); this patch was written for 16.2.x. ` +
      "Read the new dist/build/webpack-build/index.js and impl.js, check whether the worker " +
      "still returns debugTraceEvents over IPC, and update or retire this script.",
  )
}

for (const [file, text, meaning] of PREMISES) {
  let source
  try {
    source = readFileSync(path.join(nextDir, file), "utf8")
  } catch (error) {
    refuse(`next ${version}: cannot read ${file}: ${error.message}`)
  }
  if (!source.includes(text)) refuse(`next ${version}: ${meaning} (${file})`)
}

const target = path.join(nextDir, "dist/build/webpack-build/index.js")
const source = readFileSync(target, "utf8")
const unpatched = occurrences(source, NEEDLE)
const patched = occurrences(source, PATCHED)

if (unpatched === 0 && patched === 1) {
  console.log(`${NAME}: already patched — ${target} (next ${version})`)
  process.exit(0)
}
if (unpatched !== 1 || patched !== 0) {
  refuse(
    `expected the build-worker traceState line exactly once in ${target}, ` +
      `found ${unpatched} unpatched and ${patched} patched`,
  )
}

writeFileSync(target, source.replace(NEEDLE, PATCHED))
console.log(`${NAME}: patched ${target} (next ${version})`)
console.log("  webpackBuildWithWorker → worker.workerMain({ traceState })")
console.log("  - shouldSaveTraceEvents: true")
console.log(`  + shouldSaveTraceEvents: false ${MARKER}`)
console.log("  The worker now returns debugTraceEvents: [] instead of every span over IPC.")
