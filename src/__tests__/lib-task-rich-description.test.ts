/**
 * The description's formatting: what is stored, and that the plain text every
 * other reader uses always says the same thing as the formatted one.
 * Ulviyya (Zeytun), 2026-11-13: «в тасках включите функцию жирный шрифт как в бордио».
 */
import { describe, expect, it } from "vitest"
import { descriptionTextOf, hasFormatting, plainToDescriptionHtml } from "@/lib/tasks/rich-description"
import { cleanDescription } from "@/lib/tasks/rich-description-server"
import { listLinesOf } from "@/lib/tasks/list-lines"

describe("a formatted description", () => {
  it("keeps bold, italic, underline and both lists — and says the same in plain text", () => {
    const html = "<p>Banner ölçüləri: <strong>1080 × 1920</strong> və 1200 × 628.</p><p><em>Yalnız Azərbaycan dilində</em>, <u>Nazrin</u> təsdiq edir.</p><ol><li><p>Vizual hazırlanır</p></li><li><p>Saytda yerləşdirilir</p></li></ol><ul><li><p>Ferveks</p></li></ul>"
    const stored = cleanDescription(html)
    expect(stored.html).toBe(html)
    expect(stored.text).toBe("Banner ölçüləri: 1080 × 1920 və 1200 × 628.\nYalnız Azərbaycan dilində, Nazrin təsdiq edir.\n1. Vizual hazırlanır\n2. Saytda yerləşdirilir\n• Ferveks")
  })

  it("a list made with the buttons is still a list for «split into subtasks»", () => {
    const { text } = cleanDescription("<p>Ölçülər:</p><ol><li><p>167 x 88 Ferveks</p></li><li><p>122 x 88 Hedelix</p></li><li><p>pixel quraşdırılması</p></li></ol>")
    expect(listLinesOf(text)).toEqual(["167 x 88 Ferveks", "122 x 88 Hedelix", "pixel quraşdırılması"])
  })

  it("text that was only retyped stays an ordinary plain description", () => {
    expect(cleanDescription("<p>Sadə mətn</p><p></p><p>ikinci abzas</p>")).toEqual({ html: null, text: "Sadə mətn\n\nikinci abzas" })
    expect(cleanDescription("<p></p>")).toEqual({ html: null, text: "" })
    expect(cleanDescription("<p><strong>  </strong></p>")).toEqual({ html: null, text: "" })
    expect(cleanDescription(null)).toEqual({ html: null, text: "" })
  })

  it("carries nothing but the eight tags: no script, no handler, no link, no style, no attribute", () => {
    const stored = cleanDescription('<p onclick="x()" style="color:red" class="a">Salam <strong onmouseover="x()">dünya</strong><script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">link</a><iframe src="https://e.com"></iframe></p><h1>Başlıq</h1>')
    expect(stored.html).toBe("<p>Salam <strong>dünya</strong>link</p>Başlıq")
    expect(stored.html).not.toMatch(/on\w+=|script|javascript|img|iframe|href|style|class/u)
    expect(stored.text).toBe("Salam dünyalink\nBaşlıq")
  })

  it("what a paste from Word carries becomes the two tags that are kept", () => {
    expect(cleanDescription("<p><b>qalın</b> və <i>kursiv</i></p>").html).toBe("<p><strong>qalın</strong> və <em>kursiv</em></p>")
  })

  it("an angle bracket typed as text stays text in both columns", () => {
    const stored = cleanDescription("<p><strong>a &lt; b &amp; c &gt; d</strong> &quot;e&quot;&nbsp;f</p>")
    expect(stored.text).toBe('a < b & c > d "e" f')
    expect(stored.html).toContain("a &lt; b &amp; c &gt; d")
  })

  it("a line break and a nested list read as lines", () => {
    expect(descriptionTextOf("<p>bir<br>iki</p><ul><li><p>ana</p><ul><li><p>alt</p></li></ul></li><li><p>ikinci</p></li></ul>")).toBe("bir\niki\n• ana\n  • alt\n• ikinci")
  })
})

describe("a plain description opened in the editor", () => {
  it("comes back as the very same text when nothing is formatted", () => {
    for (const text of ["", "bir sətir", "Ölçülər:\n1. 167 x 88\n2. 122 x 88", "a\n\n\nb", "x < y & z > w", "  girintili sətir"]) {
      expect(descriptionTextOf(plainToDescriptionHtml(text))).toBe(text.replace(/\s+$/u, ""))
      expect(hasFormatting(plainToDescriptionHtml(text))).toBe(false)
    }
  })

  it("cannot become markup: what was typed as text is escaped", () => {
    expect(plainToDescriptionHtml("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")
    expect(plainToDescriptionHtml(null)).toBe("<p></p>")
  })
})
