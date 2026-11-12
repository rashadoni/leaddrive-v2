/**
 * Files in a task's messages, as in Bordio's chat (Zeytun's first day in the
 * CRM, 2026-11-12: «Burda elave etdiyim sekilleri gore bilmirem», «fayl elave
 * etmek … mumkun deyil»).
 *
 * A message names its files on its last line — «📎 a.jpg, b.pdf» — the way the
 * import from Bordio already wrote them, and the way the message box writes
 * them now. The files themselves are the task's attachments: the card shows a
 * named file in the message (a picture as a picture), matched by its name.
 */
export interface MessageFile { id: string; fileName: string; originalName: string; mimeType?: string | null }

const MARK = "📎 "

/** The text of a message without its file line, and the file names on it. */
export function splitMessageFiles(text: string): { body: string; names: string[] } {
  const lines = text.split("\n")
  const last = lines[lines.length - 1] ?? ""
  if (!last.startsWith(MARK)) return { body: text, names: [] }
  const names = last.slice(MARK.length).split(", ").map((name) => name.trim()).filter(Boolean)
  return { body: lines.slice(0, -1).join("\n").trimEnd(), names }
}

/** The message text with its files named on the last line. */
export function joinMessageFiles(body: string, names: readonly string[]): string {
  const text = body.trim()
  if (names.length === 0) return text
  return `${text ? `${text}\n` : ""}${MARK}${names.join(", ")}`
}

// Same name whatever the case and Unicode form — «İ» lower-cased by a browser is «i» + a dot.
const key = (name: string) => name.normalize("NFD").replace(/\u0307/gu, "").trim().toLowerCase()

/**
 * Each named file with the attachment it is, or null when the task has no file
 * of that name (a file of a finished Bordio task that was not carried over).
 * Two names alike take two different attachments, newest first.
 */
export function matchMessageFiles(names: readonly string[], files: readonly MessageFile[]): Array<{ name: string; file: MessageFile | null }> {
  const used = new Set<string>()
  return names.map((name) => {
    const file = files.find((candidate) => !used.has(candidate.id) && key(candidate.originalName) === key(name)) ?? null
    if (file) used.add(file.id)
    return { name, file }
  })
}

/**
 * The files of every message of a task, each file shown in ONE message only
 * (Xayala, 2026-11-12: «2 fayl yüklədim, 3 fayl görünür» — she removed a
 * picture and added it again under the same name, and the older message,
 * whose own file was gone, showed the new one too). The newest message takes
 * the newest file of a name; an older message naming a file no longer there
 * shows just its name. `messages` in time order, `files` newest first.
 */
export function assignMessageFiles(
  messages: readonly { id: string; text: string }[],
  files: readonly MessageFile[],
): Map<string, Array<{ name: string; file: MessageFile | null }>> {
  const used = new Set<string>()
  const out = new Map<string, Array<{ name: string; file: MessageFile | null }>>()
  for (const message of [...messages].reverse()) {
    const { names } = splitMessageFiles(message.text)
    if (names.length === 0) continue
    out.set(message.id, names.map((name) => {
      const file = files.find((candidate) => !used.has(candidate.id) && key(candidate.originalName) === key(name)) ?? null
      if (file) used.add(file.id)
      return { name, file }
    }))
  }
  return out
}

export function isImageFile(file: MessageFile): boolean {
  if (file.mimeType) return file.mimeType.startsWith("image/")
  return /\.(png|jpe?g|gif|webp)$/iu.test(file.originalName)
}

export function fileUrl(file: MessageFile): string {
  return `/uploads/tasks/${file.fileName}`
}
