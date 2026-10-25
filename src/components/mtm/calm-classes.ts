/*
 * MTM colours (owner-approved mockup, 2026-10-18: «не слишком ли много
 * заливок, и цветовая схема, и меню внутри блоков»). One menu at the top of
 * the module; inside a page, tabs are dark text over an orange line, and in a
 * row of filter chips the chosen one is outlined dark. The orange fill stays
 * for the page's one main button, so none of these ever fills.
 */

/** The row a page's tabs stand on: one grey rule, the chosen tab draws its own line over it. */
export const MTM_TAB_ROW = "flex min-w-0 flex-wrap gap-1 border-b border-border"

/** A tab inside a page (a ghost Button or a plain button). */
export function mtmTabClass(active: boolean): string {
  return `-mb-px min-h-10 whitespace-nowrap rounded-none border-b-2 px-3 hover:bg-transparent ${active ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`
}

/**
 * A filter chip (an outline Button or a bordered button). `tone` is the text
 * colour of a status chip — its status said by the colour of its words.
 */
export function mtmChipClass(active: boolean, tone?: string): string {
  const state = active ? "border-foreground font-semibold" : ""
  const text = tone ?? (active ? "text-foreground" : "text-muted-foreground")
  return `${state} ${text}`.trim()
}
