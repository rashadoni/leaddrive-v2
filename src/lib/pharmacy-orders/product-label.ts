/**
 * A 1C catalog label as people read it. The Azerbaijani names in Zeytun's
 * feed carry the feed's own markers — "Ketonal 2 ml № 10  /*qutu/*  \*LEK
 * ,Sloveniya\*" — which become "(qutu) (LEK, Sloveniya)". Only the drawing
 * changes: the stored label stays as 1C sent it.
 */
export function readableProductName(label: string): string {
  return label
    .replace(/\/\*\s*([^/*]*?)\s*\/\*/g, "($1)")
    .replace(/\\\*\s*([^\\*]*?)\s*\\\*/g, "($1)")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim()
}
