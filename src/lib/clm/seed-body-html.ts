/**
 * Contract Editor — Slice 1, Step 2 (non-destructive legacy seeding).
 *
 * Legacy contracts have only `renderedBody` (plain text) and a null `bodyHtml`.
 * Opening one in the editor needs editable HTML — but must persist NOTHING on
 * open: `renderedBody` and the `contentHash` that binds e-sign envelopes to
 * frozen ContractVersions stay untouched until an explicit edit + save
 * (Step 3, which mints a new version). These helpers are PURE (return a string,
 * never touch the DB), so the non-destructive guarantee is structural.
 *
 * List reconstruction: we rebuild nested `<ol>/<ul>` from the serializer's own
 * output — `"- "` (ul), `"N. "` (ol, `start=N` when N≠1), 2-space-per-level
 * indent, mixed ul/ol, depth jumps (synthetic empty parent `<li>`), and an
 * `<li>`-internal `<p>` block (a column-0 paragraph whose next item nests
 * deeper). A SAFETY CHECK serializes the reconstruction and uses the structured
 * HTML ONLY when it round-trips EXACTLY, else falls back to flat `<p>` paragraphs.
 *
 * ⚠️ The guarantee is STRUCTURED-PATH-ONLY. The `paragraphs()` fallback is NOT
 * hash-stable: it `trim()`s each line, and the serializer also trims a `<p>`'s
 * leading whitespace, so an indented line CANNOT survive as a paragraph. Architect
 * fuzzing (1000 serializer bodies, 2026-06-09): structured path 70% (0 wrong
 * hashes), fallback 30% — of which **~12% of all bodies re-derive a DIFFERENT
 * `renderedBody`** (indent lost) → a spurious version on first save. The residual
 * class is numbering-restart / sibling same-depth lists (`"1. A\n  1. sub\n1. B"`)
 * the single-list-per-level grammar can't represent.
 *
 * Therefore [P2] (b) — a Step-3 save guard that skips the version-mint when the
 * only delta between re-derived and existing `renderedBody` is whitespace/indent
 * — is LOAD-BEARING for hash safety, not optional. This reconstruction only
 * shrinks how often (b) fires (47%→30% fallback). (b) lands with Step-3.
 * Tracked in memory/deferred_findings.md.
 */
import { serializeContractBody } from "./serialize-body"

/** Escape HTML metacharacters so plain text can't inject markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

type ListKind = "ul" | "ol"
interface PItem {
  isList: boolean
  depth: number // list-item nesting depth (indent/2); 0 for paragraphs
  kind: ListKind // for list items
  num: number // ol item number (for start= detection); 0 otherwise
  text: string
}

/** Classify each serializer-output line: a list item (indent depth + marker) or
 *  a plain paragraph. Indent must be an even number of spaces (2 per level). */
function parseItems(lines: string[]): PItem[] {
  return lines.map((line) => {
    const m = /^( *)(?:-|(\d+)\.) (.*)$/.exec(line)
    if (m && m[1].length % 2 === 0) {
      const depth = m[1].length / 2
      return m[2] !== undefined
        ? { isList: true, depth, kind: "ol" as const, num: Number(m[2]), text: m[3] }
        : { isList: true, depth, kind: "ul" as const, num: 0, text: m[3] }
    }
    return { isList: false, depth: 0, kind: "ul" as const, num: 0, text: line.trim() }
  })
}

/** Build nested `<ul>/<ol>` + `<p>` HTML from the classified items. A stack of
 *  open lists lets deeper items nest inside the current open `<li>`. Handles:
 *  - depth jumps >1 → synthetic empty parent `<li>` for the skipped levels (so
 *    `"  1. deep"` reconstructs as `<ol><li><ol><li>deep…`);
 *  - an `<li>`-internal `<p>` block → a column-0 paragraph whose NEXT item is
 *    DEEPER is emitted inside the current open `<li>` instead of closing the
 *    list (so `"1. A\nnote\n  1. deep"` keeps `note` inside item A).
 *  Same-depth paragraphs that continue a list round-trip via `start=N`, so they
 *  need no special handling. */
function reconstruct(lines: string[]): string {
  const items = parseItems(lines)
  const out: string[] = []
  const stack: { depth: number; kind: ListKind }[] = []
  const top = () => stack[stack.length - 1]
  const closeTop = () => {
    out.push("</li>")
    out.push(`</${top().kind}>`)
    stack.pop()
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    if (!item.isList) {
      const next = items[i + 1]
      // li-internal iff a list is open and the next item nests DEEPER (a nested
      // list will follow inside the current open <li>). Else it closes the list.
      if (stack.length && next?.isList && next.depth > top().depth) {
        out.push(`<p>${escapeHtml(item.text)}</p>`)
      } else {
        while (stack.length) closeTop()
        out.push(`<p>${escapeHtml(item.text)}</p>`)
      }
      continue
    }

    while (stack.length && top().depth > item.depth) closeTop()

    if (stack.length && top().depth === item.depth) {
      if (top().kind !== item.kind) closeTop()
      else out.push("</li>")
    }

    // Open lists up to item.depth — synthetic empty parents for any skipped levels.
    while (!stack.length || top().depth < item.depth) {
      const openDepth = stack.length ? top().depth + 1 : 0
      const startAttr = item.kind === "ol" && item.num !== 1 ? ` start="${item.num}"` : ""
      out.push(`<${item.kind}${openDepth === item.depth ? startAttr : ""}>`)
      stack.push({ depth: openDepth, kind: item.kind })
      if (openDepth < item.depth) out.push("<li>") // empty parent <li> holds the deeper list
    }

    out.push(`<li>${escapeHtml(item.text)}`) // left open — a deeper item may nest into it
  }

  while (stack.length) closeTop()
  return out.join("")
}

/** Flat-paragraph fallback (preserves text; structure/indent may flatten). */
function paragraphs(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join("")
}

/**
 * Wrap plain `renderedBody` into editor HTML, faithfully reconstructing lists
 * (verified byte-stable via the serializer) and falling back to paragraphs when
 * the input isn't serializer-shaped. Returns "" for empty input.
 */
export function seedBodyHtmlFromText(renderedBody: string | null | undefined): string {
  const text = (renderedBody ?? "").replace(/\r\n?/g, "\n")
  if (text.trim() === "") return ""

  const lines = text.split("\n").filter((l) => l.length > 0)
  const structured = reconstruct(lines)

  // SAFETY: only trust the structured reconstruction if it round-trips exactly.
  if (serializeContractBody(structured) === text) return structured
  return paragraphs(lines)
}

/**
 * The HTML to load into the editor for a contract. Returns the stored
 * `bodyHtml` when present, otherwise a NON-DESTRUCTIVE seed from `renderedBody`.
 * NEVER writes the database — persistence happens only on the first save.
 */
export function getOrSeedBodyHtml(contract: {
  bodyHtml?: string | null
  renderedBody?: string | null
}): string {
  if (contract.bodyHtml != null && contract.bodyHtml.trim() !== "") {
    return contract.bodyHtml
  }
  return seedBodyHtmlFromText(contract.renderedBody)
}
