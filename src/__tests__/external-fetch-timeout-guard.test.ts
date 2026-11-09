/**
 * Every call the server makes to another service has a time limit
 * (owner, 2026-11-09: «Да, тайм-ауты»).
 *
 * Node's fetch waits up to five minutes for a reply's headers and as long
 * again between chunks of its body. A provider that accepts the connection
 * and then says nothing — Meta, Telegram, an SMS gateway, 1C — holds the
 * person's request (a «Send» that spins), the cron job's lease and a slot of
 * the single web process for all that time. So a server-side `fetch` to
 * anything but this app's own routes passes `signal` — usually
 * `AbortSignal.timeout(…)` — and this guard reads the code with the
 * TypeScript compiler to find any that does not.
 *
 * A call whose options are built elsewhere (`fetch(url, init)`) is accepted
 * only if `init` is written right there with `signal`, or spreads another
 * object and adds `signal`. The list below names the files whose calls the
 * guard cannot judge, each with the reason; it may only shrink.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const SCOPES = ["src/lib", "src/app/api"]

/** file → why its fetch without `signal` is not a server call without a limit. Only shrinks. */
const WITHOUT_LIMIT: Record<string, string> = {
  "src/lib/mtm/geocode.ts": "passes its caller's options through; the one caller sets signal: deps.timeout(TIMEOUT_MS[service])",
  "src/lib/demo-center/form-challenge-client.ts": "browser code of the demo form (no \"use client\": imported by a client page)",
  "src/lib/mtm/basemap-provider-store.ts": "browser code: asks this app's /api/v1/public/basemap-provider",
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Runs in the browser: its fetches go to this app and are not the server's. */
const isBrowserModule = (text: string) => /^\s*(["'])use client\1/m.test(text.slice(0, 300))

/** `fetch("/api/…")` — this app's own route, from the browser. */
function isOwnRoute(arg: ts.Expression | undefined) {
  if (!arg) return false
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text.startsWith("/")
  if (ts.isTemplateExpression(arg)) return arg.head.text.startsWith("/")
  return false
}

function hasSignal(init: ts.Expression | undefined) {
  if (!init || !ts.isObjectLiteralExpression(init)) return false
  return init.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === "signal")
}

export function fetchesWithoutLimit(): string[] {
  const found: string[] = []
  for (const scope of SCOPES) {
    for (const path of sourceFiles(join(ROOT, scope))) {
      const text = readFileSync(path, "utf8")
      if (isBrowserModule(text)) continue
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
          const [url, init] = node.arguments
          if (!isOwnRoute(url) && !hasSignal(init)) {
            const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1
            found.push(`${relative(ROOT, path)}:${line}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
  }
  return found.sort()
}

describe("server calls to other services have a time limit", () => {
  it("every server-side fetch to another service passes a signal", () => {
    const missing = fetchesWithoutLimit().filter((at) => !(at.split(":")[0] in WITHOUT_LIMIT))
    expect(missing).toEqual([])
  })

  it("lists no exception that has since got a limit or moved", () => {
    const now = new Set(fetchesWithoutLimit().map((at) => at.split(":")[0]))
    expect(Object.keys(WITHOUT_LIMIT).filter((file) => !now.has(file))).toEqual([])
  })
})
