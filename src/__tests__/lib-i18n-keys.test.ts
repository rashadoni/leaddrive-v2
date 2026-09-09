/**
 * i18n key-existence guard (architect Q5 follow-up).
 *
 * Walks selected localized pages + components, regex-scrapes `t("...")`,
 * `tX("...")`, and template-literal forms like `t(\`weekday.${d}\`)`
 * (the dynamic suffix is replaced with `*` and we verify the prefix
 * branch exists in every locale catalog).
 *
 * Catches:
 *   • typo in a key the developer wrote (e.g. `t("welcombeBack")`)
 *   • missing translation in ru.json / az.json after en.json was updated
 *   • silent next-intl fallback to the literal key string
 *
 * Doesn't catch:
 *   • t(somethingComputed) calls where the key isn't a string literal
 *     (we skip them with a console warn so the test author sees what's
 *     uncovered)
 */

import { describe, it, expect } from "vitest"
import fs from "fs"
import path from "path"

const REPO_ROOT = path.resolve(__dirname, "../..")
const MESSAGES_DIR = path.join(REPO_ROOT, "messages")

type CatalogNode = string | number | boolean | null | CatalogNode[] | { [key: string]: CatalogNode }
type Catalog = Record<string, CatalogNode>

// Files to scan — localized surfaces with template-heavy translation calls.
const SCAN_GLOBS = [
  "src/app/(dashboard)/mtm",
  "src/app/(dashboard)/inbox/business-hours",
  "src/components/mtm",
  // Voice console — the pilot runs in ru and az, so a key that exists only in
  // en would surface as a raw identifier spoken back at the user.
  "src/app/(dashboard)/ai/voice",
  "src/components/ai",
]

function listTsxFiles(dir: string): string[] {
  const abs = path.join(REPO_ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(tsx|ts)$/.test(entry.name)) out.push(p)
    }
  }
  walk(abs)
  return out
}

/**
 * Returns the set of `useTranslations("namespace")` namespaces declared
 * in `source`, keyed by the variable name (t, td, ts, ta, ...).
 */
function findTranslatorBindings(source: string): Map<string, string> {
  const map = new Map<string, string>()
  // const t = useTranslations("nav")
  // const td = useTranslations("mtmDashboardPage")
  const re = /const\s+(\w+)\s*=\s*useTranslations\(\s*["']([^"']+)["']\s*\)/g
  for (const m of source.matchAll(re)) map.set(m[1], m[2])
  return map
}

/**
 * Returns the array of (varName, key) pairs found in `source`, where
 * `key` is either a literal string (`t("foo")`) or a template prefix
 * with `.*` suffix (`t(\`weekday.${d}\`)` → `weekday.*`).
 */
function findTranslateCalls(source: string): Array<{ varName: string; key: string; isTemplate: boolean }> {
  const out: Array<{ varName: string; key: string; isTemplate: boolean }> = []
  // varName("literal") — varName is 1-3 chars typically (t, td, ts, ...)
  // Capture explicit double-quoted, single-quoted, and template-literal forms.
  const reLit = /\b(\w{1,8})\(\s*["']([^"'`]+)["']\s*[,)]/g
  for (const m of source.matchAll(reLit)) {
    // Skip non-translator-looking calls (heuristic: name must look like a t/tX or be in the binding map)
    if (!/^t[a-zA-Z]?[a-zA-Z]?$/.test(m[1])) continue
    out.push({ varName: m[1], key: m[2], isTemplate: false })
  }
  const reTpl = /\b(\w{1,8})\(\s*`([^`]+)`\s*[,)]/g
  for (const m of source.matchAll(reTpl)) {
    if (!/^t[a-zA-Z]?[a-zA-Z]?$/.test(m[1])) continue
    // Replace ${...} with * for prefix matching
    const key = m[2].replace(/\$\{[^}]+\}/g, "*")
    out.push({ varName: m[1], key, isTemplate: true })
  }
  return out
}

function isCatalogRecord(node: CatalogNode): node is Record<string, CatalogNode> {
  return node !== null && typeof node === "object" && !Array.isArray(node)
}

function keyExistsInCatalog(catalog: Catalog, namespace: string, key: string, isTemplate: boolean): boolean {
  let root: CatalogNode = catalog
  for (const segment of namespace.split(".")) {
    if (!isCatalogRecord(root) || !(segment in root)) return false
    const child = root[segment]
    if (child === undefined) return false
    root = child
  }
  // Walk dot-path. Each segment may be exact, "*" (whole-segment wildcard),
  // or contain "*" inside (e.g. "ach_*_label" — wildcard substitution from
  // a template literal like `t(\`ach_${k}_label\`)`).
  const parts = key.split(".")
  let node: CatalogNode = root
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p === undefined) return false
    if (!isCatalogRecord(node)) return false
    const current: Record<string, CatalogNode> = node
    if (p === "*") {
      // Whole-segment wildcard → at least one child must exist; descend
      // into the first child for further matching (only meaningful if "*"
      // is the last segment, which is typical).
      const ks: string[] = Object.keys(current)
      if (ks.length === 0) return false
      if (i === parts.length - 1) return true
      const firstKey = ks[0]
      if (firstKey === undefined) return false
      const child: CatalogNode | undefined = current[firstKey]
      if (child === undefined) return false
      node = child
      continue
    }
    if (p.includes("*")) {
      // In-segment wildcard. Treat as regex; match against the current
      // node's keys. `[^.]+` (segment-non-greedy) avoids over-matching
      // longer composed keys: `ach_*_label` should match `ach_X_label`
      // but NOT `ach_X_label_extra`.
      const re = new RegExp("^" + p.replace(/\*/g, "[^.]+") + "$")
      const matchingKeys = Object.keys(current).filter((k) => re.test(k))
      if (matchingKeys.length === 0) return false
      if (i === parts.length - 1) return true
      // Recurse into each matching sibling and see if any has the rest.
      const rest = parts.slice(i + 1).join(".")
      return matchingKeys.some((k) => {
        const child: CatalogNode | undefined = current[k]
        return child !== undefined && keyExistsInCatalog({ _: child }, "_", rest, isTemplate)
      })
    }
    if (!(p in current)) return false
    const child: CatalogNode | undefined = current[p]
    if (child === undefined) return false
    node = child
  }
  if (isTemplate) return node != null
  return typeof node === "string" || typeof node === "number"
}

const locales = ["en", "ru", "az"] as const
const catalogs: Record<string, Catalog> = {}
for (const l of locales) {
  catalogs[l] = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${l}.json`), "utf8")) as Catalog
}

const files = SCAN_GLOBS.flatMap(listTsxFiles)

describe("i18n key existence (localized pages + components)", () => {
  it("scans at least one MTM file (sanity check)", () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it("every literal t() key resolves in en.json", () => {
    const missing: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8")
      const bindings = findTranslatorBindings(source)
      const calls = findTranslateCalls(source)
      for (const { varName, key, isTemplate } of calls) {
        const namespace = bindings.get(varName)
        if (!namespace) continue // not a translator we know — skip
        if (!keyExistsInCatalog(catalogs.en, namespace, key, isTemplate)) {
          missing.push(`${path.relative(REPO_ROOT, file)} → ${varName}("${key}") [namespace ${namespace}]`)
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(`${missing.length} missing en.json key(s):\n${missing.join("\n")}`)
    }
  })

  for (const locale of ["ru", "az"] as const) {
    it(`every key present in en.json also resolves in ${locale}.json (parity)`, () => {
      const missing: string[] = []
      for (const file of files) {
        const source = fs.readFileSync(file, "utf8")
        const bindings = findTranslatorBindings(source)
        const calls = findTranslateCalls(source)
        for (const { varName, key, isTemplate } of calls) {
          const namespace = bindings.get(varName)
          if (!namespace) continue
          if (!keyExistsInCatalog(catalogs.en, namespace, key, isTemplate)) continue // already caught above
          if (!keyExistsInCatalog(catalogs[locale], namespace, key, isTemplate)) {
            missing.push(`${path.relative(REPO_ROOT, file)} → ${varName}("${key}") [namespace ${namespace}]`)
          }
        }
      }
      if (missing.length > 0) {
        throw new Error(`${missing.length} missing ${locale}.json key(s):\n${missing.join("\n")}`)
      }
    })
  }
})
