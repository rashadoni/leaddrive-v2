/**
 * What kind of file this is, from its name (then its MIME type) — for the mark
 * a task's file carries.
 *
 * Zeytun, 2026-11-23, Xəyalə: «burda excel faylı əlavə edilib, mən görməmişəm,
 * faylların görünüşü eyni olduğu üçün»; Nazrin: «hər program öz loqosuna görə
 * çıxsa problem olmaz». Every file of a card wore the same paperclip, and an
 * Excel sheet was lost among eighteen visuals.
 */
export type FileKind = "excel" | "word" | "powerpoint" | "pdf" | "image" | "video" | "audio" | "design" | "archive" | "other"

const KINDS: Record<Exclude<FileKind, "other">, readonly string[]> = {
  excel: ["xls", "xlsx", "xlsm", "xlsb", "csv", "ods"],
  word: ["doc", "docx", "rtf", "odt"],
  powerpoint: ["ppt", "pptx", "pps", "ppsx", "odp"],
  pdf: ["pdf"],
  image: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif", "svg", "tif", "tiff"],
  video: ["mp4", "mov", "avi", "mkv", "webm", "m4v"],
  audio: ["mp3", "ogg", "oga", "opus", "wav", "m4a", "aac"],
  design: ["cdr", "ai", "eps", "psd", "indd", "fig", "sketch"],
  archive: ["zip", "rar", "7z", "tar", "gz"],
}
const KIND_OF_EXTENSION = new Map<string, FileKind>(
  Object.entries(KINDS).flatMap(([kind, extensions]) => extensions.map((extension) => [extension, kind as FileKind] as const)),
)
// One word per program, whichever of its versions the file was saved in.
const LABELS: Record<string, string> = {
  xlsx: "XLS", xlsm: "XLS", xlsb: "XLS", docx: "DOC", pptx: "PPT", pps: "PPT", ppsx: "PPT", jpeg: "JPG", tiff: "TIF", heif: "HEIC", oga: "OGG", indd: "INDD",
}
const KIND_LABEL: Record<FileKind, string> = {
  excel: "XLS", word: "DOC", powerpoint: "PPT", pdf: "PDF", image: "IMG", video: "VID", audio: "AUD", design: "DSN", archive: "ZIP", other: "FILE",
}

function kindOfMime(mimeType: string): FileKind {
  const mime = mimeType.toLowerCase()
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime === "application/pdf") return "pdf"
  if (mime.includes("spreadsheet") || mime.includes("ms-excel") || mime === "text/csv") return "excel"
  if (mime.includes("presentation") || mime.includes("ms-powerpoint")) return "powerpoint"
  if (mime.includes("wordprocessing") || mime === "application/msword" || mime === "application/rtf") return "word"
  if (mime.includes("zip") || mime.includes("rar") || mime.includes("7z")) return "archive"
  return "other"
}

export function fileKindOf(name: string, mimeType?: string | null): { kind: FileKind; label: string } {
  const extension = /\.([a-z0-9]{1,6})$/iu.exec(name.trim())?.[1]?.toLowerCase()
  const known = extension ? KIND_OF_EXTENSION.get(extension) : undefined
  if (known && extension) return { kind: known, label: LABELS[extension] ?? extension.toUpperCase() }
  const kind = mimeType ? kindOfMime(mimeType) : "other"
  if (kind !== "other") return { kind, label: KIND_LABEL[kind] }
  // A kind we have no colour for still says what it is, when that fits the mark.
  return { kind, label: extension && extension.length <= 4 ? extension.toUpperCase() : KIND_LABEL.other }
}
