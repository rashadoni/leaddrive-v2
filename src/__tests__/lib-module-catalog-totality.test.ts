import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { navItems } from "@/lib/nav-items"
import { MODULE_REGISTRY, GROUP_MODULE_IDS, ADDON_FLAG_IDS, LEGACY_MODULE_MAP, INTENTIONALLY_UNGATED } from "@/lib/modules"
import { CAPABILITY_GATED_PERMISSION_SCOPES, PERMISSION_MODULE_TO_MODULE_ID, ROUTE_MODULE_MAP } from "@/lib/permissions"

const GROUPS = new Set<string>(GROUP_MODULE_IDS)
const FLAGS = new Set<string>([...ADDON_FLAG_IDS, "sms-otp"])

/** A scope counts as classified iff: translates (pre-membership!) to a group/flag,
 *  is itself a group/flag (identity), or is intentionally ungated. */
// NOTE: relies on PERMISSION_MODULE_TO_MODULE_ID === spread of LEGACY_MODULE_MAP (permissions.ts) — if an alias is ever added to one map only, this invariant silently weakens.
function classified(scope: string): boolean {
  const translated = (PERMISSION_MODULE_TO_MODULE_ID as Record<string, string>)[scope] ?? scope
  if (GROUPS.has(translated) || FLAGS.has(translated)) return true
  if (INTENTIONALLY_UNGATED.has(scope)) return true
  if (CAPABILITY_GATED_PERMISSION_SCOPES.has(scope as never)) return true
  return false
}

function explicitRequireAuthScopes(): Set<string> {
  const root = path.resolve(__dirname, "../app/api")
  const out = new Set<string>()
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".ts")) {
        const src = fs.readFileSync(p, "utf8")
        for (const m of src.matchAll(/requireAuth\(\s*[\w.]+\s*,\s*"([a-z0-9-]+)"/g)) out.add(m[1])
      }
    }
  }
  walk(root)
  return out
}

describe("module-catalog totality (blocking invariant)", () => {
  it("every scope in the full gate universe is classified", () => {
    const universe = new Set<string>([
      ...Object.keys(MODULE_REGISTRY),
      ...Object.values(ROUTE_MODULE_MAP as Record<string, string>),
      ...explicitRequireAuthScopes(),
      ...navItems.flatMap((i) => i.module ? [i.module] : []),
    ])
    const unclassified = [...universe].filter((s) => !classified(s)).sort()
    expect(unclassified, `Unclassified scopes: ${unclassified.join(", ")} — map them in LEGACY_MODULE_MAP or add to INTENTIONALLY_UNGATED`).toEqual([])
  })
  it("alias translation happens BEFORE membership (one case per alias)", () => {
    for (const [alias, target] of [["kb", "support"], ["inbox", "omnichannel"], ["energy-utilities", "energy"], ["offers", "sales"]] as const) {
      expect((PERMISSION_MODULE_TO_MODULE_ID as Record<string, string>)[alias]).toBe(target)
    }
  })
})
