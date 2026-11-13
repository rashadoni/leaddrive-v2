/**
 * The name a task's file is saved under.
 *
 * On disk a file has a random name (`63b9b4adef53…png`), and that was the name
 * a browser offered on «Save as»: Zeytun's designers name a visual by its date
 * and its order in the post («13.11.2026-Qan-şəkəri-4.png»), and the person
 * publishing it got nine files called by hashes (Güllü, 2026-11-13).
 *
 * The name comes from the attachment's own row, never from the request, so a
 * link cannot make the server announce a name of the caller's choosing.
 */

const MAX_NAME = 180

/** The original name made safe for a header and a disk, ending in the stored file's own extension. */
export function announcedFileName(originalName: string | null | undefined, storedName: string): string {
  const storedExt = extensionOf(storedName)
  const cleaned = (originalName ?? "")
    .normalize("NFC")
    // Control characters, path separators and what Windows refuses in a file name.
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[.\s]+/u, "")
    .trim()
  if (!cleaned) return storedName
  // The bytes are served as the stored extension's type; the name must not claim another one.
  const base = extensionOf(cleaned) === storedExt ? cleaned.slice(0, cleaned.length - storedExt.length - 1) : cleaned
  const room = MAX_NAME - (storedExt ? storedExt.length + 1 : 0)
  const trimmed = [...base].slice(0, room).join("").trim() || "file"
  return storedExt ? `${trimmed}.${storedExt}` : trimmed
}

/**
 * `Content-Disposition` carrying a name in any alphabet: a plain-ASCII
 * fallback for old clients and the exact name in RFC 5987 form. A header value
 * must be Latin-1, so «şəkəri» cannot go into `filename="…"` as it is.
 */
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ə/gu, "e").replace(/Ə/gu, "E").replace(/ı/gu, "i")
    .replace(/[^\x20-\x7e]/gu, "_")
    .replace(/["\\]/gu, "_")
  const exact = encodeURIComponent(name).replace(/['()*]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${exact}`
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ""
}
