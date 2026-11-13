/**
 * Cleaning a formatted description before it is stored (rich-description.ts
 * says why there are two columns). Server only: the browser sends HTML, and
 * nothing in it is believed.
 */
import DOMPurify from "isomorphic-dompurify"
import { DESCRIPTION_TAGS, descriptionTextOf, hasFormatting } from "@/lib/tasks/rich-description"

/**
 * What is stored for an edit of the formatted description: the plain text every
 * reader uses, and the HTML — or null when the text carries no formatting, so
 * a description that was only retyped stays an ordinary plain one.
 */
export function cleanDescription(input: string | null): { html: string | null; text: string } {
  if (!input) return { html: null, text: "" }
  const cleaned = DOMPurify.sanitize(input, {
    // `b` and `i` are what a paste from Word or a browser carries; they are kept as the two tags below.
    ALLOWED_TAGS: [...DESCRIPTION_TAGS, "b", "i"],
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true,
  })
    .replace(/<(\/?)b>/giu, "<$1strong>")
    .replace(/<(\/?)i>/giu, "<$1em>")
  const text = descriptionTextOf(cleaned)
  return { html: text && hasFormatting(cleaned) ? cleaned : null, text }
}
