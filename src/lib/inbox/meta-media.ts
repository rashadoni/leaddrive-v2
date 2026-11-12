/**
 * A file a customer sent on Instagram or Facebook Messenger, kept by us — not a link to Meta's CDN.
 *
 * Until 2026-11-12 the message stored Meta's `lookaside.fbsbx.com` link and a type guessed from
 * Meta's attachment label. Three of four «documents» in Zeytun's inbox were photos Meta had labelled
 * with a type the guess did not know, so the thread showed «Attachment» instead of the picture; a
 * voice note is served as `video/mp4` (`audioclip-….mp4`), so it was sent to transcription as an
 * mp3 and refused; and the page would not play audio or video from Meta's host at all (owner:
 * «почему не загружает медиа и файлы»). Like WhatsApp and Telegram, the file is now downloaded when
 * the message arrives, sealed with the organization's key, served by the inbox's own upload route,
 * and typed by what the file is.
 *
 * Best-effort: any failure returns null and the message keeps Meta's link, as before.
 */

import crypto from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { decodeTenantFileBytes, sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import {
  downloadOutboundResource,
  type OutboundWebhookResolver,
  type OutboundWebhookTransport,
} from "@/lib/integrations/webhook-url-guard"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { isIgLogin } from "@/lib/social/tenant-meta-app"

const MAX_BYTES = 25 * 1024 * 1024 // Meta's own attachment cap
const DOWNLOAD_TIMEOUT_MS = 12_000

/**
 * Without a User-Agent Meta answers 302 to `www.facebook.com/unsupportedbrowser`, a ~50 KB HTML page
 * — and the first version (#1567) kept that page in place of every photo (2026-11-12, measured from
 * prod: same link, no UA → that page; «Mozilla/5.0 …» → the JPEG).
 */
const META_DOWNLOAD_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; LeadDrive/1.0)", Accept: "*/*" }

/** A web page is never the customer's file — whatever redirect or error produced it. */
function isWebPage(mime: string, bytes: Uint8Array): boolean {
  if (mime.startsWith("text/") || mime.includes("html")) return true
  const head = Buffer.from(bytes.subarray(0, 256)).toString("utf8").trimStart().toLowerCase()
  return head.startsWith("<!doctype") || head.startsWith("<html")
}

/** Meta's media hosts. A shared post (`instagram.com/p/…`) is a page, not a file, and is left as a link. */
export function isMetaMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== "https:") return false
    return hostname === "lookaside.fbsbx.com" || /(^|\.)(fbcdn\.net|cdninstagram\.com|fbsbx\.com)$/i.test(hostname)
  } catch {
    return false
  }
}

export type MetaMediaKind = "image" | "video" | "audio" | "document"

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/wav": "wav",
  "application/pdf": "pdf",
}

function headerFileName(disposition: string | undefined): string | null {
  const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null
  return match ? path.basename(decodeURIComponent(match[1])) : null
}

/** What the file is, from its own content type — and Meta names a voice note `audioclip-….mp4`. */
export function metaMediaKind(mime: string, fileName: string | null): MetaMediaKind {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return /^audioclip/i.test(fileName ?? "") ? "audio" : "video"
  return "document"
}

export type StoredMetaMedia = { url: string; mime: string; kind: MetaMediaKind; bytes: Buffer; fileName: string | null }

export async function fetchAndStoreMetaMedia(
  mediaUrl: string,
  organizationId: string,
  /** Test seams; production downloads through the IP-pinned, SSRF-checked transport. */
  seams: { transport?: OutboundWebhookTransport; resolveHost?: OutboundWebhookResolver } = {},
): Promise<StoredMetaMedia | null> {
  if (!organizationId || !isMetaMediaUrl(mediaUrl)) return null
  try {
    const res = await downloadOutboundResource(mediaUrl, {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      maxResponseBytes: MAX_BYTES,
      headers: { ...META_DOWNLOAD_HEADERS },
      transport: seams.transport,
      resolver: seams.resolveHost,
    })
    if (!res.ok || res.bodyBytes.byteLength === 0 || res.bodyBytes.byteLength > MAX_BYTES) return null
    // Wherever a redirect went, the file must come from Meta's media hosts and not be a page.
    if (!isMetaMediaUrl(res.url)) return null
    const mime = (res.headers?.["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase()
    if (isWebPage(mime, res.bodyBytes)) return null
    const fileName = headerFileName(res.headers?.["content-disposition"])
    const ext = EXT_BY_MIME[mime] ?? (fileName && /\.[a-z0-9]{2,5}$/i.test(fileName) ? fileName.split(".").pop()!.toLowerCase() : "bin")
    const bytes = Buffer.from(res.bodyBytes)
    const storedName = `${crypto.randomBytes(12).toString("hex")}.${ext}`
    const rootDir = path.join(runtimePublicUploadDirectory("inbox"), organizationId)
    await mkdir(rootDir, { recursive: true })
    await writeFile(path.join(rootDir, storedName), sealTenantFile(organizationId, bytes))
    return { url: `/uploads/inbox/${organizationId}/${storedName}`, mime, kind: metaMediaKind(mime, fileName), bytes, fileName }
  } catch {
    return null
  }
}

/**
 * Messages that arrived before the webhook kept files (2026-11-12) still hold Meta's link. This
 * keeps their files the same way — owner: «Да, докачай». Counts only; a link Meta no longer
 * serves stays as it was and is counted as `failed`.
 */
export type MetaMediaBackfillReport = {
  dryRun: boolean
  candidates: number
  stored: number
  failed: number
  hasMore: boolean
  byKind: Partial<Record<MetaMediaKind, number>>
}

export async function backfillMetaMediaMessages(
  options: { dryRun: boolean; limit: number },
  seams: { transport?: OutboundWebhookTransport; resolveHost?: OutboundWebhookResolver } = {},
): Promise<MetaMediaBackfillReport> {
  const rows: Array<{ id: string; organizationId: string; mediaUrl: string | null }> = await runWithRlsBypass(() => prisma.channelMessage.findMany({
    where: {
      OR: [
        { mediaUrl: { startsWith: "https://lookaside.fbsbx.com/" } },
        { mediaUrl: { contains: ".fbcdn.net/" } },
        { mediaUrl: { contains: ".cdninstagram.com/" } },
        { mediaUrl: { contains: ".fbsbx.com/" } },
      ],
    },
    select: { id: true, organizationId: true, mediaUrl: true },
    orderBy: { createdAt: "asc" },
    take: options.limit + 1,
  }))
  const batch = rows.filter((row) => isMetaMediaUrl(row.mediaUrl)).slice(0, options.limit)
  const report: MetaMediaBackfillReport = {
    dryRun: options.dryRun, candidates: batch.length, stored: 0, failed: 0, hasMore: rows.length > options.limit, byKind: {},
  }
  if (options.dryRun) return report
  for (const row of batch) {
    const original = row.mediaUrl!
    const updated = await runWithTenant(row.organizationId, async () => {
      const stored = await fetchAndStoreMetaMedia(original, row.organizationId, seams)
      if (!stored) return null
      // Only if nobody changed the message meanwhile.
      const result = await prisma.channelMessage.updateMany({
        where: { id: row.id, organizationId: row.organizationId, mediaUrl: original },
        data: { mediaUrl: stored.url, messageType: stored.kind },
      })
      return result.count > 0 ? stored.kind : null
    })
    if (updated) {
      report.stored += 1
      report.byKind[updated] = (report.byKind[updated] ?? 0) + 1
    } else {
      report.failed += 1
    }
  }
  return report
}

/**
 * Messages where #1567 kept Facebook's «unsupported browser» page instead of the file (2026-11-12).
 * Meta's link is gone from the row, so a fresh one is asked from the Graph API by the message id,
 * with the channel's own token, and the file is kept as above. A stored file that is not that page
 * is left alone.
 */
export type MetaMediaRepairReport = { dryRun: boolean; checked: number; broken: number; repaired: number; failed: number; hasMore: boolean }

const STORED_INBOX_URL = /^\/uploads\/inbox\/([^/]+)\/([0-9a-f]{24}\.bin)$/

/** The file's link in a Graph API message (`attachments.data[0]`): image, video, audio or file. */
export function graphAttachmentUrl(message: unknown): string | null {
  const data = (message as { attachments?: { data?: unknown[] } } | null)?.attachments?.data
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  if (!first) return null
  for (const key of ["image_data", "video_data", "audio_data", "file_data", "payload"]) {
    const url = (first[key] as { url?: unknown } | undefined)?.url
    if (typeof url === "string" && isMetaMediaUrl(url)) return url
  }
  return typeof first.file_url === "string" && isMetaMediaUrl(first.file_url) ? first.file_url : null
}

type GraphFetch = (url: string) => Promise<unknown>
const defaultGraphFetch: GraphFetch = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  return res.ok ? res.json() : null
}

export async function repairMetaMediaMessages(
  options: { dryRun: boolean; limit: number },
  seams: { transport?: OutboundWebhookTransport; resolveHost?: OutboundWebhookResolver; graphFetch?: GraphFetch } = {},
): Promise<MetaMediaRepairReport> {
  const rows: Array<{ id: string; organizationId: string; channelConfigId: string | null; channelType: string | null; externalId: string | null; mediaUrl: string | null }> =
    await runWithRlsBypass(() => prisma.channelMessage.findMany({
      where: {
        channelType: { in: ["instagram", "facebook"] },
        direction: "inbound",
        messageType: "document",
        mediaUrl: { startsWith: "/uploads/inbox/", endsWith: ".bin" },
        externalId: { not: null },
      },
      select: { id: true, organizationId: true, channelConfigId: true, channelType: true, externalId: true, mediaUrl: true },
      orderBy: { createdAt: "asc" },
      take: options.limit + 1,
    }))
  const batch = rows.slice(0, options.limit)
  const report: MetaMediaRepairReport = { dryRun: options.dryRun, checked: batch.length, broken: 0, repaired: 0, failed: 0, hasMore: rows.length > options.limit }
  const graphFetch = seams.graphFetch ?? defaultGraphFetch
  for (const row of batch) {
    const match = STORED_INBOX_URL.exec(row.mediaUrl ?? "")
    if (!match || match[1] !== row.organizationId || !row.externalId) continue
    const outcome = await runWithTenant(row.organizationId, async (): Promise<"fine" | "repaired" | "failed"> => {
      try {
        const stored = await readFile(path.join(runtimePublicUploadDirectory("inbox"), row.organizationId, match[2]))
        if (!isWebPage("application/octet-stream", decodeTenantFileBytes(row.organizationId, stored))) return "fine"
      } catch {
        return "fine"
      }
      if (options.dryRun) return "failed"
      const config = row.channelConfigId
        ? await prisma.channelConfig.findFirst({ where: { id: row.channelConfigId, organizationId: row.organizationId }, select: { apiKey: true, settings: true } })
        : null
      if (!config?.apiKey) return "failed"
      const base = row.channelType === "instagram" && isIgLogin(config.settings)
        ? "https://graph.instagram.com/v21.0"
        : "https://graph.facebook.com/v20.0"
      const query = new URLSearchParams({ fields: "attachments", access_token: config.apiKey })
      let fresh: string | null = null
      try {
        fresh = graphAttachmentUrl(await graphFetch(`${base}/${encodeURIComponent(row.externalId!)}?${query}`))
      } catch {
        fresh = null
      }
      const kept = fresh ? await fetchAndStoreMetaMedia(fresh, row.organizationId, seams) : null
      if (!kept) return "failed"
      const result = await prisma.channelMessage.updateMany({
        where: { id: row.id, organizationId: row.organizationId, mediaUrl: row.mediaUrl },
        data: { mediaUrl: kept.url, messageType: kept.kind },
      })
      return result.count > 0 ? "repaired" : "failed"
    })
    if (outcome === "fine") continue
    report.broken += 1
    if (outcome === "repaired") report.repaired += 1
    else if (!options.dryRun) report.failed += 1
  }
  return report
}
