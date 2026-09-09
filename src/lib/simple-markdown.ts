/**
 * Lightweight markdown → HTML for LLM/assistant text (Da Vinci replies, AI
 * observations, …). NOT a full markdown engine — handles exactly what our models
 * emit: `**bold**`, `` `code` ``, `### `/`## ` headings, `- `/`* ` bullet lists,
 * blank-line spacing.
 *
 * ALWAYS pass the result through `sanitizeRichHtml` before
 * `dangerouslySetInnerHTML` — the inline-text branches escape, but sanitize is
 * the real XSS boundary. NOTE: `sanitizeRichHtml` strips the `class` attribute,
 * so the Tailwind classes emitted below are inert — the CONSUMER must style the
 * emitted tags (h3/h4/ul/li/strong/code), e.g. via `prose` (ai-observations) or
 * `[&_ul]:list-disc …` descendant selectors (ai-assistant-panel). The classes
 * are kept as structural intent + for any future class-allowing sanitizer.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// A markdown table block: a `| h | h |` header row, a `|---|---|` separator,
// then body rows. Models emit these for tabular answers (e.g. ticket lists).
const isTableRow = (s: string) => /^\|.*\|$/.test(s)
const isTableSep = (s: string) => /^\|[\s:|-]+\|$/.test(s) && s.includes("-")
const splitCells = (row: string) =>
  row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())

export function markdownToHtml(text: string): string {
  const lines = text.split("\n")
  let html = ""
  let inList = false
  const closeList = () => { if (inList) { html += "</ul>"; inList = false } }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Table — header + separator + body rows → real <table>
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSep(lines[i + 1].trim())) {
      closeList()
      html += "<table><thead><tr>"
      for (const h of splitCells(trimmed)) html += `<th>${escapeHtml(h)}</th>`
      html += "</tr></thead><tbody>"
      i += 2 // skip header + separator
      while (i < lines.length && isTableRow(lines[i].trim())) {
        html += "<tr>"
        for (const c of splitCells(lines[i].trim())) html += `<td>${escapeHtml(c)}</td>`
        html += "</tr>"
        i++
      }
      html += "</tbody></table>"
      i-- // the for-loop's i++ re-lands on the first non-table line
    } else if (trimmed.startsWith("### ")) {
      closeList()
      html += `<h4 class="font-semibold text-sm mt-3 mb-1">${escapeHtml(trimmed.slice(4))}</h4>`
    } else if (trimmed.startsWith("## ")) {
      closeList()
      html += `<h3 class="font-bold text-base mt-4 mb-2">${escapeHtml(trimmed.slice(3))}</h3>`
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) { html += '<ul class="list-disc pl-5 space-y-1">'; inList = true }
      html += `<li class="text-sm">${escapeHtml(trimmed.slice(2))}</li>`
    } else if (trimmed === "") {
      closeList()
      html += "<br/>"
    } else {
      closeList()
      html += `<p class="text-sm mb-1">${escapeHtml(trimmed)}</p>`
    }
  }

  if (inList) html += "</ul>"

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs">$1</code>')

  return html
}
