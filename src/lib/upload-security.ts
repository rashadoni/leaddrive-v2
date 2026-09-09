function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
    || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
    || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8192))
  if (sample.includes(0)) return false
  return Array.from(sample).every((byte) =>
    byte === 0x09 || byte === 0x0a || byte === 0x0d || byte >= 0x20
  )
}

export function validateUploadBytes(mimeType: string, bytes: Uint8Array): string | null {
  const normalized = mimeType.toLowerCase().trim()
  if (bytes.byteLength < 1) return "File is empty"

  if (normalized === "application/pdf") {
    return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
      ? null
      : "File content is not a valid PDF"
  }
  if (normalized === "image/jpeg") {
    return startsWith(bytes, [0xff, 0xd8, 0xff])
      ? null
      : "File content is not a valid JPEG"
  }
  if (normalized === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ? null
      : "File content is not a valid PNG"
  }
  if (normalized === "image/gif") {
    return startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
      || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      ? null
      : "File content is not a valid GIF"
  }
  if (normalized === "image/webp") {
    const riff = startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    const webp = bytes.byteLength >= 12 && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
    return riff && webp ? null : "File content is not a valid WebP image"
  }
  if (normalized === "application/zip" || normalized.includes("officedocument")) {
    return hasZipSignature(bytes) ? null : "File content is not a valid ZIP-based document"
  }
  if ([
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
  ].includes(normalized)) {
    return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      ? null
      : "File content is not a valid legacy Office document"
  }
  if (normalized === "text/plain" || normalized === "text/csv") {
    return looksLikeText(bytes) ? null : "Text documents cannot contain binary data"
  }

  return "File content type is not supported"
}
