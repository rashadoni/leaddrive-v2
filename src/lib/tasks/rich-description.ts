/**
 * A task's description with formatting — bold, italic, underline, numbered and
 * bulleted lists (Ulviyya, Zeytun, 2026-11-13: «в тасках включите функцию
 * жирный шрифт как в бордио»; mockup → owner: «Да, делай»).
 *
 * Two columns, one text. `description` stays what it always was — plain text —
 * because everything else reads it: search, the board's card, exports, AI
 * tools, «split the list into subtasks». `descriptionHtml` holds the same text
 * with its formatting and is NULL while there is none. The plain text is
 * always DERIVED from the HTML (here), never sent beside it and trusted.
 *
 * This file is shared by the server and the editor in the browser, so it has
 * no dependencies; the HTML is cleaned in rich-description-server.ts.
 */

/** The only tags a description may carry — none of them takes an attribute. */
export const DESCRIPTION_TAGS = ["p", "br", "strong", "em", "u", "ul", "ol", "li"] as const

/** Longest description, as plain text. Bordio's own longest in Zeytun is ~9 000 characters. */
export const MAX_DESCRIPTION_TEXT = 50_000
/** Longest HTML accepted: the text plus its tags. */
export const MAX_DESCRIPTION_HTML = 200_000

const TAG = /<(\/?)(p|br|strong|em|u|ul|ol|li)\s*\/?>/giu
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, body: string) => {
    if (body[0] !== "#") return ENTITIES[body.toLowerCase()] ?? whole
    const code = body[1].toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

const escape = (text: string) => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")

/** Whether the HTML carries anything plain text could not: without it the text is stored plain. */
export function hasFormatting(html: string): boolean {
  return /<(strong|em|u|ul|ol|li)>/iu.test(html)
}

/**
 * The plain text of a cleaned description. A paragraph is a line; an item of a
 * numbered list is «1. text», of a bulleted one «• text» — the shapes
 * list-lines.ts reads, so a list made with the buttons still becomes subtasks.
 */
export function descriptionTextOf(html: string): string {
  const lines: string[] = []
  const lists: Array<{ ordered: boolean; n: number }> = []
  let line: string | null = null
  const end = () => { if (line !== null) { lines.push(line); line = null } }
  const add = (raw: string) => {
    if (!raw) return
    // Whitespace between two blocks is the markup's own, not the text's.
    if (line === null && !raw.trim()) return
    line = (line ?? "") + decode(raw)
  }
  let from = 0
  for (const match of html.matchAll(TAG)) {
    add(html.slice(from, match.index))
    from = match.index + match[0].length
    const closing = match[1] === "/"
    const tag = match[2].toLowerCase()
    if (tag === "br") { lines.push(line ?? ""); line = ""; continue }
    if (tag === "ul" || tag === "ol") {
      end()
      if (closing) lists.pop()
      else lists.push({ ordered: tag === "ol", n: 0 })
      continue
    }
    if (tag === "li") {
      end()
      if (closing) continue
      const list = lists[lists.length - 1]
      const indent = "  ".repeat(Math.max(0, lists.length - 1))
      if (list) list.n += 1
      line = `${indent}${list?.ordered ? `${list.n}. ` : "• "}`
      continue
    }
    if (tag === "p") {
      // A paragraph inside an item continues the item's own line.
      if (closing) end()
      else if (line === null) line = ""
    }
    // strong / em / u change how the text looks, not what it says.
  }
  add(html.slice(from))
  end()
  return lines.join("\n").replace(/\s+$/u, "")
}

/** A plain description as the editor's content: a line is a paragraph, an empty line an empty one. */
export function plainToDescriptionHtml(text: string | null | undefined): string {
  if (!text) return "<p></p>"
  return text.split(/\r?\n/u).map((line) => `<p>${escape(line)}</p>`).join("")
}
