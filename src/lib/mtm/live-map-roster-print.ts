import type { RosterExportTable } from "@/lib/mtm/live-map-roster-export"

/**
 * The live map's list on paper («Печать» beside «Excel»).
 *
 * The page itself cannot be printed: the dashboard's frame is one screen high
 * and clips what does not fit, so a list of a hundred people would come out as
 * the sidebar, the header and the first screen of rows. The list is written
 * as a small document of its own instead and printed from a frame nobody sees.
 *
 * The table is the Excel one (`rosterExportTable`): the rows left by the
 * dispatcher's filters, in his order, with every column the list has — so the
 * sheet and the file cannot disagree.
 *
 * The document is static on purpose — one inline <style>, no script, nothing
 * fetched. The application's content policy lets an inline style through and
 * blocks every script inside the frame, which is why the page that made the
 * frame calls print(), never the document.
 */

/** Up to this many columns fit an upright sheet; a wider list is printed across it. */
const UPRIGHT_SHEET_COLUMNS = 6
/** The mark the frame carries: the next print finds a frame left behind by it. */
const PRINT_FRAME_TEST_ID = "live-map-roster-print-frame"

// Names, teams and titles are typed by people: every one of them is text, never markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function printCss(columns: number): string {
  return [
    // Ten columns on an upright A4 get about 18 mm each — too little for a
    // cell like the signal's, which is a date, a time and a word.
    `@page { size: A4 ${columns > UPRIGHT_SHEET_COLUMNS ? "landscape" : "portrait"}; margin: 12mm; }`,
    "html { background: #fff; color: #000; }",
    "body { margin: 0; font: 9pt/1.3 system-ui, Arial, sans-serif; }",
    "h1 { margin: 0 0 2pt; font-size: 12pt; }",
    "p { margin: 0 0 6pt; }",
    "table { width: 100%; border-collapse: collapse; }",
    // The heading row again at the top of every sheet.
    "thead { display: table-header-group; }",
    // A person's row is not split between two sheets.
    "tr { break-inside: avoid; page-break-inside: avoid; }",
    "th, td { border: 1px solid #999; padding: 2px 4px; text-align: left; vertical-align: top; }",
    // A heading is never cut in the middle of a word, so no column gets
    // narrower than its heading's longest word.
    "th { font-weight: 600; }",
    // A value wraps inside its cell — in the middle of a word if it must —
    // rather than pushing the table past the edge of the sheet, where the
    // printer would cut it off.
    "td { overflow-wrap: anywhere; }",
  ].join("\n")
}

/**
 * The list as a document to print: a heading, a line under it («12 из 40»)
 * and the table.
 *
 * Pure: no React, no document. The words come from the caller.
 */
export function rosterPrintHtml(input: {
  /** The language of the words, for the browser's hyphenation and a screen reader. */
  lang: string
  /** «Живая карта · 9 окт. 2026 г., 14:21» — the heading, and the document's own title. */
  title: string
  /** What part of the team the sheet holds; nothing is printed for an empty line. */
  subtitle: string
  table: RosterExportTable
}): string {
  const { table } = input
  const title = escapeHtml(input.title)
  const subtitle = input.subtitle.trim()
  const headers = table.headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")
  const rows = table.rows
    .map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`)
    .join("\n")
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(input.lang)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    `<style>\n${printCss(table.headers.length)}\n</style>`,
    "</head>",
    "<body>",
    `<h1>${title}</h1>`,
    subtitle ? `<p>${escapeHtml(subtitle)}</p>` : "",
    "<table>",
    `<thead><tr>${headers}</tr></thead>`,
    `<tbody>\n${rows}\n</tbody>`,
    "</table>",
    "</body>",
    "</html>",
  ].filter(Boolean).join("\n")
}

/**
 * Sends the document to the browser's print dialog without leaving the map.
 *
 * It is loaded into a frame of no size and printed from there: the dispatcher
 * keeps his map, his filters and his selection, and no second tab is left
 * open behind the dialog. The frame goes away when the dialog closes; one
 * left over (the dialog never reported closing) is replaced by the next print.
 */
export function printRosterHtml(html: string): void {
  if (typeof document === "undefined") return
  document.querySelector(`iframe[data-testid="${PRINT_FRAME_TEST_ID}"]`)?.remove()

  const frame = document.createElement("iframe")
  frame.setAttribute("data-testid", PRINT_FRAME_TEST_ID)
  frame.setAttribute("aria-hidden", "true")
  frame.tabIndex = -1
  // Out of sight by its size, not by display:none, which some browsers print
  // as an empty sheet. No sandbox either — it would forbid print().
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"
  // Where the keyboard was — the «Печать» button. Some browsers print the
  // page around a frame unless the frame has the focus, so it is given the
  // focus for the dialog and the button gets it back when the dialog closes.
  const pressed = document.activeElement instanceof HTMLElement ? document.activeElement : null
  frame.addEventListener("load", () => {
    const view = frame.contentWindow
    if (!view) return
    view.addEventListener("afterprint", () => {
      frame.remove()
      pressed?.focus()
    }, { once: true })
    view.focus()
    view.print()
  }, { once: true })
  frame.srcdoc = html
  document.body.appendChild(frame)
}
