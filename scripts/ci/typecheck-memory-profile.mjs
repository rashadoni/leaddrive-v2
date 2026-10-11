#!/usr/bin/env node
/**
 * Says WHERE the full-project type check spends its memory.
 *
 * `tsc --extendedDiagnostics` prints one number for the whole program, which is
 * enough to see that the heap is nearly full and not enough to see why. This
 * drives the same compiler through its API and reads the type, instantiation
 * and symbol counters after every file, so the cost lands on the file that
 * caused it.
 *
 *   node --expose-gc --max-old-space-size=<MiB> scripts/ci/typecheck-memory-profile.mjs \
 *     [--project tsconfig.json] [--top 60] [--sample-every 300] [--out profile.json]
 *
 * Read the result with one caveat: the compiler resolves types lazily, so a
 * shared type is billed to the first file that touches it. A file at the top of
 * the list is either expensive itself or merely first in line — the directory
 * totals and the phase table are the numbers to trust, the per-file list is
 * where to start reading.
 *
 * CI only: the project does not fit in the development box's memory. It
 * reports as it goes — the heap and the heaviest files of every few hundred —
 * so a run that dies of memory half way has still named what it got through.
 */
import { writeFileSync } from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"
import ts from "typescript"

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const project = option("--project", "tsconfig.json")
const top = Number(option("--top", "60"))
const outPath = option("--out", "")
const sampleEvery = Number(option("--sample-every", "300"))

const cwd = process.cwd()
const mib = (bytes) => Math.round(bytes / 1048576)
const heapNow = () => {
  if (global.gc) global.gc()
  return process.memoryUsage().heapUsed
}

const configPath = path.resolve(cwd, project)
const parsed = ts.getParsedCommandLineOfConfigFile(
  configPath,
  // A cold CI checkout has no build info to reuse, and writing one is not what
  // is being measured.
  { incremental: false, noEmit: true },
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
    },
  },
)
if (!parsed) throw new Error(`cannot read ${configPath}`)

const phases = []
const phase = (name, since) => {
  const heap = heapNow()
  phases.push({ name, seconds: Math.round((performance.now() - since) / 100) / 10, heapMiB: mib(heap) })
  console.log(`${name}: heap ${mib(heap)} MiB`)
  return performance.now()
}

let clock = performance.now()
const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
  projectReferences: parsed.projectReferences,
})
clock = phase("parse (createProgram)", clock)

// Creating the checker binds every file, declaration files included.
program.getTypeChecker()
program.getGlobalDiagnostics()
clock = phase("bind + checker start", clock)

const relative = (fileName) => path.relative(cwd, fileName).split(path.sep).join("/")

// Directory a file is billed to. Tests live in one flat directory, so they are
// grouped by the leading words of the file name instead.
const bucketOf = (file) => {
  if (file.startsWith("node_modules/")) {
    const parts = file.split("/")
    return parts[1].startsWith("@") || parts[1].startsWith(".") ? parts.slice(0, 3).join("/") : parts.slice(0, 2).join("/")
  }
  if (file.startsWith("src/__tests__/")) {
    const name = file.slice("src/__tests__/".length)
    if (name.includes("/")) return `src/__tests__/${name.split("/")[0]}/`
    return `src/__tests__/${name.split("-").slice(0, 2).join("-").replace(/\.test\.tsx?$/u, "")}*`
  }
  const parts = file.split("/")
  if (parts[0] === "src" && (parts[1] === "app" || parts[1] === "lib" || parts[1] === "components")) {
    return parts.slice(0, Math.min(parts.length - 1, parts[2] === "api" ? 5 : 3)).join("/")
  }
  return parts.slice(0, Math.min(parts.length - 1, 2)).join("/") || file
}

const share = (part, whole) => `${((part / Math.max(whole, 1)) * 100).toFixed(1)}%`
const table = (title, rows, columns) => {
  console.log(`\n${title}`)
  console.log(columns.map((column) => column.name.padStart(column.width)).join(" "))
  for (const row of rows) {
    console.log(columns.map((column) => String(column.value(row)).padStart(column.width)).join(" "))
  }
}

const sourceFiles = program.getSourceFiles()
const declarationBytes = new Map()
for (const sourceFile of sourceFiles) {
  if (!sourceFile.isDeclarationFile) continue
  const bucket = bucketOf(relative(sourceFile.fileName))
  declarationBytes.set(bucket, (declarationBytes.get(bucket) ?? 0) + sourceFile.text.length)
}
// Printed before the check starts: if the compiler runs out of memory half
// way, everything above this line has still been said.
table(
  "Declaration files by size (parsed and bound whether or not anything uses them)",
  [...declarationBytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
  [
    { name: "MiB", width: 8, value: (row) => (row[1] / 1048576).toFixed(1) },
    { name: "  package", width: 9, value: (row) => `  ${row[0]}` },
  ],
)

const counters = () => ({
  types: program.getTypeCount(),
  instantiations: program.getInstantiationCount(),
  symbols: program.getSymbolCount(),
})

const files = []
const samples = []
const errorCodes = new Map()
let checked = 0
let errors = 0
const startedChecking = performance.now()
for (const sourceFile of sourceFiles) {
  if (sourceFile.isDeclarationFile && parsed.options.skipLibCheck) continue
  const before = counters()
  const started = performance.now()
  const diagnostics = program.getSemanticDiagnostics(sourceFile)
  const ms = performance.now() - started
  const after = counters()
  for (const diagnostic of diagnostics) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue
    errors++
    errorCodes.set(diagnostic.code, (errorCodes.get(diagnostic.code) ?? 0) + 1)
  }
  files.push({
    file: relative(sourceFile.fileName),
    ms: Math.round(ms),
    types: after.types - before.types,
    instantiations: after.instantiations - before.instantiations,
    symbols: after.symbols - before.symbols,
  })
  checked++
  if (checked % sampleEvery === 0) {
    const heap = heapNow()
    samples.push({ checked, file: relative(sourceFile.fileName), heapMiB: mib(heap), types: after.types })
    console.log(`checked ${checked} file(s): heap ${mib(heap)} MiB, ${after.types} types`)
    for (const entry of files.slice(-sampleEvery).sort((a, b) => b.types - a.types).slice(0, 3)) {
      if (entry.types >= 20000) console.log(`    ${String(entry.types).padStart(9)} types  ${entry.file}`)
    }
  }
}
phase(`check (${checked} files)`, startedChecking)

const totals = counters()
const buckets = new Map()
for (const entry of files) {
  const key = bucketOf(entry.file)
  const bucket = buckets.get(key) ?? { bucket: key, files: 0, ms: 0, types: 0, instantiations: 0, symbols: 0 }
  bucket.files++
  bucket.ms += entry.ms
  bucket.types += entry.types
  bucket.instantiations += entry.instantiations
  bucket.symbols += entry.symbols
  buckets.set(key, bucket)
}

const fileColumns = [
  { name: "types", width: 10, value: (row) => row.types },
  { name: "share", width: 7, value: (row) => share(row.types, totals.types) },
  { name: "instantiations", width: 15, value: (row) => row.instantiations },
  { name: "symbols", width: 10, value: (row) => row.symbols },
  { name: "ms", width: 8, value: (row) => row.ms },
  { name: "  file", width: 6, value: (row) => `  ${row.file}` },
]

console.log(`\nTotals: ${totals.types} types, ${totals.instantiations} instantiations, ${totals.symbols} symbols, ${errors} errors`)
table("Phases", phases, [
  { name: "heap MiB", width: 10, value: (row) => row.heapMiB },
  { name: "seconds", width: 9, value: (row) => row.seconds },
  { name: "  phase", width: 7, value: (row) => `  ${row.name}` },
])
table(
  "Directories by types created",
  [...buckets.values()].sort((a, b) => b.types - a.types).slice(0, top),
  [
    { name: "types", width: 10, value: (row) => row.types },
    { name: "share", width: 7, value: (row) => share(row.types, totals.types) },
    { name: "instantiations", width: 15, value: (row) => row.instantiations },
    { name: "files", width: 6, value: (row) => row.files },
    { name: "ms", width: 8, value: (row) => row.ms },
    { name: "  directory", width: 11, value: (row) => `  ${row.bucket}` },
  ],
)
table(`Files by types created (top ${top})`, [...files].sort((a, b) => b.types - a.types).slice(0, top), fileColumns)
table("Files by check time (top 30)", [...files].sort((a, b) => b.ms - a.ms).slice(0, 30), fileColumns)
table(
  "Errors by code",
  [...errorCodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
  [
    { name: "count", width: 7, value: (row) => row[1] },
    { name: "  code", width: 6, value: (row) => `  TS${row[0]}` },
  ],
)

if (outPath) {
  writeFileSync(
    outPath,
    `${JSON.stringify({ totals, errors, phases, samples, buckets: [...buckets.values()], files }, null, 1)}\n`,
  )
  console.log(`\nFull per-file table written to ${outPath}`)
}
