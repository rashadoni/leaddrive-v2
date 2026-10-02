/**
 * An advisory lock is taken with `$executeRaw`, never with `$queryRaw`.
 *
 * Why this exists: on 2026-10-02 saving MTM client categories failed on prod
 * every time with
 *
 *   P2010  Raw query failed. Message: `Failed to deserialize column of type 'void'`
 *
 * The transaction opened with `tx.$queryRaw\`SELECT pg_advisory_xact_lock(...)\``.
 * `pg_advisory_xact_lock` returns `void`; `$queryRaw` reads the result row and
 * Prisma (6.19) has no deserializer for a void column, so the request died
 * before touching a table. `$executeRaw` takes the same transaction-scoped lock
 * and returns a row count without reading the row.
 *
 * No unit test can see this: they mock Prisma, and a mock answers any raw
 * query. The line had been copied between some thirty routes that had never
 * run against a real database. So the guard is static and discovery-based — it
 * reads the source, and a new call site is covered the moment it is written.
 *
 * What is NOT a violation, and must stay expressible: a statement whose result
 * is a real column — `pg_try_advisory_xact_lock` (boolean), a cast
 * (`pg_advisory_xact_lock(...)::text`), or a lock taken in a FROM clause or a
 * subquery under a select list of its own.
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const SCANNED_DIRS = ["src", "scripts", ".github/scripts"]
const SCANNED_FILE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/
// Tests quote the broken statement on purpose (this file does) and never run
// on prod.
const SKIPPED_DIR = /(?:^|\/)(?:__tests__|node_modules|\.next|generated)(?:\/|$)/

/** Functions that return PostgreSQL `void` and exist only for their effect. */
const VOID_LOCK = /\bpg_advisory(?:_xact)?_lock(?:_shared)?\s*\(|\bpg_advisory_unlock_all\s*\(/g
const RAW_CALL = /\$(queryRaw|executeRaw)(?:Unsafe)?\b/g

type RawStatement = {
  method: "queryRaw" | "executeRaw"
  /** Offsets of the whole call in the file, tag or argument list included. */
  start: number
  end: number
  /** Every SQL literal written inline in the call; empty when it is passed by name. */
  sql: string[]
}

function endOfString(source: string, open: number): number {
  const quote = source[open]
  for (let i = open + 1; i < source.length; i++) {
    if (source[i] === "\\") i++
    else if (source[i] === quote) return i + 1
    else if (source[i] === "\n") return i
  }
  return source.length
}

function endOfTemplate(source: string, open: number): number {
  let i = open + 1
  while (i < source.length) {
    if (source[i] === "\\") i += 2
    else if (source[i] === "`") return i + 1
    else if (source[i] === "$" && source[i + 1] === "{") i = endOfBrackets(source, i + 1)
    else i++
  }
  return source.length
}

/** `open` points at `(`, `[` or `{`; returns the offset after its partner. */
function endOfBrackets(source: string, open: number): number {
  let depth = 0
  let i = open
  while (i < source.length) {
    const ch = source[i]
    if (ch === '"' || ch === "'") i = endOfString(source, i)
    else if (ch === "`") i = endOfTemplate(source, i)
    else if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i)
      i = newline < 0 ? source.length : newline
    } else if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2)
      i = close < 0 ? source.length : close + 2
    } else {
      if (ch === "(" || ch === "[" || ch === "{") depth++
      else if (ch === ")" || ch === "]" || ch === "}") {
        depth--
        if (depth === 0) return i + 1
      }
      i++
    }
  }
  return source.length
}

/** `$queryRaw<Array<{ id: string }>>` — skip the type argument. */
function endOfTypeArguments(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "=" && source[i + 1] === ">") i++
    else if (source[i] === "<") depth++
    else if (source[i] === ">" && --depth === 0) return i + 1
  }
  return source.length
}

function skipWhitespace(source: string, from: number): number {
  let i = from
  while (i < source.length && /\s/.test(source[i])) i++
  return i
}

function isInComment(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1
  const before = source.slice(lineStart, offset)
  return /^\s*(?:\/\/|\/\*|\*)/.test(before) || before.includes("//")
}

function rawStatements(source: string): RawStatement[] {
  const found: RawStatement[] = []
  for (const match of source.matchAll(RAW_CALL)) {
    if (isInComment(source, match.index)) continue
    let i = skipWhitespace(source, match.index + match[0].length)
    if (source[i] === "<") i = skipWhitespace(source, endOfTypeArguments(source, i))
    const method = match[1] as RawStatement["method"]
    if (source[i] === "`") {
      const end = endOfTemplate(source, i)
      found.push({ method, start: match.index, end, sql: [source.slice(i + 1, end - 1)] })
    } else if (source[i] === "(") {
      const end = endOfBrackets(source, i)
      // `$queryRawUnsafe("SELECT …", key)`, `$queryRaw(Prisma.sql\`SELECT …\`)`,
      // `$queryRawUnsafe(shared ? "…" : "…", key)`: the statement is one of the
      // literals among the arguments, so each of them is examined.
      const sql: string[] = []
      let j = i + 1
      while (j < end - 1) {
        const ch = source[j]
        const literalEnd = ch === '"' || ch === "'" ? endOfString(source, j) : ch === "`" ? endOfTemplate(source, j) : -1
        if (literalEnd < 0) j++
        else {
          sql.push(source.slice(j + 1, literalEnd - 1))
          j = literalEnd
        }
      }
      found.push({ method, start: match.index, end, sql })
    }
    // Anything else is a reference to the method, not a call.
  }
  return found
}

/** Replace `${…}` with a bind marker so JavaScript brackets do not count as SQL. */
function withoutInterpolations(sql: string): string {
  let out = ""
  let i = 0
  while (i < sql.length) {
    if (sql[i] === "$" && sql[i + 1] === "{") {
      out += "$0"
      i = endOfBrackets(sql, i + 1)
    } else out += sql[i++]
  }
  return out
}

/** The SQL with everything inside parentheses and string literals removed. */
function topLevelOnly(sql: string): string {
  let out = ""
  let depth = 0
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'") {
      i = endOfString(sql, i) - 1
      continue
    }
    if (ch === "(") depth++
    else if (ch === ")") depth = Math.max(0, depth - 1)
    else if (depth === 0) out += ch
  }
  return out
}

/**
 * True when the statement's own select list contains a bare void lock call —
 * the form Prisma cannot deserialize.
 */
export function selectsVoidLockColumn(statement: string): boolean {
  const sql = withoutInterpolations(statement)
  for (const match of sql.matchAll(VOID_LOCK)) {
    const before = sql.slice(0, match.index)
    // Inside parentheses: a subquery, a CAST(...), an argument of another
    // function. The outer statement decides the column type, not this call.
    const opened = (before.match(/\(/g) ?? []).length - (before.match(/\)/g) ?? []).length
    if (opened > 0) continue
    // After FROM: the lock is a row source or a predicate, not a column.
    if (/\bfrom\b/i.test(topLevelOnly(before))) continue
    const after = sql.slice(endOfBrackets(sql, match.index + match[0].length - 1)).trimStart()
    // `…::text`, `… IS NULL`: the column has a real type.
    if (after.startsWith("::") || /^is\b/i.test(after)) continue
    return true
  }
  return false
}

type Finding = { file: string; line: number; statement: string }

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat
}

/** Locks issued through `$queryRaw`, and locks the guard cannot attribute. */
export function inspect(file: string, source: string): { viaQueryRaw: Finding[]; unattributed: Finding[] } {
  const statements = rawStatements(source)
  const viaQueryRaw = statements
    .filter((s) => s.method === "queryRaw" && s.sql.some(selectsVoidLockColumn))
    .map((s) => ({ file, line: lineOf(source, s.start), statement: oneLine(source.slice(s.start, s.end)) }))

  const unattributed: Finding[] = []
  for (const match of source.matchAll(VOID_LOCK)) {
    if (isInComment(source, match.index)) continue
    if (statements.some((s) => match.index >= s.start && match.index < s.end)) continue
    const lineEnd = source.indexOf("\n", match.index)
    const lineStart = source.lastIndexOf("\n", match.index) + 1
    unattributed.push({
      file,
      line: lineOf(source, match.index),
      statement: oneLine(source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd)),
    })
  }
  return { viaQueryRaw, unattributed }
}

function scannedFiles(): string[] {
  return SCANNED_DIRS.flatMap((dir) =>
    readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .map((entry) => path.posix.join(dir, entry.split(path.sep).join("/")))
      .filter((file) => SCANNED_FILE.test(file) && !SKIPPED_DIR.test(file)),
  )
}

function report(findings: Finding[]): string[] {
  return findings.map((f) => `${f.file}:${f.line}  ${f.statement}`)
}

describe("advisory locks go through $executeRaw", () => {
  const inspected = scannedFiles().map((file) => inspect(file, readFileSync(path.join(ROOT, file), "utf8")))

  it("sees the lock statements it is meant to guard", () => {
    // If the walk or the parser silently stopped seeing the code base, the
    // empty offender lists below would mean nothing.
    const executeRawLocks = scannedFiles().flatMap((file) =>
      rawStatements(readFileSync(path.join(ROOT, file), "utf8")).filter(
        (s) => s.method === "executeRaw" && s.sql.some(selectsVoidLockColumn),
      ),
    )
    expect(executeRawLocks.length).toBeGreaterThan(0)
  })

  it("no void-returning advisory lock is selected through $queryRaw", () => {
    // Fix: replace `$queryRaw` with `$executeRaw` (same SQL, same binds). On a
    // real Postgres the `$queryRaw` form fails with P2010 «Failed to
    // deserialize column of type 'void'» and the whole request with it.
    expect(report(inspected.flatMap((r) => r.viaQueryRaw))).toEqual([])
  })

  it("every advisory lock statement is written inline in a raw call", () => {
    // A lock whose SQL lives in a constant or a `Prisma.sql` fragment reaches
    // Prisma through a call this guard cannot follow, so it could be handed to
    // `$queryRaw` unseen. Write the statement inline in `$executeRaw`.
    expect(report(inspected.flatMap((r) => r.unattributed))).toEqual([])
  })
})

describe("the guard itself", () => {
  const offenders = (source: string) => inspect("fixture.ts", source).viaQueryRaw.map((f) => f.line)

  it("flags the statement that broke prod, in each shape it is written", () => {
    expect(offenders("await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`k:${orgId}`}, 0))`")).toEqual([1])
    expect(
      offenders(
        [
          "await tx.$queryRaw`",
          "  SELECT pg_advisory_xact_lock(",
          "    hashtextextended(${`mtm-task-recurrence:${a}:${b}`}, 0)",
          "  )",
          "`",
        ].join("\n"),
      ),
    ).toEqual([1])
    expect(offenders('await tx.$queryRawUnsafe(\n  "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",\n  key,\n)')).toEqual([1])
    expect(offenders("await tx.$queryRaw<Array<{ l: unknown }>>`SELECT pg_advisory_xact_lock(${a}, ${b}) AS l`")).toEqual([1])
    expect(offenders("await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${key})`)")).toEqual([1])
    expect(offenders("await prisma.$queryRaw`SELECT pg_advisory_lock(${key})`")).toEqual([1])
    expect(offenders("await tx.$queryRaw`select pg_advisory_xact_lock_shared(${key})`")).toEqual([1])
    expect(offenders("await tx.$queryRaw`SELECT ${orgId}::text AS org, pg_advisory_xact_lock(${key})`")).toEqual([1])
    expect(offenders('await tx.$queryRawUnsafe(shared ? "SELECT 1" : "SELECT pg_advisory_xact_lock($1)", key)')).toEqual([1])
  })

  it("leaves $executeRaw and statements that return a real column alone", () => {
    for (const fine of [
      "await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`",
      'await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)',
      "await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`",
      "await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`",
      "await tx.$queryRaw`SELECT CAST(pg_advisory_xact_lock(${key}) AS text) AS locked`",
      "await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(${key})) AS l`",
      "await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${key})`",
      "await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}) IS NULL AS locked`",
      "await tx.$queryRaw`SELECT pg_advisory_unlock(${key}) AS released`",
      "// `$queryRaw` of pg_advisory_xact_lock(...) fails; see above\nawait tx.$executeRaw`SELECT pg_advisory_xact_lock(${key})`",
    ]) {
      expect({ fine, offenders: offenders(fine) }).toEqual({ fine, offenders: [] })
    }
  })

  it("reports a lock statement it cannot attribute to a call", () => {
    const { viaQueryRaw, unattributed } = inspect(
      "fixture.ts",
      'const LOCK = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"\nawait tx.$queryRawUnsafe(LOCK, key)',
    )
    expect(viaQueryRaw).toEqual([])
    expect(unattributed.map((f) => f.line)).toEqual([1])
  })
})
