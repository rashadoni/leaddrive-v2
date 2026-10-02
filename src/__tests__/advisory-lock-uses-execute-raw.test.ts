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
 * query. The line had been copied into thirty-odd statements that had never
 * run against a real database. So the guard is static and discovery-based — it
 * parses the source, and a new call site is covered the moment it is written.
 *
 * What it accepts under `$queryRaw` is only what it can prove returns a real
 * column: `pg_try_advisory_xact_lock` (boolean) and a lock cast at the call
 * (`pg_advisory_xact_lock(...)::text`, `CAST(pg_advisory_xact_lock(...) AS text)`).
 * A lock buried in a subquery or a FROM clause may or may not surface as a void
 * column (`SELECT * FROM (SELECT pg_advisory_xact_lock(1)) l` does), and
 * telling the two apart needs a SQL parser, so those are rejected as well —
 * write them with a cast.
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const SCANNED_DIRS = ["src", "scripts", ".github/scripts", "prisma"]
const SCANNED_FILE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/
// Tests quote the broken statement on purpose (this file does) and never run
// on prod.
const SKIPPED_DIR = /(?:^|\/)(?:__tests__|node_modules|\.next|generated)(?:\/|$)/
// Workflows and shell scripts carry inline Node that talks to prod through
// Prisma. They cannot be parsed as TypeScript, so they get a textual check.
const EMBEDDED_SCRIPT_DIRS = [".github/workflows", "ops", "scripts"]
const EMBEDDED_SCRIPT_FILE = /\.(?:ya?ml|sh)$/

/** Functions that return PostgreSQL `void` and exist only for their effect. */
const LOCK_NAME = /\b(?:pg_advisory(?:_xact)?_lock(?:_shared)?|pg_advisory_unlock_all)\b/
const LOCK_CALL = new RegExp(`${LOCK_NAME.source}\\s*\\(`, "g")
const RAW_METHOD = /^\$(queryRaw|executeRaw)(?:Unsafe)?$/
const EMBEDDED_QUERY_RAW_LOCK = new RegExp(
  `\\$queryRaw(?:Unsafe)?\\b(?:(?!\\$(?:queryRaw|executeRaw))[\\s\\S]){0,600}?${LOCK_NAME.source}\\s*\\(`,
  "g",
)

type RawCall = {
  method: "queryRaw" | "executeRaw"
  node: ts.Node
  /**
   * Each statement written inline in the call: its SQL with `${…}` replaced by
   * a bind marker, and the literal pieces it is made of.
   */
  inline: Array<{ sql: string; parts: ts.Node[] }>
}
type Finding = { file: string; line: number; statement: string }

function rawMethod(callee: ts.Expression): RawCall["method"] | null {
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
        ? callee.argumentExpression.text
        : ""
  return (RAW_METHOD.exec(name)?.[1] as RawCall["method"] | undefined) ?? null
}

function inlineSql(node: ts.Node): RawCall["inline"] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [{ sql: node.text, parts: [node] }]
  }
  if (ts.isTemplateExpression(node)) {
    return [{
      sql: node.head.text + node.templateSpans.map((span) => `$0${span.literal.text}`).join(""),
      parts: [node.head, ...node.templateSpans.map((span) => span.literal)],
    }]
  }
  // `$queryRaw(Prisma.sql\`…\`)`
  if (ts.isTaggedTemplateExpression(node)) return inlineSql(node.template)
  if (ts.isConditionalExpression(node)) return [...inlineSql(node.whenTrue), ...inlineSql(node.whenFalse)]
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return inlineSql(node.expression)
  }
  // A variable, a function call, a concatenation: not readable from here.
  return []
}

function isLiteralPiece(node: ts.Node): node is ts.LiteralLikeNode {
  return ts.isStringLiteral(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isTemplateHead(node)
    || ts.isTemplateMiddle(node)
    || ts.isTemplateTail(node)
}

function endOfSqlParentheses(sql: string, open: number): number {
  let depth = 0
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "'") {
      const close = sql.indexOf("'", i + 1)
      if (close < 0) return sql.length
      i = close
    } else if (sql[i] === "(") depth++
    else if (sql[i] === ")" && --depth === 0) return i + 1
  }
  return sql.length
}

/**
 * True unless every void lock in the statement is cast to a real type right at
 * the call — the only shape that provably does not hand Prisma a void column.
 */
export function selectsVoidLockColumn(statement: string): boolean {
  const sql = statement.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  for (const match of sql.matchAll(LOCK_CALL)) {
    const before = sql.slice(0, match.index).trimEnd()
    const after = sql.slice(endOfSqlParentheses(sql, match.index + match[0].length - 1)).trimStart()
    const cast = /^::\s*"?(?!void\b)[a-z_]/i.test(after)
      || (/\bcast\s*\($/i.test(before) && /^as\s+"?(?!void\b)[a-z_]/i.test(after))
    if (!cast) return true
  }
  return false
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  return /\.[mc]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat
}

/**
 * `viaQueryRaw`: void locks selected through `$queryRaw`.
 * `unattributed`: a lock named in a string the guard cannot tie to a call it
 * can judge — SQL kept in a constant, a fragment nested inside a `$queryRaw`
 * template, a function name passed as a value.
 * `executeRawLocks`: what the code base is supposed to look like.
 */
export function inspect(file: string, source: string) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file))
  const calls: RawCall[] = []
  const literals: ts.LiteralLikeNode[] = []
  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      const method = rawMethod(node.tag)
      if (method) calls.push({ method, node, inline: inlineSql(node.template) })
    } else if (ts.isCallExpression(node)) {
      const method = rawMethod(node.expression)
      if (method) calls.push({ method, node, inline: node.arguments[0] ? inlineSql(node.arguments[0]) : [] })
    }
    if (isLiteralPiece(node)) literals.push(node)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  const finding = (node: ts.Node): Finding => ({
    file,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    statement: oneLine(node.getText(sourceFile)),
  })
  const enclosingCall = (node: ts.Node): RawCall | undefined => {
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
      const call = calls.find((candidate) => candidate.node === current)
      if (call) return call
    }
    return undefined
  }
  const takesLock = (call: RawCall) => call.inline.some((statement) => selectsVoidLockColumn(statement.sql))

  const unattributed: Finding[] = []
  for (const literal of literals) {
    if (!LOCK_NAME.test(literal.text)) continue
    const call = enclosingCall(literal)
    // Under `$executeRaw` nothing reads the row, however the SQL is assembled.
    if (call?.method === "executeRaw") continue
    // A piece of the statement itself: judged by `takesLock` above.
    if (call?.inline.some((statement) => statement.parts.includes(literal))) continue
    unattributed.push(finding(literal))
  }
  return {
    viaQueryRaw: calls.filter((call) => call.method === "queryRaw" && takesLock(call)).map((call) => finding(call.node)),
    unattributed,
    executeRawLocks: calls.filter((call) => call.method === "executeRaw" && takesLock(call)).length,
  }
}

/** The textual check for inline scripts in workflows and shell files. */
export function inspectEmbedded(file: string, source: string): Finding[] {
  // Blank comment lines, keeping line numbers.
  const code = source.replace(/^[ \t]*#.*$/gm, "")
  return [...code.matchAll(EMBEDDED_QUERY_RAW_LOCK)].map((match) => ({
    file,
    line: code.slice(0, match.index).split("\n").length,
    statement: oneLine(match[0]),
  }))
}

function filesUnder(dirs: string[], wanted: RegExp): string[] {
  return dirs.flatMap((dir) =>
    readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .map((entry) => path.posix.join(dir, entry.split(path.sep).join("/")))
      .filter((file) => wanted.test(file) && !SKIPPED_DIR.test(file)),
  )
}

function report(findings: Finding[]): string[] {
  return findings.map((f) => `${f.file}:${f.line}  ${f.statement}`)
}

describe("advisory locks go through $executeRaw", () => {
  const inspected = filesUnder(SCANNED_DIRS, SCANNED_FILE)
    .map((file) => ({ file, source: readFileSync(path.join(ROOT, file), "utf8") }))
    // Parsing is the slow part; a file that never names a lock has nothing to say.
    .filter(({ source }) => LOCK_NAME.test(source))
    .map(({ file, source }) => inspect(file, source))

  it("sees the lock statements it is meant to guard", () => {
    // If the walk or the parser silently stopped seeing the code base, the
    // empty offender lists below would mean nothing.
    expect(inspected.reduce((total, result) => total + result.executeRawLocks, 0)).toBeGreaterThan(0)
  })

  it("no void-returning advisory lock is selected through $queryRaw", () => {
    // Fix: replace `$queryRaw` with `$executeRaw` (same SQL, same binds). On a
    // real Postgres the `$queryRaw` form fails with P2010 «Failed to
    // deserialize column of type 'void'» and the whole request with it.
    expect(report(inspected.flatMap((result) => result.viaQueryRaw))).toEqual([])
  })

  it("every advisory lock statement is written inline where the guard can read it", () => {
    // Each line below names a lock in a string that is neither under
    // `$executeRaw` nor the SQL of a `$queryRaw` call itself, so the guard
    // cannot tell which method ends up issuing it. Write the statement inline
    // in `$executeRaw`. (If it is not Prisma at all — node-postgres, a log
    // line — teach `inspect` that case rather than rewording the string.)
    expect(report(inspected.flatMap((result) => result.unattributed))).toEqual([])
  })

  it("no inline script in a workflow or shell file takes the lock through $queryRaw", () => {
    const findings = filesUnder(EMBEDDED_SCRIPT_DIRS, EMBEDDED_SCRIPT_FILE)
      .flatMap((file) => inspectEmbedded(file, readFileSync(path.join(ROOT, file), "utf8")))
    expect(report(findings)).toEqual([])
  })
})

describe("the guard itself", () => {
  const offenders = (source: string) => inspect("fixture.ts", source).viaQueryRaw.map((f) => f.line)
  const unattributed = (source: string) => inspect("fixture.ts", source).unattributed.map((f) => f.line)

  it("flags the statement that broke prod, in each shape it is written", () => {
    for (const broken of [
      "await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`k:${orgId}`}, 0))`",
      "await tx.$queryRaw`\n  SELECT pg_advisory_xact_lock(\n    hashtextextended(${`mtm-task-recurrence:${a}:${b}`}, 0)\n  )\n`",
      'await tx.$queryRawUnsafe(\n  "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",\n  key,\n)',
      "await tx.$queryRaw<Array<{ l: unknown }>>`SELECT pg_advisory_xact_lock(${a}, ${b}) AS l`",
      "await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${key})`)",
      "await prisma.$queryRaw`SELECT pg_advisory_lock(${key})`",
      "await tx.$queryRaw`select pg_advisory_xact_lock_shared(${key})`",
      "await tx.$queryRaw`SELECT ${orgId}::text AS org, pg_advisory_xact_lock(${key})`",
      'await tx.$queryRawUnsafe(shared ? "SELECT 1" : "SELECT pg_advisory_xact_lock($1)", key)',
      "await tx.$queryRaw`SELECT pg_catalog.pg_advisory_xact_lock(${key})`",
      "await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key})::void`",
      // Not comments, though a line-based reading would take them for one.
      "/* serialize */ await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key})`",
      "return withTx(`voip://${orgId}`, (tx) => tx.$queryRaw`SELECT pg_advisory_xact_lock(${key})`)",
      // A regex literal with a bracket must not derail the parse.
      'const id = raw.replace(/\\(/g, "")\nawait tx.$queryRaw`SELECT pg_advisory_xact_lock(${id})`',
      // The outer select list decides, and `*` hands the void column through.
      "await tx.$queryRaw`SELECT * FROM pg_advisory_xact_lock(${key})`",
      "await tx.$queryRaw`SELECT * FROM (SELECT pg_advisory_xact_lock(${key})) AS l`",
      "await tx.$queryRaw`SELECT (pg_advisory_xact_lock(${key}))`",
      "await tx.$queryRaw`\n  -- the key the activation route reads from\n  SELECT pg_advisory_xact_lock(${key})\n`",
    ]) {
      expect({ broken, flagged: offenders(broken).length }).toEqual({ broken, flagged: 1 })
    }
  })

  it("leaves $executeRaw and statements that return a real column alone", () => {
    for (const fine of [
      "await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`",
      'await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)',
      "await tx.$executeRaw`SELECT ${shared ? Prisma.sql`pg_advisory_xact_lock_shared(${key})` : Prisma.sql`pg_advisory_xact_lock(${key})`}`",
      "await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`",
      "await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`",
      "await tx.$queryRaw`SELECT CAST(pg_advisory_xact_lock(${key}) AS text) AS locked`",
      "await tx.$queryRaw`SELECT pg_advisory_unlock(${key}) AS released`",
      "await tx.$queryRaw`SELECT id FROM t -- caller holds pg_advisory_xact_lock(key)\n WHERE id = ${id}`",
      "// `$queryRaw` of pg_advisory_xact_lock(...) fails; see above\nawait tx.$executeRaw`SELECT pg_advisory_xact_lock(${key})`",
      "/**\n * tx.$queryRaw`SELECT pg_advisory_xact_lock(1)` is the broken form.\n */\nawait tx.$executeRaw`SELECT pg_advisory_xact_lock(${key})`",
    ]) {
      expect({ fine, offenders: offenders(fine), unattributed: unattributed(fine) })
        .toEqual({ fine, offenders: [], unattributed: [] })
    }
  })

  it("refuses a lock it cannot tie to the call that issues it", () => {
    for (const opaque of [
      'const LOCK = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"\nawait tx.$queryRawUnsafe(LOCK, key)',
      "const lock = Prisma.sql`SELECT pg_advisory_xact_lock(${key})`\nawait tx.$queryRaw(lock)",
      "await tx.$queryRaw`${Prisma.sql`SELECT pg_advisory_xact_lock(${key})`}`",
      "await tx.$queryRaw`SELECT ${shared ? Prisma.sql`pg_advisory_xact_lock_shared(${key})` : Prisma.sql`pg_advisory_xact_lock(${key})`}`",
      'await tx.$queryRaw`SELECT ${Prisma.raw("pg_advisory_xact_lock(42)")}`',
      'await tx.$queryRaw`SELECT ${Prisma.raw(shared ? "pg_advisory_xact_lock_shared" : "pg_advisory_xact_lock")}(${key})`',
      'const fn = shared ? "pg_advisory_xact_lock_shared" : "pg_advisory_xact_lock"\nawait tx.$queryRawUnsafe(`SELECT ${fn}(hashtextextended($1, 0))`, key)',
    ]) {
      const result = inspect("fixture.ts", opaque)
      expect({ opaque, caught: result.viaQueryRaw.length + result.unattributed.length > 0 }).toEqual({ opaque, caught: true })
    }
  })

  it("reads inline scripts in workflow and shell files", () => {
    const yaml = [
      "      run: |",
      "        node -e '",
      "          # tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(1)`) is the broken form",
      "          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, key)",
      "          const [config] = await tx.$queryRawUnsafe(`SELECT id FROM t`)",
      "        '",
    ]
    expect(inspectEmbedded("fixture.yml", yaml.join("\n"))).toEqual([])
    yaml[3] = "          await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, key)"
    expect(inspectEmbedded("fixture.yml", yaml.join("\n")).map((f) => f.line)).toEqual([4])
  })
})
