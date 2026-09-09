// Build gate for the deterministic RLS-context gap finder (scripts/rls/find-context-gaps.py).
// The pure-TS coverage gate (rls-route-context-coverage.test.ts) re-derives the ROUTE-LEVEL
// layer; this runs the finder's LIB-DELEGATION layers too (single-level + recursive call-graph),
// which caught the worst bugs (cost-model silent-fallback, logAudit, postWithClient) — so a
// future schema/route addition that reaches org-scoped prisma through a helper chain FAILS THE
// BUILD here, not at runtime. Skips gracefully where python3 is unavailable (the committed
// runtime [RLS-GUARD] + the TS coverage gate still apply).
import { describe, it, expect } from "vitest"
import { execFileSync } from "child_process"

function hasPython3(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

describe("RLS context-gap finder (route + lib-delegation, any depth)", () => {
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
    let out = ""
    let code = 0
    try {
      out = execFileSync("python3", ["scripts/rls/find-context-gaps.py"], { encoding: "utf8" })
    } catch (e: any) {
      out = `${e.stdout || ""}${e.stderr || ""}`
      code = e.status ?? 1
    }
    expect(code, `scripts/rls/find-context-gaps.py reported RLS-context gaps:\n${out}`).toBe(0)
  }, FINDER_TIMEOUT_MS)
})
