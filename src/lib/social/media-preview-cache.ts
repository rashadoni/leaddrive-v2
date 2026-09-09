import crypto from "node:crypto"
import { lookup } from "node:dns/promises"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { request as httpRequest, type IncomingMessage } from "node:http"
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https"
import net from "node:net"
import path from "node:path"
import { isValidPublicMediaUrl } from "@/lib/vision/types"
import { runtimePrivateUploadDirectory } from "@/lib/runtime-paths"

export const MAX_SOCIAL_MEDIA_PREVIEW_BYTES = 12 * 1024 * 1024
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

export async function loadOrCacheSocialMediaPreview(input: {
  organizationId: string
  observationId: string
  sourceUrl: string
  isCurrent?: () => Promise<boolean>
}): Promise<{ bytes: Buffer; mime: string }> {
  const { directory, bytesPath, mimePath } = cachePaths(input)
  const cached = await readCached(bytesPath, mimePath)
  if (cached) {
    await assertPreviewCurrent(input.isCurrent)
    return cached
  }

  const downloaded = await downloadPublicImage(input.sourceUrl)
  await assertPreviewCurrent(input.isCurrent)
  await mkdir(directory, { recursive: true })
  const nonce = crypto.randomBytes(6).toString("hex")
  const tempBytes = `${bytesPath}.${nonce}.tmp`
  const tempMime = `${mimePath}.${nonce}.tmp`
  try {
    await writeFile(tempBytes, downloaded.bytes, { flag: "wx", mode: 0o600 })
    await writeFile(tempMime, downloaded.mime, { flag: "wx", mode: 0o600 })
    await assertPreviewCurrent(input.isCurrent)
    await rename(tempBytes, bytesPath)
    await rename(tempMime, mimePath)
    await assertPreviewCurrent(input.isCurrent)
    return downloaded
  } catch (error) {
    await Promise.all([
      rm(tempBytes, { force: true }),
      rm(tempMime, { force: true }),
    ])
    if (error instanceof Error && error.message === "media_preview_expired") {
      await deleteSocialMediaPreviewCache(input)
    }
    throw error
  }
}

export async function deleteSocialMediaPreviewCache(input: {
  organizationId: string
  observationId: string
}) {
  const { bytesPath, mimePath } = cachePaths(input)
  await Promise.all([
    rm(bytesPath, { force: true }),
    rm(mimePath, { force: true }),
  ])
}

async function assertPreviewCurrent(isCurrent: (() => Promise<boolean>) | undefined) {
  if (isCurrent && !(await isCurrent())) throw new Error("media_preview_expired")
}

function storageRoot() {
  return runtimePrivateUploadDirectory("social-media-previews")
}

function cachePaths(input: { organizationId: string; observationId: string }) {
  const directory = path.join(storageRoot(), input.organizationId)
  const key = crypto.createHash("sha256").update(input.observationId).digest("hex")
  return {
    directory,
    bytesPath: path.join(directory, `${key}.bin`),
    mimePath: path.join(directory, `${key}.mime`),
  }
}

async function readCached(bytesPath: string, mimePath: string) {
  try {
    const [bytes, mime, fileStat] = await Promise.all([readFile(bytesPath), readFile(mimePath, "utf8"), stat(bytesPath)])
    const normalizedMime = mime.trim().toLowerCase()
    if (!fileStat.isFile() || bytes.length === 0 || bytes.length > MAX_SOCIAL_MEDIA_PREVIEW_BYTES || !ALLOWED_MIME.has(normalizedMime)) return null
    return { bytes, mime: normalizedMime }
  } catch {
    return null
  }
}

async function downloadPublicImage(rawUrl: string) {
  let current = await assertPublicUrl(rawUrl)
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await requestPublicImage(current)
    const status = response.statusCode ?? 0
    if (status >= 300 && status < 400) {
      const location = response.headers.location
      response.destroy()
      if (!location || redirect === 3) throw new Error("media_preview_redirect_rejected")
      current = await assertPublicUrl(new URL(location, current.url).toString())
      continue
    }
    if (status < 200 || status >= 300) {
      response.destroy()
      throw new Error(`media_preview_upstream_${status}`)
    }
    const contentLength = Number(response.headers["content-length"] || "0")
    if (Number.isFinite(contentLength) && contentLength > MAX_SOCIAL_MEDIA_PREVIEW_BYTES) {
      response.destroy()
      throw new Error("media_preview_too_large")
    }
    const bytes = await readSocialMediaPreviewBody(response)
    const mime = detectSocialMediaPreviewMime(bytes)
    if (!mime) throw new Error("media_preview_invalid_type")
    return { bytes, mime }
  }
  throw new Error("media_preview_unavailable")
}

export type SocialMediaPreviewTarget = {
  url: URL
  address: string
  family: 4 | 6
}

async function assertPublicUrl(rawUrl: string): Promise<SocialMediaPreviewTarget> {
  if (!isValidPublicMediaUrl(rawUrl)) throw new Error("media_preview_invalid_url")
  const url = new URL(rawUrl)
  if (url.username || url.password) throw new Error("media_preview_invalid_url")
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(item => !isPublicSocialMediaPreviewAddress(item.address))) throw new Error("media_preview_private_host")
  const selected = addresses[0]
  return {
    url,
    address: selected.address,
    family: selected.family === 6 ? 6 : 4,
  }
}

export function createSocialMediaPreviewRequestOptions(target: SocialMediaPreviewTarget): HttpsRequestOptions {
  const originalHostname = target.url.hostname.replace(/^\[|\]$/g, "")
  return {
    protocol: target.url.protocol,
    hostname: target.address,
    family: target.family,
    port: target.url.port || undefined,
    path: `${target.url.pathname}${target.url.search}`,
    method: "GET",
    signal: AbortSignal.timeout(12_000),
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Host: target.url.host,
      "User-Agent": "Mozilla/5.0 (compatible; LeadDriveMediaPreview/1.0)",
    },
    ...(target.url.protocol === "https:" && net.isIP(originalHostname) === 0
      ? { servername: originalHostname }
      : {}),
  }
}

function requestPublicImage(target: SocialMediaPreviewTarget) {
  const options = createSocialMediaPreviewRequestOptions(target)
  return new Promise<IncomingMessage>((resolve, reject) => {
    const onResponse = (response: IncomingMessage) => resolve(response)
    const request = target.url.protocol === "https:"
      ? httpsRequest(options, onResponse)
      : httpRequest(options, onResponse)
    request.once("error", reject)
    request.end()
  })
}

export async function readSocialMediaPreviewBody(
  body: AsyncIterable<Uint8Array> & { destroy?: () => void },
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bytes.length
    if (totalBytes > MAX_SOCIAL_MEDIA_PREVIEW_BYTES) {
      body.destroy?.()
      throw new Error("media_preview_too_large")
    }
    chunks.push(bytes)
  }
  if (totalBytes === 0) throw new Error("media_preview_invalid_size")
  return Buffer.concat(chunks, totalBytes)
}

export function isPublicSocialMediaPreviewAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && b >= 18 && b <= 19) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113))
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase()
    return !(value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
      /^fe[89ab]/.test(value) || value.startsWith("ff") || value.startsWith("2001:db8:") ||
      value.includes(".") || value.startsWith("::ffff:") || /^0*:0*:0*:0*:0*:ffff:/.test(value))
  }
  return false
}

export function detectSocialMediaPreviewMime(bytes: Buffer) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg"
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (bytes.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif"
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp"
  return null
}
