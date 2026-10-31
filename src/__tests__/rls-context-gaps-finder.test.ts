// Build gate for the deterministic RLS-context gap finder (scripts/rls/find-context-gaps.py).
// The pure-TS coverage gate (rls-route-context-coverage.test.ts) re-derives the ROUTE-LEVEL
// layer; this runs the finder's LIB-DELEGATION layers too (single-level + recursive call-graph),
// which caught the worst bugs (cost-model silent-fallback, logAudit, postWithClient) — so a
// future schema/route addition that reaches org-scoped prisma through a helper chain FAILS THE
// BUILD here, not at runtime. Skips gracefully where python3 is unavailable (the committed
// runtime [RLS-GUARD] + the TS coverage gate still apply).
import { describe, it, expect } from "vitest"
import { execFileSync } from "child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join, resolve } from "path"

const FINDER = resolve("scripts/rls/find-context-gaps.py")

function hasPython3(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function runFinder(cwd?: string): { out: string; code: number } {
  try {
    return { out: execFileSync("python3", [FINDER], { cwd, encoding: "utf8" }), code: 0 }
  } catch (error: unknown) {
    const failure = error as { stdout?: unknown; stderr?: unknown; status?: number }
    return { out: `${failure.stdout ?? ""}${failure.stderr ?? ""}`, code: failure.status ?? 1 }
  }
}

// A throwaway git repository: the finder reads only what git tracks.
function fixtureRepo(tracked: Record<string, string>, untracked: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "rls-gap-finder-"))
  const write = (files: Record<string, string>) => {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), body)
    }
  }
  write({
    "prisma/schema.prisma": "model Deal {\n  id String @id\n  organizationId String\n}\n",
    ...tracked,
  })
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" })
  git("init", "-q")
  git("add", "-A")
  write(untracked)
  return root
}

const gapLines = (out: string) => out.split("\n").filter((line) => line.includes(" :: ")).map((line) => line.trim())

describe("RLS context-gap finder (route + lib-delegation, any depth)", () => {
  it("recognizes the Workforce grant-management context wrapper", () => {
    const finder = readFileSync("scripts/rls/find-context-gaps.py", "utf8")
    expect(finder).toContain("r'|withWorkforceSessionGrantManagementAuth")
  })
  // Explicit timeout because the default 5s is not a budget this test can hold.
  // The body shells out to a whole-repo static analysis: it parses every source
  // file and walks the call graph to any depth. Measured on an 8-core dev box,
  // 2.8s warm and 5.4s cold — and CI is always cold, on a 2-core runner, over a
  // tree that only grows. A gate that starts flaking as the repo grows is worse
  // than a slow one, because THIS gate is the RLS one: a timeout here reads as
  // "org-scoped prisma access without a context wrapper" and the next person
  // triaging a red build writes it off as one of the known-red files.
  const FINDER_TIMEOUT_MS = 60_000
  it.skipIf(!hasPython3())("finds zero org-scoped prisma access without a context wrapper", () => {
    const { out, code } = runFinder()
    // Printed on green too, so the count can be compared between CI and the dev box.
    console.log(out)
    expect(code, `scripts/rls/find-context-gaps.py reported RLS-context gaps:\n${out}`).toBe(0)
  }, FINDER_TIMEOUT_MS)

  // Until 2026-10-31 helpers were keyed by bare name across src/ and the first
  // definition the filesystem returned won, and `map.get(…)` counted as a call
  // to any function named `get`. Deploy run 41211546756 failed on that and
  // passed on a rerun. These fixtures pin call resolution to imports.
  it.skipIf(!hasPython3())("resolves a call through the caller's imports, not by bare name", () => {
    const root = fixtureRepo({
      // Two helpers share a name; only one reaches org-scoped prisma.
      "src/lib/dirty.ts": "export async function record(id: string) { return prisma.deal.findMany({ where: { id } }) }\n",
      "src/lib/clean.ts": "export function record(id: string) { return { id } }\n",
      // A function named like a Map method must not be reached by `seen.get(…)`.
      "src/lib/store.ts": "export async function get(id: string) { return prisma.deal.findFirst({ where: { id } }) }\n",
      // Re-export chains: a named alias and a star re-export.
      "src/lib/barrel.ts": "export { record as recordDeal } from \"./dirty\"\nexport * from \"./deep\"\n",
      "src/lib/deep.ts": "export const loadDeals = async (orgId: string) => {\n  return prisma.deal.findMany({ where: { organizationId: orgId } })\n}\n",
      "src/lib/with-rls.ts": "export function withRlsAuth(handler: unknown) { return handler }\n",
      "src/app/api/clean/route.ts": [
        "import { record } from \"@/lib/clean\"",
        "export async function GET() {",
        "  const seen = new Map<string, string>()",
        "  seen.get(\"x\")",
        "  return Response.json(record(\"x\"))",
        "}",
        "",
      ].join("\n"),
      "src/app/api/dirty/route.ts": "import { record } from \"@/lib/dirty\"\nexport async function GET() { return Response.json(await record(\"x\")) }\n",
      "src/app/api/alias/route.ts": "import { recordDeal } from \"@/lib/barrel\"\nexport async function GET() { return Response.json(await recordDeal(\"x\")) }\n",
      "src/app/api/star/route.ts": "import { loadDeals } from \"../../../lib/barrel\"\nexport async function POST() { return Response.json(await loadDeals(\"o\")) }\n",
      "src/app/api/namespace/route.ts": "import * as deep from \"@/lib/deep\"\nexport async function GET() { return Response.json(await deep.loadDeals(\"o\")) }\n",
      "src/app/api/dynamic/route.ts": "export async function GET() {\n  const { loadDeals } = await import(\"@/lib/deep\")\n  return Response.json(await loadDeals(\"o\"))\n}\n",
      "src/app/api/wrapped/route.ts": "import { withRlsAuth } from \"@/lib/with-rls\"\nimport { loadDeals } from \"@/lib/deep\"\nexport const GET = withRlsAuth(async () => Response.json(await loadDeals(\"o\")))\n",
    }, {
      // Not tracked: a generated or stray file must not change the answer.
      "src/app/api/untracked/route.ts": "export async function GET() { return Response.json(await prisma.deal.findMany()) }\n",
    })
    try {
      const { out, code } = runFinder(root)
      expect(code, out).toBe(1)
      expect(gapLines(out).sort()).toEqual([
        "src/app/api/alias/route.ts :: GET  [delegates to: recordDeal]",
        "src/app/api/dirty/route.ts :: GET  [delegates to: record]",
        "src/app/api/dynamic/route.ts :: GET  [delegates to: loadDeals]",
        "src/app/api/namespace/route.ts :: GET  [delegates to: deep.loadDeals]",
        "src/app/api/star/route.ts :: POST  [delegates to: loadDeals]",
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, FINDER_TIMEOUT_MS)

  it.skipIf(!hasPython3())("refuses to report zero gaps when git lists nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "rls-gap-finder-empty-"))
    try {
      mkdirSync(join(root, "prisma"))
      writeFileSync(join(root, "prisma/schema.prisma"), "")
      const { code } = runFinder(root)
      expect(code).not.toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
