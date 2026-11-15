/**
 * What a task's file may be — one list for the server that stores it
 * (task-file-store.ts) and the browser that sends it (task-file-upload.ts), so
 * a folder dropped on a card is sorted before a byte leaves the computer.
 * No Node imports here: the card imports this module.
 */

/**
 * The most a task file may weigh. Owner, 2026-11-12: videos and design files
 * up to 100 MB («Да, разрешить») — Bordio's reels, brand books and CorelDraw
 * sources were left behind at 10 MB.
 */
export const MAX_TASK_FILE_SIZE = 100 * 1024 * 1024

/**
 * One request of a card upload carries at most this much. Its body crosses
 * Cloudflare (100 MB), nginx (20 MB) and the Next proxy (10 MB — beyond it the
 * route got a cut body, and Nazrin's promo video answered «server error»,
 * 2026-11-15), so a bigger file goes in parts of 8 MB.
 */
export const TASK_FILE_PART_SIZE = 8 * 1024 * 1024

/** How many parts the largest file takes. */
export const MAX_TASK_FILE_PARTS = Math.ceil(MAX_TASK_FILE_SIZE / TASK_FILE_PART_SIZE)

export const TASK_FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  // Bordio moved over (2026-11-07): presentations, voice notes and Outlook
  // messages were attached to the tasks in work and were refused here.
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "audio/ogg",
  "application/vnd.ms-outlook",
  // Owner, 2026-11-12: the marketing team's videos and design sources.
  "video/mp4",
  "video/quicktime",
  "application/zip",
  "application/vnd.corel-draw",
  "image/vnd.adobe.photoshop",
  "application/rtf",
  "message/rfc822",
  // Nazrin, 2026-11-15: a brand's logo and promo folder — Illustrator and EPS
  // sources, print TIFFs, RAR archives (.rar was listed, but no type let it in).
  // SVG stays out: an SVG can carry script (uploads/[...path] serves old ones sandboxed).
  "application/illustrator",
  "application/postscript",
  "image/tiff",
  "application/vnd.rar",
]

// Extension whitelist — defends even if the client-supplied MIME is spoofed.
export const TASK_FILE_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".csv", ".zip", ".rar",
  ".ogg", ".msg",
  ".mp4", ".mov", ".cdr", ".psd", ".rtf", ".eml",
  ".ai", ".eps", ".tif", ".tiff",
])

/** The type a file name stands for, among the allowed ones. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".ogg": "audio/ogg",
  ".msg": "application/vnd.ms-outlook",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".cdr": "application/vnd.corel-draw",
  ".psd": "image/vnd.adobe.photoshop",
  ".rtf": "application/rtf",
  ".eml": "message/rfc822",
  ".ai": "application/illustrator",
  ".eps": "application/postscript",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
}

/** «.png» of «Banner/AZ.PNG»; "" when the last part of the name has no dot. */
export function taskFileExtension(name: string): string {
  const base = name.split(/[\\/]/u).pop() ?? ""
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot).toLowerCase() : ""
}

/** The type a file name stands for, among the allowed ones; null when none. */
export function taskFileTypeOf(name: string): string | null {
  return TYPE_BY_EXTENSION[taskFileExtension(name)] ?? null
}

/**
 * The type a file is stored as: the browser's word when it is one we take, else
 * the one its name stands for. A browser names no type for a CorelDraw file and
 * «octet-stream» for some photos (the bytes are checked on the server anyway).
 */
export function taskFileStoredType(name: string, given: string | null | undefined): string | null {
  const said = (given ?? "").toLowerCase().trim()
  if (TASK_FILE_TYPES.includes(said)) return said
  return taskFileTypeOf(name)
}

/**
 * What a computer leaves in every folder and nobody means to send: Finder's
 * `.DS_Store` and `._` twins, Windows' `Thumbs.db` and `desktop.ini`, Office's
 * `~$` lock files. A dropped folder skips them without a word.
 */
export function isSystemJunkFile(name: string): boolean {
  const base = (name.split(/[\\/]/u).pop() ?? "").trim()
  const lower = base.toLowerCase()
  return lower === ".ds_store" || lower === "thumbs.db" || lower === "desktop.ini" || lower === ".localized"
    || base.startsWith("._") || base.startsWith("~$")
}
