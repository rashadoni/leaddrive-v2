import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import { runtimeHelpVideoAssetsRoot } from "@/lib/runtime-paths"

/**
 * Serving a help-video asset, shared by the tenant route
 * (`/api/help-videos/[file]`) and the capability-gated demo route
 * (`/api/v1/public/demo-access/[token]/video/[file]`).
 *
 * The filename pattern is the only thing standing between a request and the
 * filesystem, so it lives here once rather than being retyped per route: it
 * admits nothing but `<slug>.<locale>.VOICE.mp4` / `.poster.jpg`, which
 * cannot contain a separator, a dot-segment or an absolute path.
 *
 * Callers do their own authorization first. This module never checks who is
 * asking — it only decides what a name may refer to and how to stream it.
 */

export const HELP_VIDEO_FILE_PATTERN = /^[a-z0-9-]+\.(az|en|ru)\.(VOICE\.mp4|poster\.jpg)$/

export interface ParsedHelpVideoFile {
  readonly slug: string
  readonly locale: "az" | "en" | "ru"
  readonly kind: "video" | "poster"
}

/** Splits a validated filename; returns null for anything the pattern rejects. */
export function parseHelpVideoFile(file: string): ParsedHelpVideoFile | null {
  if (!HELP_VIDEO_FILE_PATTERN.test(file)) return null
  const [slug, locale, ...rest] = file.split(".")
  return {
    slug,
    locale: locale as ParsedHelpVideoFile["locale"],
    kind: rest.join(".") === "VOICE.mp4" ? "video" : "poster",
  }
}

function contentTypeFor(file: string): string {
  return file.endsWith(".mp4") ? "video/mp4" : "image/jpeg"
}

function parseRange(range: string | null, size: number): { start: number; end: number } | null {
  if (!range) return null

  const match = range.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null

  const startText = match[1]
  const endText = match[2]
  const start = startText ? Number.parseInt(startText, 10) : 0
  const end = endText ? Number.parseInt(endText, 10) : size - 1

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= size) {
    return null
  }

  return { start, end }
}

function streamFile(path: string, range?: { start: number; end: number }): ReadableStream {
  const stream = range
    ? createReadStream(path, { start: range.start, end: range.end })
    : createReadStream(path)

  return Readable.toWeb(stream) as ReadableStream
}

/**
 * Streams the asset, honouring a Range request for video so seeking works.
 * `extraHeaders` lets the demo route add its own no-store/no-referrer policy
 * instead of the tenant route's shared cache headers.
 */
export async function serveHelpVideoFile(
  file: string,
  requestRange: string | null,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  if (!HELP_VIDEO_FILE_PATTERN.test(file)) return new Response("Not found", { status: 404 })

  const filePath = join(runtimeHelpVideoAssetsRoot(), file)
  const contentType = contentTypeFor(file)

  try {
    const fileStat = await stat(filePath)
    const size = fileStat.size
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "Accept-Ranges": "bytes",
      ...(extraHeaders ?? {}),
    })

    if (contentType === "video/mp4") {
      const range = parseRange(requestRange, size)

      if (range) {
        headers.set("Content-Length", String(range.end - range.start + 1))
        headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`)
        return new Response(streamFile(filePath, range), { status: 206, headers })
      }
    }

    headers.set("Content-Length", String(size))
    return new Response(streamFile(filePath), { headers })
  } catch {
    return new Response("Not found", { status: 404 })
  }
}
