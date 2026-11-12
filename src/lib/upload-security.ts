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
  if (normalized === "audio/ogg") {
    return startsWith(bytes, [0x4f, 0x67, 0x67, 0x53]) ? null : "File content is not a valid Ogg audio file"
  }
  if ([
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    // An Outlook .msg is the same compound-file container as legacy Office.
    "application/vnd.ms-outlook",
  ].includes(normalized)) {
    return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      ? null
      : "File content is not a valid legacy Office document"
  }
  // Task files since 2026-11-12: the marketing team's videos and design sources.
  if (normalized === "video/mp4" || normalized === "video/quicktime") {
    // ISO media: the first box's type sits at bytes 4..8.
    const box = String.fromCharCode(...bytes.subarray(4, 8))
    return ["ftyp", "moov", "mdat", "free", "wide", "skip", "pnot"].includes(box) ? null : "File content is not a valid video"
  }
  if (normalized === "application/vnd.corel-draw") {
    // CorelDraw up to X3 is a RIFF «CDR?» file, X4 and later a ZIP package.
    const riffCdr = startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x43, 0x44, 0x52])
    return riffCdr || hasZipSignature(bytes) ? null : "File content is not a valid CorelDraw file"
  }
  if (normalized === "image/vnd.adobe.photoshop") {
    return startsWith(bytes, [0x38, 0x42, 0x50, 0x53]) ? null : "File content is not a valid Photoshop file"
  }
  if (normalized === "application/rtf") {
    return startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66]) ? null : "File content is not a valid RTF document"
  }
  if (normalized === "message/rfc822") {
    return looksLikeText(bytes) ? null : "An e-mail file cannot contain binary data"
  }
  if (normalized === "text/plain" || normalized === "text/csv") {
    return looksLikeText(bytes) ? null : "Text documents cannot contain binary data"
  }

  return "File content type is not supported"
}
