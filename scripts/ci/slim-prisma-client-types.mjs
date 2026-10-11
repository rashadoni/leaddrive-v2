#!/usr/bin/env node
/**
 * Rewrites the repeated nested-write input types of the generated Prisma
 * client as `Omit<…>` of the type they repeat, before the type check reads it.
 *
 * For every relation, Prisma writes out a full copy of the owning model's
 * create and update inputs with that one relation left out:
 * `OrganizationCreateWithoutUsersInput` is `OrganizationCreateInput` minus
 * `users`, spelled property by property. `Organization` has a relation to
 * nearly every tenant table, so each copy is ~500 lines and there are four per
 * relation: the family grows with the SQUARE of the number of tenant models and
 * was two thirds of the 138 MiB declaration file when this was written. The
 * compiler parses and binds all of it before it checks a single line of ours.
 *
 * The rewrite is exact, not approximate. A type is replaced only when its body
 * is, line for line, the body of its base type with whole properties removed;
 * the replacement names exactly those properties. Anything that does not match
 * is left as the generator wrote it, and so is the whole file if it has changed
 * shape — this is an economy for the type check, never a condition of it.
 *
 *   node scripts/ci/slim-prisma-client-types.mjs [index.d.ts] [--proof <dir>]
 *
 * `--proof <dir>` also writes a small project in which the compiler itself
 * compares every rewritten type with the body it replaced:
 * `tsc -p <dir>` passes only if none differs.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const MARKER = "// nested-write inputs rewritten by scripts/ci/slim-prisma-client-types.mjs"

const args = process.argv.slice(2)
const proofAt = args.indexOf("--proof")
const proofDir = proofAt >= 0 ? args[proofAt + 1] : null
if (proofAt >= 0 && !proofDir) {
  console.error("usage: slim-prisma-client-types.mjs [index.d.ts] [--proof <dir>]")
  process.exit(1)
}
const file =
  args.find((arg, index) => !arg.startsWith("--") && (proofAt < 0 || index !== proofAt + 1))
  ?? "node_modules/.prisma/client/index.d.ts"

/** Nothing was rewritten; the type check goes on with the file as generated. */
const leaveAsGenerated = (why) => {
  console.log(`::warning::slim-prisma-client-types: ${file} left as generated — ${why}`)
  process.exit(0)
}

const original = readFileSync(file, "utf8")
if (original.startsWith(MARKER)) {
  console.log(`slim-prisma-client-types: ${file} is already rewritten.`)
  process.exit(0)
}
// `Omit` below must be the standard one. A generator that started declaring its
// own in this file would silently change what every rewritten type means.
if (/^\s*(?:export\s+)?(?:declare\s+)?type\s+(?:Omit|Pick|Exclude)\s*</mu.test(original)) {
  leaveAsGenerated("it declares its own Omit, Pick or Exclude, so a rewrite would no longer be exact.")
}

const lines = original.split("\n")
const propertyName = (line) => /^    ([A-Za-z_$][A-Za-z0-9_$]*)\??: \S/u.exec(line)?.[1] ?? null

// Every `  export type Name = {` … `  }` whose body is nothing but one-line
// properties. An index signature, a method or a member spread over several
// lines disqualifies the block: `Omit` is only the same thing for plain ones.
const blocks = new Map()
for (let index = 0; index < lines.length; index++) {
  const match = /^  export type ([A-Za-z0-9_$]+) = \{$/u.exec(lines[index])
  if (!match) continue
  let end = index + 1
  while (end < lines.length && propertyName(lines[end])) end++
  if (lines[end] === "  }" && end > index + 1) blocks.set(match[1], { start: index, end })
}

const edits = []
let candidates = 0
for (const [name, block] of blocks) {
  const match = /^(.+?)Without[A-Za-z0-9_]+Input$/u.exec(name)
  if (!match) continue
  const baseName = `${match[1]}Input`
  const base = blocks.get(baseName)
  if (!base) continue
  candidates++
  // Walk the base body; every line must either be the next line of this type
  // or a property this type leaves out. Nothing may be reordered or reworded.
  const omitted = []
  let cursor = block.start + 1
  for (let baseLine = base.start + 1; baseLine < base.end; baseLine++) {
    if (cursor < block.end && lines[cursor] === lines[baseLine]) cursor++
    else omitted.push(propertyName(lines[baseLine]))
  }
  if (cursor !== block.end || omitted.length === 0) continue
  edits.push({
    name,
    baseName,
    start: block.start,
    end: block.end,
    text: `  export type ${name} = Omit<${baseName}, ${omitted.map((property) => JSON.stringify(property)).join(" | ")}>`,
  })
}

if (edits.length === 0) {
  leaveAsGenerated(
    `nothing matched (${blocks.size} plain object types, ${candidates} candidates). `
      + "The generator's output has changed shape; re-read this script against it.",
  )
}

// Assembled front to back: splicing ten thousand ranges out of a two-million
// line array in place would be quadratic.
edits.sort((a, b) => a.start - b.start)
const assemble = (afterEdit) => {
  const output = [MARKER]
  let from = 0
  for (const edit of edits) {
    for (let index = from; index < edit.start; index++) output.push(lines[index])
    output.push(edit.text)
    afterEdit(edit, output)
    from = edit.end + 1
  }
  for (let index = from; index < lines.length; index++) output.push(lines[index])
  return output.join("\n")
}

const rewritten = assemble(() => {})
writeFileSync(file, rewritten)

if (proofDir) {
  // The same file with, next to every rewritten type, a comparison between it
  // and the body it replaced. The comparison is type identity, not mutual
  // assignability: an optional property that became required would be caught.
  const last = edits[edits.length - 1]
  const control = edits[0]
  const proof = assemble((edit, output) => {
    output.push(`  type __Rewrite_${edit.name} = __RewriteSame<${edit.name}, {`)
    for (let index = edit.start + 1; index < edit.end; index++) output.push(lines[index])
    output.push("  }>")
    if (edit !== last) return
    output.push("  type __RewriteSame<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false")
    output.push("  /** Names of the rewritten types that differ from what the generator wrote. */")
    output.push("  export type __RewriteDiffers =")
    for (const each of edits) output.push(`    | (__Rewrite_${each.name} extends true ? never : ${JSON.stringify(each.name)})`)
    output.push("  /** A rewrite that is wrong on purpose: the base type against itself with nothing left out. */")
    output.push(`  export type __RewriteControl = __RewriteSame<${control.name}, ${control.baseName}>`)
  })
  mkdirSync(proofDir, { recursive: true })
  writeFileSync(path.join(proofDir, "client.d.ts"), proof)
  writeFileSync(
    path.join(proofDir, "check.ts"),
    [
      'import type { Prisma } from "./client"',
      "",
      "// The keys of this record are the names of the rewritten types that differ",
      "// from what the generator wrote, so `{}` fits only when there are none.",
      "export const differing: Record<Prisma.__RewriteDiffers, never> = {}",
      "// A rewrite that is wrong on purpose. If the comparison stops calling it",
      "// different, it would call anything the same, and the line above proves nothing.",
      "export const control: Prisma.__RewriteControl = false",
      "",
    ].join("\n"),
  )
  writeFileSync(
    path.join(proofDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["esnext"],
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        files: ["check.ts"],
      },
      null,
      2,
    )}\n`,
  )
}

const mib = (text) => (Buffer.byteLength(text) / 1048576).toFixed(1)
console.log(
  `slim-prisma-client-types: ${edits.length} of ${candidates} nested-write input types rewritten as Omit<…>; `
    + `${file} ${mib(original)} MiB → ${mib(rewritten)} MiB.`
    + (proofDir ? ` Proof project written to ${proofDir}.` : ""),
)
