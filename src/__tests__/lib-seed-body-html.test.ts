/**
 * Tests for the non-destructive legacy seed helpers (Contract Editor Slice 1,
 * Step 2). The load-bearing property is the ROUND TRIP:
 *   serializeContractBody(seedBodyHtmlFromText(renderedBody)) === renderedBody
 * for serializer-shaped text — so opening a legacy contract in the editor and
 * (eventually) re-deriving renderedBody reproduces the same text, keeping the
 * contentHash stable. The helpers are pure (no DB), so opening can't mutate.
 */
import { describe, expect, it } from "vitest"
import { getOrSeedBodyHtml, seedBodyHtmlFromText } from "@/lib/clm/seed-body-html"
import { serializeContractBody } from "@/lib/clm/serialize-body"

describe("seedBodyHtmlFromText", () => {
  it("wraps each non-empty line in a <p>", () => {
    expect(seedBodyHtmlFromText("First.\nSecond.")).toBe("<p>First.</p><p>Second.</p>")
  })

  it("drops empty lines (mirrors serializer rule 3)", () => {
    expect(seedBodyHtmlFromText("a\n\n\nb")).toBe("<p>a</p><p>b</p>")
    expect(seedBodyHtmlFromText("  \n  ")).toBe("")
  })

  it("escapes HTML metacharacters (no markup injection from plain text)", () => {
    expect(seedBodyHtmlFromText("Acme & Co <legal>")).toBe("<p>Acme &amp; Co &lt;legal&gt;</p>")
    expect(seedBodyHtmlFromText("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    )
  })

  it("normalizes CRLF/CR to LF", () => {
    expect(seedBodyHtmlFromText("a\r\nb\rc")).toBe("<p>a</p><p>b</p><p>c</p>")
  })

  it("empty / null / undefined → empty string", () => {
    expect(seedBodyHtmlFromText("")).toBe("")
    expect(seedBodyHtmlFromText(null)).toBe("")
    expect(seedBodyHtmlFromText(undefined)).toBe("")
  })
})

describe("seed ↔ serialize ROUND TRIP (hash-stability guarantee)", () => {
  const cases = [
    "First.\nSecond.",
    "MASTER SERVICES AGREEMENT\nThis Agreement is made between the parties.",
    "Acme & Co — 100 USD", // entities survive: escape on seed, decode on serialize
    "Line with <angle> brackets",
    "café périods".normalize("NFC"),
    "Single line",
  ]
  for (const text of cases) {
    it(`round-trips: ${JSON.stringify(text.slice(0, 32))}`, () => {
      expect(serializeContractBody(seedBodyHtmlFromText(text))).toBe(text)
    })
  }

  // Faithful list reconstruction — every serializer-shaped list shape must
  // round-trip BYTE-STABLE (this is what makes the first save non-spurious).
  const listBodies = [
    "1. Term\n2. Fees\n3. Confidentiality", // flat ol
    "- alpha\n- beta\n- gamma", // flat ul
    "1. Term\n  1. Sub-clause\n2. Fees", // NESTED ol (the [P2] case — now fixed)
    "1. Term\n  1. Sub A\n  2. Sub B\n2. Fees", // nested ol, two sub-items
    "- top\n  - mid\n    - deep", // 3-level nested ul
    "1. Step\n  - note\n  - caveat\n2. Next", // mixed ol > ul
    "3. Item three\n4. Item four", // ol with start=3
    "Intro paragraph.\n1. First\n2. Second\nClosing paragraph.", // paragraphs around a list
    "1. A\n  1. A.i\n    1. A.i.x\n2. B", // 3-level nested ol
  ]
  for (const body of listBodies) {
    it(`reconstructs byte-stable: ${JSON.stringify(body.slice(0, 40))}`, () => {
      expect(serializeContractBody(seedBodyHtmlFromText(body))).toBe(body)
    })
  }

  it("the [P2] nested-numbered-clause case now round-trips (indent preserved)", () => {
    const serialized = serializeContractBody(
      "<ol><li>Term<ol><li>Sub-clause</li></ol></li><li>Fees</li></ol>",
    )
    expect(serialized).toBe("1. Term\n  1. Sub-clause\n2. Fees") // pin serializer indent contract
    expect(serializeContractBody(seedBodyHtmlFromText(serialized))).toBe(serialized) // FIXED: equal
  })

  it("falls back to paragraphs (text preserved) when input isn't serializer-shaped", () => {
    // odd 3-space indent is not a valid 2/level list → fallback; text survives
    const odd = "1. A\n   weird-indent line"
    const out = seedBodyHtmlFromText(odd)
    expect(out).toContain("weird-indent line")
    expect(out).toContain("A")
  })

  // ── Former [P2] drift classes — now reconstructed faithfully (round-trip).
  it("FIXED: <p> block inside an <li> before a nested list round-trips", () => {
    const body = serializeContractBody("<ol><li>A<p>note</p><ol><li>deep</li></ol></li></ol>")
    expect(body).toBe("1. A\nnote\n  1. deep") // serializer output
    // li-internal <p> + nested list both preserved (lookahead → deeper next item)
    expect(serializeContractBody(seedBodyHtmlFromText(body))).toBe(body)
  })

  it("FIXED: depth-jump >1 (empty parent <li>) round-trips via synthetic parent", () => {
    const body = serializeContractBody("<ol><li><ol><li>deep</li></ol></li></ol>")
    expect(body).toBe("  1. deep") // serializer drops the empty parent <li>
    expect(serializeContractBody(seedBodyHtmlFromText(body))).toBe(body) // synthetic parent restores indent
  })

  it("FIXED: deeper depth-jump (2 levels skipped) round-trips", () => {
    const body = serializeContractBody(
      "<ol><li><ol><li><ol><li>x</li></ol></li></ol></li></ol>",
    )
    expect(serializeContractBody(seedBodyHtmlFromText(body))).toBe(body)
  })

  it("FIXED: paragraph that continues a list (start=N) still round-trips", () => {
    const body = "1. A\nnote between\n2. B" // serializer: li-internal note, list continues as 2.
    expect(serializeContractBody("<ol><li>A<p>note between</p></li><li>B</li></ol>")).toBe(body)
    expect(serializeContractBody(seedBodyHtmlFromText(body))).toBe(body)
  })

  it("DOCUMENTED FALLBACK CORRUPTION [P2 — needs Step-3 guard (b)]: sibling/restart list", () => {
    // Two adjacent top-level <ol>s (numbering restarts at 1) — serializer-producible,
    // but the single-list-per-level grammar can't represent it: structured re-numbers
    // the 2nd item to "2.", so the safety check rejects → fallback trims the nested
    // indent → a DIFFERENT renderedBody. This ~12% class (architect fuzz) is exactly
    // why the Step-3 whitespace-delta version-mint guard (b) is load-bearing.
    const body = "1. A\n  1. sub\n1. B"
    expect(serializeContractBody("<ol><li>A<ol><li>sub</li></ol></li></ol><ol><li>B</li></ol>")).toBe(body)
    const reDerived = serializeContractBody(seedBodyHtmlFromText(body))
    expect(reDerived).toBe("1. A\n1. sub\n1. B") // indent of "  1. sub" lost via fallback
    expect(reDerived).not.toBe(body) // CORRUPTS hash on a no-op save → (b) must catch it
  })
})

describe("getOrSeedBodyHtml", () => {
  it("returns the stored bodyHtml when present", () => {
    expect(getOrSeedBodyHtml({ bodyHtml: "<h1>Edited</h1>", renderedBody: "old text" })).toBe(
      "<h1>Edited</h1>",
    )
  })

  it("seeds from renderedBody when bodyHtml is null/blank", () => {
    expect(getOrSeedBodyHtml({ bodyHtml: null, renderedBody: "a\nb" })).toBe("<p>a</p><p>b</p>")
    expect(getOrSeedBodyHtml({ bodyHtml: "   ", renderedBody: "x" })).toBe("<p>x</p>")
  })

  it("both null → empty string (a brand-new contract opens blank)", () => {
    expect(getOrSeedBodyHtml({ bodyHtml: null, renderedBody: null })).toBe("")
    expect(getOrSeedBodyHtml({})).toBe("")
  })

  it("seeded legacy body, once re-serialized, equals the original renderedBody", () => {
    const renderedBody = "Party A and Party B agree.\nGoverning law: Poland."
    const seeded = getOrSeedBodyHtml({ bodyHtml: null, renderedBody })
    expect(serializeContractBody(seeded)).toBe(renderedBody)
  })
})
