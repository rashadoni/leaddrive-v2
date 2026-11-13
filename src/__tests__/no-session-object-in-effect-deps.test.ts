import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"

/**
 * `useEffect(..., [session])` is a refetch on a timer nobody set.
 *
 * next-auth hands back a NEW session object on every read it performs: on
 * mount, on its poll, and on every `visibilitychange` — that is, every time the
 * user switches to another window and comes back. The object also carries the
 * JWT `iat`, which moves on each read because the token is re-signed, so even a
 * value comparison would see a change.
 *
 * Any effect keyed on it therefore re-runs at moments the user experiences as
 * "I did nothing". Where such an effect writes server data into state that also
 * backs an editable field, the user's typing is silently replaced. That is not
 * hypothetical: a seller on the lead page lost a call report they were typing
 * by alt-tabbing to look up a number (fixed alongside this test).
 *
 * Depend on a stable identity instead — `session?.user?.organizationId`,
 * `session?.user?.id`, or `status === "authenticated"` — all of which are
 * strings or booleans and do not change when the token rotates.
 *
 * The files below predate this guard. They are grandfathered so the guard
 * can exist at all; the list must only ever get shorter. A file that is not on
 * it fails this test, which is the whole point: the class stops spreading today
 * and is paid down file by file.
 */

const GRANDFATHERED = new Set([
  "src/app/(auth)/login/setup-2fa/page.tsx",
  "src/app/(auth)/login/verify-2fa/page.tsx",
  "src/components/ai/voice-console.tsx",
])

const SRC = join(process.cwd(), "src")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue
      out.push(...sourceFiles(full))
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full)
    }
  }
  return out
}

function filesDependingOnSessionObject(): string[] {
  const found: string[] = []
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8")
    const deps = source.matchAll(/\}, \[([^\]]*)\]\)/g)
    for (const m of deps) {
      if (m[1].split(",").map(d => d.trim()).includes("session")) {
        found.push(file.replace(process.cwd() + "/", ""))
        break
      }
    }
  }
  return found
}

describe("effects must not depend on the session object", () => {
  it("detects the pattern at all", () => {
    // Negative control: if the matcher stops matching, every assertion below
    // passes vacuously and the ratchet silently becomes decoration.
    expect(filesDependingOnSessionObject().length).toBeGreaterThan(0)
  })

  it("adds no new file to the list", () => {
    const offenders = filesDependingOnSessionObject().filter(f => !GRANDFATHERED.has(f))
    expect(offenders).toEqual([])
  })

  it("the list only shrinks", () => {
    // A file cleaned up must be removed from GRANDFATHERED in the same change,
    // otherwise the list stops describing reality and the ratchet slips.
    const current = new Set(filesDependingOnSessionObject())
    const stale = [...GRANDFATHERED].filter(f => !current.has(f))
    expect(stale, "these are fixed — delete them from GRANDFATHERED").toEqual([])
  })
})
