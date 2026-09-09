import crypto from "node:crypto"
import path from "node:path"
import { resolveRuntimePaths } from "@/lib/runtime-paths"

export const MAX_MOBILE_DOCUMENT_BYTES = 25 * 1024 * 1024

const SAFE_MIME_EXTENSIONS = new Map<string, ReadonlySet<string>>([
  ["application/pdf", new Set([".pdf"])],
  ["application/msword", new Set([".doc"])],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", new Set([".docx"])],
  ["application/vnd.ms-excel", new Set([".xls"])],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Set([".xlsx"])],
  ["application/vnd.ms-powerpoint", new Set([".ppt"])],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", new Set([".pptx"])],
  ["text/plain", new Set([".txt"])],
  ["text/csv", new Set([".csv"])],
  ["image/jpeg", new Set([".jpg", ".jpeg"])],
  ["image/png", new Set([".png"])],
  ["image/webp", new Set([".webp"])],
  ["application/zip", new Set([".zip"])],
])

export type MobileDocumentDescriptor = {
  name: string
  type: string
  size: number
}

export type MobileDocumentStateInput = {
  documentId: string
  state: "READ" | "DOWNLOADED"
  occurredAt: Date
}

export function normalizeMobileDocumentName(name: string): string {
  return path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 240)
}

export function validateMobileDocument(
  file: MobileDocumentDescriptor,
): { value: { fileName: string; mimeType: string } | null; error: string | null } {
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_MOBILE_DOCUMENT_BYTES) {
    return { value: null, error: "File size must be between 1 byte and 25 MB" }
  }
  const fileName = normalizeMobileDocumentName(file.name)
  if (!fileName) return { value: null, error: "File name is required" }
  const mimeType = file.type.toLowerCase().trim()
  const extensions = SAFE_MIME_EXTENSIONS.get(mimeType)
  if (!extensions) return { value: null, error: "File type is not allowed" }
  const extension = path.extname(fileName).toLowerCase()
  if (!extensions.has(extension)) {
    return { value: null, error: "File extension does not match its type" }
  }
  return { value: { fileName, mimeType }, error: null }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

export function validateMobileDocumentBytes(mimeType: string, bytes: Uint8Array): string | null {
  if (bytes.byteLength < 1) return "File is empty"
  if (mimeType === "application/pdf") {
    return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? null : "File content is not a valid PDF"
  }
  if (mimeType === "image/jpeg") {
    return startsWith(bytes, [0xff, 0xd8, 0xff]) ? null : "File content is not a valid JPEG"
  }
  if (mimeType === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : "File content is not a valid PNG"
  }
  if (mimeType === "image/webp") {
    const riff = startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    const webp = bytes.byteLength >= 12 && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
    return riff && webp ? null : "File content is not a valid WebP image"
  }
  const zipBased = mimeType === "application/zip"
    || mimeType.includes("officedocument")
  if (zipBased) {
    const zip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
      || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
      || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
    return zip ? null : "File content is not a valid ZIP-based document"
  }
  if (["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"].includes(mimeType)) {
    return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      ? null
      : "File content is not a valid legacy Office document"
  }
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8192))
    return sample.includes(0) ? "Text documents cannot contain NUL bytes" : null
  }
  return "File content type is not supported"
}

export function createMobileDocumentStorageKey(): string {
  return crypto.randomBytes(24).toString("hex")
}

export function mobileDocumentStorageRoot(): string {
  const configured = process.env.MTM_DOCUMENT_STORAGE_DIR?.trim()
  if (configured && !path.isAbsolute(configured)) {
    throw new Error("MTM_DOCUMENT_STORAGE_DIR must be an absolute path")
  }
  const runtimeUploadsRoot = resolveRuntimePaths(process.env, process.cwd()).privateUploadsRoot
  const storageRoot = configured ? path.resolve(configured) : path.join(runtimeUploadsRoot, "mtm-documents")
  if (process.env.NODE_ENV === "production") {
    if (!storageRoot.startsWith(runtimeUploadsRoot + path.sep)) {
      throw new Error("MTM_DOCUMENT_STORAGE_DIR must stay inside the canonical production upload root")
    }
  }
  return storageRoot
}

export function resolveMobileDocumentStoragePath(storageKey: string): string {
  if (!/^[a-f0-9]{48}$/.test(storageKey)) throw new Error("Invalid document storage key")
  return path.join(mobileDocumentStorageRoot(), storageKey)
}

export function mobileDocumentSha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

export function parseMobileDocumentState(
  data: unknown,
  now = new Date(),
): { input: MobileDocumentStateInput | null; error: string | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { input: null, error: "Document state data must be an object" }
  }
  const value = data as Record<string, unknown>
  if (typeof value.documentId !== "string" || !value.documentId.trim() || value.documentId.length > 128) {
    return { input: null, error: "documentId is required" }
  }
  if (value.state !== "READ" && value.state !== "DOWNLOADED") {
    return { input: null, error: "Document state must be READ or DOWNLOADED" }
  }
  const occurredAt = typeof value.occurredAt === "string" || typeof value.occurredAt === "number"
    ? new Date(value.occurredAt)
    : new Date(Number.NaN)
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    return { input: null, error: "Valid occurredAt is required and cannot be in the future" }
  }
  return {
    input: { documentId: value.documentId.trim(), state: value.state, occurredAt },
    error: null,
  }
}
