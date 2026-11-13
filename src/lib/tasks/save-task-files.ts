"use client"

/**
 * Saving several of a task's files at one press, each under its author's name
 * (Güllü, Zeytun, 2026-11-13: nine visuals of one post were nine clicks, nine
 * new tabs and nine files named by hashes).
 *
 * One file at a time: the file gate lets a person hold only a few downloads at
 * once, and a row of nine fired together had some of them refused.
 */
import { fileDownloadUrl, type MessageFile } from "@/lib/tasks/message-files"

export interface SaveFilesResult { saved: number; failed: string[] }

export async function saveTaskFiles(
  files: readonly MessageFile[],
  options: { onProgress?: (done: number, total: number) => void; wait?: (ms: number) => Promise<void> } = {},
): Promise<SaveFilesResult> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const failed: string[] = []
  let saved = 0
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    options.onProgress?.(index, files.length)
    try {
      let res = await fetch(fileDownloadUrl(file), { credentials: "same-origin" })
      if (res.status === 429 || res.status === 503) {
        // The gate asks to come back a little later; once is enough for a row of files.
        const seconds = Math.min(Math.max(Number(res.headers.get("Retry-After")) || 2, 1), 15)
        await wait(seconds * 1000)
        res = await fetch(fileDownloadUrl(file), { credentials: "same-origin" })
      }
      if (!res.ok) throw new Error(String(res.status))
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement("a")
      link.href = url
      link.download = file.originalName
      link.style.display = "none"
      document.body.appendChild(link)
      link.click()
      link.remove()
      // The browser has taken the bytes by the time the click returns; the address is kept a moment for slow disks.
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      saved += 1
    } catch {
      failed.push(file.originalName)
    }
  }
  options.onProgress?.(files.length, files.length)
  return { saved, failed }
}
