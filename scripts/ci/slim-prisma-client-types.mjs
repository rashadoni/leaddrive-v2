#!/usr/bin/env node
/**
 * Rewrites the nested-write input types of the generated Prisma client as
 * `Omit<…>` of the type they repeat.
 *
 * For every relation, Prisma writes out a full copy of the owning model's
 * create and update inputs with that one relation left out:
 * `OrganizationCreateWithoutUsersInput` is `OrganizationCreateInput` minus
 * `users`, spelled property by property. `Organization` has a relation to
 * nearly every tenant table, so each of those copies is ~500 lines and there are
 * four per relation — the family grows with the SQUARE of the number of tenant
 * models and is about two thirds of the 145 MB declaration file. The compiler
 * parses and binds all of it before it checks a single line of ours.
 *
 * The rewrite is exact, not approximate. A type is replaced only when its body
 * is, line for line, the body of its base type with whole properties removed;
 * the replacement names exactly those properties. Anything that does not match
 * is left as Prisma wrote it.
 *
 *   node scripts/ci/slim-prisma-client-types.mjs [path/to/index.d.ts]
 */
import { readFileSync, writeFileSync } from "node:fs"

const MARKER = "// nested-write inputs rewritten by scripts/ci/slim-prisma-client-types.mjs"
const file = process.argv[2] ?? "node_modules/.prisma/client/index.d.ts"

const fail = (message) => {
  console.error(`slim-prisma-client-types: ${message}`)
  process.exit(1)
}

const original = readFileSync(file, "utf8")
if (original.startsWith(MARKER)) {
  console.log(`slim-prisma-client-types: ${file} is already rewritten.`)
  process.exit(0)
}
// `Omit` below must be the standard one. A generator that started declaring its
// own in this file would silently change what every rewritten type means.
if (/^\s*(?:export\s+)?(?:declare\s+)?type\s+(?:Omit|Pick|Exclude)\s*</mu.test(original)) {
  fail(`${file} declares its own Omit, Pick or Exclude; the rewrite would no longer be exact.`)
}

const lines = original.split("\n")

// Every `  export type Name = {` … `  }` block whose body is plain members.
const blocks = new Map()
for (let index = 0; index < lines.length; index++) {
  const match = /^  export type ([A-Za-z0-9_$]+) = \{$/u.exec(lines[index])
  if (!match) continue
  let end = index + 1
  while (end < lines.length && lines[end] !== "  }") {
    if (!lines[end].startsWith("    ")) {
      end = -1
      break
    }
    end++
  }
  if (end < 0 || end >= lines.length) continue
  blocks.set(match[1], { start: index, end })
  index = end
}

const propertyName = (line) => /^    ([A-Za-z_$][A-Za-z0-9_$]*)\??: /u.exec(line)?.[1] ?? null

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
  let exact = true
  for (let baseLine = base.start + 1; baseLine < base.end; baseLine++) {
    if (cursor < block.end && lines[cursor] === lines[baseLine]) {
      cursor++
      continue
    }
    const property = propertyName(lines[baseLine])
    if (!property) {
      exact = false
      break
    }
    omitted.push(property)
  }
  if (!exact || cursor !== block.end || omitted.length === 0) continue
  edits.push({
    start: block.start,
    end: block.end,
    text: `  export type ${name} = Omit<${baseName}, ${omitted.map((property) => JSON.stringify(property)).join(" | ")}>`,
  })
}

if (edits.length === 0) {
  fail(
    `nothing in ${file} matched (${blocks.size} object types, ${candidates} candidates). `
      + "The generator's output has changed shape; this script must be re-read against it.",
  )
}

// Build the output front to back; splicing 10,000 ranges out of a two-million
// line array in place would be quadratic.
edits.sort((a, b) => a.start - b.start)
const output = [MARKER]
let from = 0
for (const edit of edits) {
  for (let index = from; index < edit.start; index++) output.push(lines[index])
  output.push(edit.text)
  from = edit.end + 1
}
for (let index = from; index < lines.length; index++) output.push(lines[index])
const rewritten = output.join("\n")
writeFileSync(file, rewritten)

const mib = (text) => (Buffer.byteLength(text) / 1048576).toFixed(1)
console.log(
  `slim-prisma-client-types: ${edits.length} of ${candidates} nested-write input types rewritten as Omit<…>; `
    + `${file} ${mib(original)} MiB → ${mib(rewritten)} MiB.`,
)
