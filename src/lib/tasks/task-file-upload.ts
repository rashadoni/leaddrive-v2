import {
  MAX_TASK_FILE_SIZE,
  TASK_FILE_EXTENSIONS,
  TASK_FILE_PART_SIZE,
  isSystemJunkFile,
  taskFileExtension,
  taskFileStoredType,
} from "@/lib/tasks/task-file-rules"

/**
 * Sending files to a task from the card (Nazrin, 2026-11-15: «papka yükləmək
 * olsa daha rahat olar… bir dəfəyə bir neçə sənəd yükləyə bilək»). Many at
 * once, a whole folder, or dropped on the card; each goes in parts of 8 MB to
 * POST /api/v1/tasks/[id]/files/parts, so a promo video of up to 100 MB gets
 * through the proxies that cut one request at 10 MB.
 *
 * A file the task would refuse (too big, a type it does not take) is named
 * back without being sent; what a computer leaves in every folder
 * (`.DS_Store`, `Thumbs.db`) is left out without a word.
 */

export type TaskFileToSend = { file: File; name: string }

export type TaskFileRefusal = "too_big" | "type" | "empty" | "server" | "network"

export type TaskFileFailure = { name: string; refusal: TaskFileRefusal; message?: string }

export type TaskFilesProgress = {
  /** Files finished, sent or refused. */
  doneFiles: number
  totalFiles: number
  sentBytes: number
  totalBytes: number
  current: string
}

/**
 * The name a file of a folder is kept under: its place inside the folder,
 * «Banner/az.png» of «Promo/Banner/az.png» — the folder itself is the task's,
 * while two «az.png» of «Banner» and «Story» stay apart.
 */
export function nameInFolder(relativePath: string, fallback: string): string {
  const parts = relativePath.split("/").filter(Boolean)
  return parts.length > 1 ? parts.slice(1).join("/") : fallback
}

/** What a picker gave: plain files by their names, a folder's by their place in it. */
export function filesFromPicker(list: FileList | readonly File[] | null | undefined): TaskFileToSend[] {
  return [...(list ?? [])].map((file) => ({ file, name: nameInFolder(file.webkitRelativePath ?? "", file.name) }))
}

type Entry = {
  name: string
  isFile: boolean
  isDirectory: boolean
  file?: (ok: (file: File) => void, fail: (error: unknown) => void) => void
  createReader?: () => { readEntries: (ok: (entries: Entry[]) => void, fail: (error: unknown) => void) => void }
}

async function walk(entry: Entry, prefix: string, out: TaskFileToSend[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) => entry.file!(resolve, () => resolve(null)))
    if (file) out.push({ file, name: prefix ? `${prefix}/${file.name}` : file.name })
    return
  }
  if (!entry.isDirectory || !entry.createReader) return
  const reader = entry.createReader()
  const children: Entry[] = []
  // A folder hands its entries over in batches (Chrome: 100) until an empty one.
  for (;;) {
    const batch = await new Promise<Entry[]>((resolve) => reader.readEntries(resolve, () => resolve([])))
    if (batch.length === 0) break
    children.push(...batch)
  }
  for (const child of children) {
    await walk(child, child.isDirectory ? (prefix ? `${prefix}/${child.name}` : child.name) : prefix, out)
  }
}

/**
 * What was dropped on the card: files as they are, folders opened all the way
 * down. One dropped folder gives its files by their place inside it; when
 * several folders are dropped together, each keeps its own name in front.
 */
export async function filesFromDrop(data: DataTransfer): Promise<TaskFileToSend[]> {
  const entries = [...(data.items ?? [])]
    .map((item) => (item.kind === "file" ? ((item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null) : null))
    .filter((entry): entry is Entry => entry !== null)
  if (entries.length === 0) return [...(data.files ?? [])].map((file) => ({ file, name: file.name }))
  const keepFolderName = entries.filter((entry) => entry.isDirectory).length > 1
  const out: TaskFileToSend[] = []
  for (const entry of entries) await walk(entry, entry.isDirectory && keepFolderName ? entry.name : "", out)
  return out
}

/** Why the task would refuse this file, or null when it takes it. */
export function taskFileRefusal(file: { size: number; type: string }, name: string): TaskFileRefusal | null {
  if (file.size === 0) return "empty"
  if (file.size > MAX_TASK_FILE_SIZE) return "too_big"
  const ext = taskFileExtension(name)
  if (!ext || !TASK_FILE_EXTENSIONS.has(ext) || !taskFileStoredType(name, file.type)) return "type"
  return null
}

function newUploadId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Sends one file, part after part; `onSent` hears each part's bytes as it lands. */
export async function sendTaskFile(
  taskId: string,
  item: TaskFileToSend,
  onSent?: (bytes: number) => void,
): Promise<{ ok: true } | { ok: false; refusal: TaskFileRefusal; message?: string }> {
  const refusal = taskFileRefusal(item.file, item.name)
  if (refusal) return { ok: false, refusal }
  const size = item.file.size
  const count = Math.ceil(size / TASK_FILE_PART_SIZE)
  const upload = newUploadId()
  for (let index = 0; index < count; index += 1) {
    const part = item.file.slice(index * TASK_FILE_PART_SIZE, Math.min(size, (index + 1) * TASK_FILE_PART_SIZE))
    const query = new URLSearchParams({
      upload, index: String(index), count: String(count), size: String(size), name: item.name, type: item.file.type,
    })
    let res: Response | null = null
    // A dropped connection or a server restart mid-folder costs one more try, not the file.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await pause(1500 * attempt)
      res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/files/parts?${query}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream" },
        body: part,
      }).catch(() => null)
      if (res && res.status < 500 && res.status !== 429) break
    }
    if (!res) return { ok: false, refusal: "network" }
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string; refusal?: string } | null
      const said = json?.refusal === "too_big" || json?.refusal === "type" ? json.refusal : "server"
      return { ok: false, refusal: said, message: json?.error }
    }
    onSent?.(part.size)
  }
  return { ok: true }
}

/**
 * Sends files one after another, in the order a person reads them
 * («2.png» before «10.png»). `onFileDone` hears each file that reached the task.
 */
export async function sendTaskFiles(
  taskId: string,
  items: readonly TaskFileToSend[],
  handlers: { onProgress?: (progress: TaskFilesProgress) => void; onFileDone?: (name: string) => void } = {},
): Promise<{ added: string[]; failed: TaskFileFailure[] }> {
  const wanted = items
    .filter((item) => !isSystemJunkFile(item.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
  const totalBytes = wanted.reduce((sum, item) => sum + (taskFileRefusal(item.file, item.name) ? 0 : item.file.size), 0)
  const progress: TaskFilesProgress = { doneFiles: 0, totalFiles: wanted.length, sentBytes: 0, totalBytes, current: "" }
  const added: string[] = []
  const failed: TaskFileFailure[] = []
  for (const item of wanted) {
    progress.current = item.name
    handlers.onProgress?.({ ...progress })
    const before = progress.sentBytes
    const result = await sendTaskFile(taskId, item, (bytes) => {
      progress.sentBytes += bytes
      handlers.onProgress?.({ ...progress })
    })
    if (result.ok) {
      added.push(item.name)
      handlers.onFileDone?.(item.name)
    } else {
      failed.push({ name: item.name, refusal: result.refusal, message: result.message })
      // What a failed file had sent no longer counts; what it would have sent leaves the total.
      progress.totalBytes -= taskFileRefusal(item.file, item.name) ? 0 : item.file.size
      progress.sentBytes = before
    }
    progress.doneFiles += 1
    handlers.onProgress?.({ ...progress })
  }
  return { added, failed }
}
