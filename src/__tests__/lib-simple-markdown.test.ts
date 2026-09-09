/**
 * markdownToHtml — the lightweight LLM-text renderer (Da Vinci replies).
 * Focus on the table block parsing added for tabular answers (ticket lists etc.).
 */
import { describe, it, expect } from "vitest"
import { markdownToHtml } from "@/lib/simple-markdown"

describe("markdownToHtml — tables", () => {
  const table = "| Bilet | Mövzu | Önəm |\n|-------|-------|------|\n| **DV-1** | WhatsApp | 🔴 Kritik |\n| DV-2 | CRM | Normal |"

  it("renders a markdown table as a real <table>, not raw pipes", () => {
    const html = markdownToHtml(table)
    expect(html).toContain("<table>")
    expect(html).toContain("<thead>")
    expect(html).toContain("<tbody>")
    // header cells
    expect(html).toContain("<th>Bilet</th>")
    expect(html).toContain("<th>Önəm</th>")
    // body cells (bold inside a cell handled by the global bold pass)
    expect(html).toContain("<strong>DV-1</strong>")
    expect(html).toContain("🔴 Kritik")
    // the literal separator row must NOT leak as text
    expect(html).not.toContain("|---")
    expect(html).not.toMatch(/<p>\s*\|/)
  })

  it("keeps text after a table (does not swallow following lines)", () => {
    const html = markdownToHtml(table + "\n\nDiqqət: vacib.")
    expect(html).toContain("</table>")
    expect(html).toContain("Diqqət: vacib.")
  })

  it("still renders bold / bullets / headings / code (no regression)", () => {
    expect(markdownToHtml("**hi**")).toContain("<strong>hi</strong>")
    expect(markdownToHtml("- one\n- two")).toContain("<li")
    expect(markdownToHtml("## Title")).toContain("<h3")
    expect(markdownToHtml("`x`")).toContain("<code")
  })

  it("does not treat a single piped line (no separator) as a table", () => {
    const html = markdownToHtml("a | b | c")
    expect(html).not.toContain("<table>")
  })
})
