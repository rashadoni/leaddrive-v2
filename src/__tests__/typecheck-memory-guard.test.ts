/**
 * Two ordinary-looking lines that each cost the full-project type check
 * gigabytes, and no type error to show for it.
 *
 * Why this exists: the required `typecheck` job ran out of a 12 GiB heap on
 * 2026-10-03 and out of a 14 GiB heap on 2026-10-10, and a free runner has 16.
 * Measured on 2026-10-11 (workflow «Typecheck memory profile»), 6 of the
 * 14.3 GiB the compiler needed were not the application at all:
 *
 *   1. `new PrismaClient({ … })`. The constructor is generic in its options, so
 *      the compiler infers a client type specific to that one object literal.
 *      The moment it meets a `PrismaClient` — `let db: PrismaClient`, a function
 *      parameter, `clients.push(c)` — it has to prove the two clients
 *      compatible, model by model, method by method: about 150,000 new types,
 *      over 100 MB of heap and 10–30 seconds of checking per construction.
 *      There were 37, all in the real-PostgreSQL tests, and every new such
 *      test added more. Naming the options type —
 *      `new PrismaClient<Prisma.PrismaClientOptions>({ … })` — yields the
 *      ordinary client, and there is nothing left to compare.
 *
 *   2. `import { google } from "googleapis"`. The root entry declares every
 *      Google API there is: 165 MB of typings, more than the generated Prisma
 *      client, parsed and bound for the sake of two APIs. Each API has its own
 *      module with the same exports.
 *
 * Neither shows up in a diff as anything but normal code, and the type check
 * cannot be run outside CI, so nothing else would notice them coming back. The
 * guard parses the sources rather than grepping them: both lines are quoted in
 * comments and in other tests' assertions.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
// What tsconfig.json hands the compiler: every .ts/.tsx/.mts outside
// node_modules, dot-directories and the two excluded trees.
const SKIPPED_DIR = /(?:^|\/)(?:\.[^/]+|node_modules|graphify-out)(?:\/|$)|^video\/remotion-ai-actions(?:\/|$)/
const TYPESCRIPT_FILE = /\.(?:ts|tsx|mts)$/
/**
 * JavaScript modules that build a client for TypeScript callers. JavaScript has
 * no syntax for a type argument, so these declare the ordinary client as their
 * return type and keep the inferred one from being compared with it by casting
 * through `any`.
 */
const JAVASCRIPT_CLIENT_FACTORIES = ["scripts/_rls.mjs"]
const DEFAULT_OPTIONS_TYPE = "Prisma.PrismaClientOptions"

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8")

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!SKIPPED_DIR.test(relative)) walk(relative, found)
    } else if (TYPESCRIPT_FILE.test(entry.name)) {
      found.push(relative)
    }
  }
  return found
}

type Construction = {
  where: string
  hasOptions: boolean
  /** The written type argument list, or null when there is none. */
  typeArguments: string | null
  /** `/** @type {any} *\/ (new PrismaClient(…))` — the JavaScript form. */
  castToAny: boolean
}

function prismaClientConstructions(file: string, text: string): Construction[] {
  if (!/new\s+PrismaClient\b/u.test(text)) return []
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found: Construction[] = []
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "PrismaClient") {
      const parent = node.parent
      found.push({
        where: `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        hasOptions: (node.arguments?.length ?? 0) > 0,
        typeArguments: node.typeArguments ? node.typeArguments.map((argument) => argument.getText(source)).join(", ") : null,
        castToAny: ts.isParenthesizedExpression(parent) && ts.getJSDocType(parent)?.kind === ts.SyntaxKind.AnyKeyword,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** A TypeScript construction is cheap when its client type is the ordinary one. */
const isOrdinaryClient = (construction: Construction) =>
  construction.typeArguments === DEFAULT_OPTIONS_TYPE || (construction.typeArguments === null && !construction.hasOptions)

function importedModules(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const modules: string[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      modules.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return modules
}

const sources = walk("")

describe("typecheck memory guard", () => {
  it("sees the code base it is guarding", () => {
    // A walker that silently found nothing would pass every check below.
    expect(sources.length).toBeGreaterThan(5000)
    expect(sources).toContain("src/lib/google-calendar.ts")
    expect(sources).toContain("scripts/seed-mtm.ts")
    expect(sources.some((file) => file.startsWith("node_modules/") || file.startsWith(".claude/"))).toBe(false)
  })

  it("tells an inferred client from the ordinary one", () => {
    const of = (code: string, file = "sample.ts") => prismaClientConstructions(file, code).map(isOrdinaryClient)
    expect(of("const db = new PrismaClient({ datasourceUrl })")).toEqual([false])
    expect(of("db = new PrismaClient(\n  options,\n)")).toEqual([false])
    expect(of("const db = new PrismaClient<{ datasourceUrl: string }>({ datasourceUrl })")).toEqual([false])
    expect(of("const db = new PrismaClient<Prisma.PrismaClientOptions>({ datasourceUrl })")).toEqual([true])
    expect(of("const db = new PrismaClient()")).toEqual([true])
    // Quoted, not written: a comment and another test's assertion.
    expect(of('// new PrismaClient({ datasourceUrl })\nexpect(script).not.toContain("new PrismaClient(")')).toEqual([])
    const javascript = (code: string) => prismaClientConstructions("sample.mjs", code).map((construction) => construction.castToAny)
    expect(javascript("return /** @type {any} */ (new PrismaClient(options))")).toEqual([true])
    expect(javascript("return new PrismaClient(options)")).toEqual([false])
    expect(javascript("return /** @type {PrismaClient} */ (new PrismaClient(options))")).toEqual([false])
  })

  it("every PrismaClient built with options names the ordinary options type", () => {
    const constructions = sources.flatMap((file) => prismaClientConstructions(file, read(file)))
    // The real-PostgreSQL tests alone build more than thirty.
    expect(constructions.length).toBeGreaterThan(30)
    const offenders = constructions.filter((construction) => !isOrdinaryClient(construction)).map((construction) => construction.where)
    expect(
      offenders,
      "write `new PrismaClient<Prisma.PrismaClientOptions>({ … })` (and `import type { Prisma } from \"@prisma/client\"`): "
        + "without the type argument each of these costs the type check about 150,000 types — see the header of this file",
    ).toEqual([])
  })

  it("JavaScript client factories hand TypeScript the ordinary client", () => {
    for (const file of JAVASCRIPT_CLIENT_FACTORIES) {
      expect(existsSync(path.join(ROOT, file)), `${file} moved or deleted — update JAVASCRIPT_CLIENT_FACTORIES`).toBe(true)
      const constructions = prismaClientConstructions(file, read(file))
      expect(constructions.length, `${file} no longer builds a client — update JAVASCRIPT_CLIENT_FACTORIES`).toBeGreaterThan(0)
      const offenders = constructions.filter((construction) => construction.hasOptions && !construction.castToAny).map((construction) => construction.where)
      expect(
        offenders,
        "build the client through the module's `newPrismaClient`, whose declared return type is the ordinary PrismaClient",
      ).toEqual([])
    }
  })

  it("nothing imports the root of googleapis", () => {
    const perApi: string[] = []
    const offenders: string[] = []
    for (const file of sources) {
      const text = read(file)
      if (!text.includes("googleapis")) continue
      for (const module of importedModules(file, text)) {
        if (module === "googleapis") offenders.push(file)
        if (module.startsWith("googleapis/build/src/apis/")) perApi.push(file)
      }
    }
    // The guard is looking at the right thing only while somebody uses the library.
    expect(perApi.length, "no per-API googleapis import found — has the library been dropped? then drop this check").toBeGreaterThan(0)
    expect(
      offenders,
      'import the one API you need, e.g. `import * as google from "googleapis/build/src/apis/calendar"`: '
        + "the root entry brings 165 MB of typings into the type check",
    ).toEqual([])
  })
})
