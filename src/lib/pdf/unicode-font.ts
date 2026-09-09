import type { jsPDF } from "jspdf"
import { DEJAVU_SANS_REGULAR_B64 } from "./fonts/dejavu-sans"
import { DEJAVU_SANS_BOLD_B64 } from "./fonts/dejavu-sans-bold"

/**
 * Font family registered by {@link registerUnicodeFont}. Pass this to every
 * `doc.setFont(...)` call instead of "helvetica".
 */
export const PDF_FONT = "DejaVuSans"

/**
 * Register DejaVu Sans (regular + bold) — a Unicode TTF that covers the
 * Azerbaijani Latin Extended glyphs (ə U+0259, İ U+0130, ş U+015F, ğ U+011F,
 * etc.) as well as Cyrillic — on a jsPDF document, and return the font family
 * name to use.
 *
 * Why: jsPDF's built-in Helvetica/Times/Courier only embed WinAnsi/Latin-1, so
 * Azerbaijani text renders as garbage ("Məsuliyyət" → "MYsuliyyYt"). Call this
 * once right after `new jsPDF(...)` and use {@link PDF_FONT} in every setFont().
 */
export function registerUnicodeFont(doc: jsPDF): string {
  doc.addFileToVFS("DejaVuSans.ttf", DEJAVU_SANS_REGULAR_B64)
  doc.addFont("DejaVuSans.ttf", PDF_FONT, "normal")
  doc.addFileToVFS("DejaVuSans-Bold.ttf", DEJAVU_SANS_BOLD_B64)
  doc.addFont("DejaVuSans-Bold.ttf", PDF_FONT, "bold")
  doc.setFont(PDF_FONT, "normal")
  return PDF_FONT
}
