import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, W-01 / task C1 and Definition of Done rule 7:
 * product copy never names a customer. Every tenant sees the same screens,
 * so a customer name in a translation, a help page or a UI component leaks
 * one client's identity to all the others (the same class of defect as the
 * SOCAR / Kapital Bank references removed from proposals in PR #1074).
 *
 * QA fixtures and tests keep their names; they are not product copy.
 */
const CLIENT_NAMES = [/swissmed/i, /\bsocar\b/i, /kapital\s*bank/i]
const PRODUCT_COPY_ROOTS = ["messages", "src/content", "src/components", "src/app", "src/lib"]

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (entry === "__tests__" || entry === "node_modules") continue
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(json|tsx?|mdx?)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

describe("product copy never names a customer", () => {
  it.each(PRODUCT_COPY_ROOTS)("%s is free of customer names", (root) => {
    const offenders: string[] = []
    for (const file of files(root)) {
      const text = readFileSync(file, "utf8")
      for (const pattern of CLIENT_NAMES) {
        const match = text.match(pattern)
        if (match) offenders.push(`${file}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
