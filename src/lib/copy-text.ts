/**
 * Puts a text on the clipboard: the Clipboard API first, then the long-
 * established read-only textarea for browsers that refuse it — an insecure
 * context, an embedded view, a press whose activation was spent on a request.
 *
 * Answers whether it worked, and never throws: the caller says a failure in
 * its own words, next to the thing that was to be copied.
 */
export async function copyTextWithFallback(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Continue with the DOM fallback below.
    }
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}
