/**
 * Golden-master tests for `serializeContractBody` (Contract Editor Slice 1, Step 1).
 *
 * This serializer owns the `bodyHtml -> renderedBody` derivation; its output is
 * hashed (`contentHash = sha256(renderedBody)`) and that hash binds e-sign
 * envelopes to frozen ContractVersions. So the contract under test is:
 * **same visible document via ANY input path => byte-identical output => identical SHA.**
 * A regression here silently orphans signature bindings, so these tests gate
 * every write path in later steps.
 *
 * NFC/NFD distinctions are forced at RUNTIME via `.normalize()` (never relying
 * on the file's on-disk byte form), so an NFC assertion can't trivially pass.
 */
import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { serializeContractBody } from "@/lib/clm/serialize-body"

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

describe("serializeContractBody - rules 5.1.1", () => {
  it("rule 1: block elements become single newlines", () => {
    expect(serializeContractBody("<p>First.</p><p>Second.</p>")).toBe("First.\nSecond.")
    expect(serializeContractBody("<h1>Title</h1><p>Body.</p>")).toBe("Title\nBody.")
  })

  it("rule 1: <br> and <hr> are line breaks", () => {
    expect(serializeContractBody("<p>a<br>b</p>")).toBe("a\nb")
    expect(serializeContractBody("<p>x</p><hr><p>y</p>")).toBe("x\ny")
  })

  it("rule 2: <ul> items get '- ' prefixed by 2-space depth", () => {
    expect(serializeContractBody("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two")
    expect(serializeContractBody("<ul><li>a<ul><li>b</li></ul></li></ul>")).toBe("- a\n  - b")
  })

  it("rule 2: <ol> items are numbered 1. 2. 3.", () => {
    expect(serializeContractBody("<ol><li>first</li><li>second</li><li>third</li></ol>")).toBe(
      "1. first\n2. second\n3. third",
    )
  })

  it("rule 2: nested <ol> numbers independently per level", () => {
    expect(serializeContractBody("<ol><li>a<ol><li>b</li><li>c</li></ol></li><li>d</li></ol>")).toBe(
      "1. a\n  1. b\n  2. c\n2. d",
    )
  })

  it("rule 2: <ol start=\"N\"> is respected", () => {
    expect(serializeContractBody('<ol start="3"><li>x</li><li>y</li></ol>')).toBe("3. x\n4. y")
  })

  it("rule 2: mixed <ol> with nested <ul>", () => {
    expect(serializeContractBody("<ol><li>step<ul><li>note</li></ul></li></ol>")).toBe(
      "1. step\n  - note",
    )
  })

  it("rule 3: empty blocks are dropped (no bare newline)", () => {
    expect(serializeContractBody("<p>a</p><p></p><p>b</p>")).toBe("a\nb")
    expect(serializeContractBody("<p>  </p>")).toBe("")
  })

  it("PINNED behavior: text after a nested list becomes a top-level line (no marker)", () => {
    // Documented Slice-1 choice: trailing text inside an <li>, after a nested
    // list, is flushed as its own unmarked line. Pinned so a future refactor
    // can't silently shift the hash. (Fidelity decision escalated to the user.)
    expect(serializeContractBody("<ul><li>before<ul><li>inner</li></ul>after</li></ul>")).toBe(
      "- before\n  - inner\nafter",
    )
  })

  it("rule 4: table cells join by space, rows by newline", () => {
    const html =
      "<table><tr><td>Item</td><td>Qty</td></tr><tr><td>Widget</td><td>3</td></tr></table>"
    expect(serializeContractBody(html)).toBe("Item Qty\nWidget 3")
  })

  it("rule 4: block content in a cell flattens to a space-joined unit (mammoth <p>-in-<td>)", () => {
    const html = "<table><tr><td><p>a</p><p>b</p></td><td>c</td></tr></table>"
    expect(serializeContractBody(html)).toBe("a b c")
  })

  it("rule 4: nested table is counted once, not duplicated", () => {
    const html =
      "<table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>"
    expect(serializeContractBody(html)).toBe("outer inner")
  })

  it("perf guard: a wide table parses ONCE, not per-cell (no quadratic cliff)", () => {
    // A flat 400-cell row. With the single-parse design this is ~tens of ms;
    // a per-cell innerHTML re-parse regression would be ~seconds. The 1000ms
    // bound separates them with a wide margin (won't flake on loaded CI).
    const n = 400
    const cells = Array.from({ length: n }, (_, i) => `<td>c${i}</td>`).join("")
    const html = `<table><tr>${cells}</tr></table>`
    const t0 = performance.now()
    const out = serializeContractBody(html)
    const elapsed = performance.now() - t0
    expect(out).toBe(Array.from({ length: n }, (_, i) => `c${i}`).join(" "))
    expect(elapsed).toBeLessThan(1000)
  })

  it("rule 5: HTML entities decode to characters", () => {
    // &mdash; -> U+2014, &nbsp; -> U+00A0 (which rule-7 collapses to a space)
    expect(serializeContractBody("<p>Acme &amp; Co &mdash; 100&nbsp;USD</p>")).toBe(
      "Acme & Co — 100 USD",
    )
    // numeric + named encodings of the same glyph collapse identically
    expect(serializeContractBody("<p>&#38;</p>")).toBe(serializeContractBody("<p>&amp;</p>"))
  })

  it("rule 6: output is NFC-normalized", () => {
    const nfd = `<p>${"café".normalize("NFD")}</p>` // decomposed at runtime
    const nfc = `<p>${"café".normalize("NFC")}</p>` // composed at runtime
    expect(serializeContractBody(nfd)).toBe(serializeContractBody(nfc))
    expect(serializeContractBody(nfd)).toBe("café".normalize("NFC"))
  })

  it("rule 7: intra-line whitespace collapses; trailing trimmed", () => {
    expect(serializeContractBody("<p>too    many     spaces  </p>")).toBe("too many spaces")
    expect(serializeContractBody("<p>line\n  with\n  source\n  newlines</p>")).toBe(
      "line with source newlines",
    )
  })

  it("inline marks (strong/em/u/span) do not break lines", () => {
    expect(serializeContractBody("<p>This is <strong>bold</strong> and <em>italic</em>.</p>")).toBe(
      "This is bold and italic.",
    )
  })

  it("plain text (no wrapper) round-trips", () => {
    expect(serializeContractBody("just text")).toBe("just text")
  })

  it("null/empty input is the empty string", () => {
    expect(serializeContractBody(null)).toBe("")
    expect(serializeContractBody(undefined)).toBe("")
    expect(serializeContractBody("")).toBe("")
  })

  it("is idempotent on its own structural output (stable across re-render)", () => {
    const once = serializeContractBody("<h2>Term</h2><p>Renews for {{renewal_period}}.</p>")
    const wrapped = once
      .split("\n")
      .map((l) => `<p>${l}</p>`)
      .join("")
    // re-serializing the <p>-wrapped output yields the same text (round-trip stable)
    expect(serializeContractBody(wrapped)).toBe(once)
  })
})

describe("serializeContractBody - 3-path GOLDEN MASTER (same SHA across input sources)", () => {
  // The SAME visible clause, produced by three independent input paths.
  // Accents forced composed/decomposed at runtime; apostrophe via 3 encodings.
  const cafeNFC = "café périods".normalize("NFC")
  const cafeNFD = "café périods".normalize("NFD")
  const RSQUO = "’" // ' right single quote (literal glyph in the AI path)

  //  TipTap  - clean semantic HTML, NFC accents, named entity &rsquo;
  const tiptap =
    "<h2>3. Term</h2>" +
    `<p>The initial term is two (2) years and renews for ${cafeNFC} unless either party gives 60 days&rsquo; notice.</p>`

  //  mammoth - .docx import: NFD accents, numeric entity &#8217;, inline styles
  const mammoth =
    '<h2 style="margin:0">3. Term</h2>' +
    `<p style="text-align:justify">The initial term is two (2) years and renews for ${cafeNFD} ` +
    "unless either party gives 60 days&#8217; notice.</p>"

  //  AI      - model-authored: NFC accents, literal U+2019 glyph, extra whitespace + source newlines
  const ai =
    "<h2>3. Term</h2>\n" +
    `<p>The initial term is two (2) years and   renews for ${cafeNFC}\n` +
    `unless either party gives 60 days${RSQUO} notice.</p>`

  it("all three produce byte-identical renderedBody", () => {
    const a = serializeContractBody(tiptap)
    expect(serializeContractBody(mammoth)).toBe(a)
    expect(serializeContractBody(ai)).toBe(a)
  })

  it("all three produce the identical sha256 (the binding-critical guarantee)", () => {
    expect(sha(serializeContractBody(mammoth))).toBe(sha(serializeContractBody(tiptap)))
    expect(sha(serializeContractBody(ai))).toBe(sha(serializeContractBody(tiptap)))
  })

  it("the golden output is exactly the expected text", () => {
    expect(serializeContractBody(tiptap)).toBe(
      "3. Term\n" +
        `The initial term is two (2) years and renews for ${cafeNFC} unless either party gives 60 days${RSQUO} notice.`,
    )
  })
})
