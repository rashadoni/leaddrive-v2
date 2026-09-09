/**
 * Contract Editor — Slice 1, Step 1.
 *
 * `serializeContractBody(bodyHtml)` is the SINGLE deterministic owner of the
 * HTML → plain-text derivation for `Contract.renderedBody`. `bodyHtml` is the
 * editable source of truth; `renderedBody` is its derived plain-text mirror,
 * and `contentHash = sha256(renderedBody)` is the integrity/lookup key that
 * binds an e-sign envelope to its frozen `ContractVersion`
 * (see `esign/[envelopeId]/send/route.ts`).
 *
 * Therefore this function MUST be deterministic: the same *visible* document —
 * whether typed in TipTap, imported from .docx via mammoth, or authored by the
 * AI — must produce a BYTE-IDENTICAL string, so the SHA is stable across
 * renders, servers and import paths. We parse a real DOM (jsdom) ONCE, then
 * walk it applying the spec §5.1.1 ruleset:
 *
 *   1. block elements → a single `\n`; `<br>`/`<hr>` → `\n`
 *   2. <ul> items → `- `, <ol> items → `1. `/`2. `… (numbered per level), 2-sp indent/level
 *   3. empty blocks (`<p></p>`) → dropped, never a bare `\n`
 *   4. table cells joined by a single space, rows by `\n`
 *   5. HTML entities decoded to their character (jsdom does this natively)
 *   6. output Unicode-normalized to NFC (defeats mammoth/.docx NFD drift)
 *   7. intra-line whitespace runs collapse to one space; trailing trimmed
 *
 * Performance: the document is parsed exactly ONCE. Table cells recurse over
 * the already-parsed DOM nodes via a child collector — never re-parsing a
 * cell's innerHTML (a per-cell re-parse is quadratic on wide tables).
 */
import { JSDOM } from "jsdom"

/** Block-level tags that force a line boundary (rule 1). */
const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "DIV", "BLOCKQUOTE", "SECTION", "ARTICLE", "PRE", "FIGURE", "FIGCAPTION", "ADDRESS",
])

const TEXT_NODE = 3
const ELEMENT_NODE = 1

/** Mutable collector — a fresh one is spawned per table cell so a cell flattens
 *  to its own space-joined unit without touching the parent's line state. */
interface Collector {
  lines: string[]
  line: string
  /** List marker + indent for the current line, kept OUT of `line` so the
   *  whitespace-collapse/trim can't eat the leading indent (rule 2). */
  prefix: string
}

function flush(c: Collector): void {
  // rule 7: collapse all intra-line whitespace (incl. source newlines) to a
  // single space, trim ends. rule 3: an empty block contributes no line.
  const content = c.line.replace(/\s+/g, " ").trim()
  if (content.length > 0) c.lines.push(c.prefix + content)
  c.line = ""
  c.prefix = ""
}

function walk(node: Node, listDepth: number, c: Collector): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === TEXT_NODE) {
      c.line += (child as Text).data // rule 5: jsdom already entity-decoded
      return
    }
    if (child.nodeType !== ELEMENT_NODE) return // skip comments / PIs

    const el = child as Element
    const tag = el.tagName

    if (tag === "BR" || tag === "HR") {
      flush(c) // rule 1
    } else if (tag === "UL" || tag === "OL") {
      flush(c)
      // rule 2: <ul> items use "- "; <ol> items use "1. ", "2. ", … (ordered
      // numbering matters for legal "Section N" bodies). Each level numbers
      // independently; <ol start="N"> is respected. Indent = 2 spaces / level.
      const ordered = tag === "OL"
      let n = Number.parseInt(el.getAttribute("start") ?? "", 10)
      if (!Number.isFinite(n) || n < 1) n = 1
      el.childNodes.forEach((node) => {
        if (node.nodeType !== ELEMENT_NODE || (node as Element).tagName !== "LI") return
        flush(c)
        c.prefix = "  ".repeat(listDepth) + (ordered ? `${n}. ` : "- ")
        if (ordered) n += 1
        walk(node as Element, listDepth + 1, c) // nested lists are one level deeper
        flush(c)
      })
      flush(c)
    } else if (tag === "LI") {
      // stray <li> outside a list — render as a bullet at the current level
      flush(c)
      c.prefix = "  ".repeat(listDepth) + "- "
      walk(el, listDepth + 1, c)
      flush(c)
    } else if (tag === "TABLE") {
      flush(c) // rule 4
      // Only THIS table's own rows/cells — `.closest()` excludes rows/cells that
      // belong to a nested table (they're serialized inside their parent cell).
      const ownRows = Array.from(el.querySelectorAll("tr")).filter(
        (tr) => tr.closest("table") === el,
      )
      ownRows.forEach((tr) => {
        const ownCells = Array.from(tr.querySelectorAll("td, th")).filter(
          (cell) => cell.closest("tr") === tr,
        )
        const cellTexts = ownCells.map((cell) => {
          // Recurse over the cell's EXISTING DOM nodes (no re-parse) into a
          // fresh collector, then flatten to one space-joined unit.
          const sub: Collector = { lines: [], line: "", prefix: "" }
          walk(cell, listDepth, sub)
          flush(sub)
          return sub.lines.join(" ").replace(/\s+/g, " ").trim()
        })
        const row = cellTexts.join(" ").replace(/\s+/g, " ").trim()
        if (row.length > 0) c.lines.push(row)
      })
    } else if (tag === "IMG") {
      // Toolbar Phase 3 — the plan's DELIBERATE serializer exception: the
      // signed plaintext names the asset ("[alt]") instead of silently
      // dropping it (an <img> has no children, so the generic walk below
      // would yield nothing). No alt → contributes nothing, same as before.
      // The block-flush is intentional even for an INLINE img mid-paragraph:
      // "Lorem [Stamp] ipsum" becomes three lines — deterministic and
      // hash-stable, fidelity traded for canonical output.
      const alt = (el.getAttribute("alt") || "").trim()
      if (alt) {
        flush(c)
        c.lines.push(`[${alt}]`)
      }
    } else if (BLOCK_TAGS.has(tag)) {
      flush(c) // rule 1
      walk(el, listDepth, c)
      flush(c)
    } else {
      walk(el, listDepth, c) // inline: STRONG/EM/U/SPAN/A/CODE/...
    }
  })
}

/**
 * Deterministically serialize contract `bodyHtml` to canonical plain text.
 * Pure: no I/O, no globals. Same visible document ⇒ byte-identical output.
 */
export function serializeContractBody(bodyHtml: string | null | undefined): string {
  const html = bodyHtml ?? ""
  const document = new JSDOM(`<!doctype html><body>${html}</body>`).window.document
  const c: Collector = { lines: [], line: "", prefix: "" }
  walk(document.body, 0, c)
  flush(c)
  return c.lines.join("\n").normalize("NFC") // rule 6
}
