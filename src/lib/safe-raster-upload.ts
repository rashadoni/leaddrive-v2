import path from "path"
import sharp from "sharp"
import { validateUploadBytes } from "@/lib/upload-security"

const MAX_INPUT_DIMENSION = 4096
const MAX_INPUT_PIXELS = 16_000_000

const INPUT_FORMATS = new Map<string, {
  extensions: ReadonlySet<string>
  decodedFormat: "png" | "jpeg" | "webp"
  outputExtension: "png" | "jpg" | "webp"
  outputContentType: "image/png" | "image/jpeg" | "image/webp"
}>([
  ["image/png", {
    extensions: new Set([".png"]),
    decodedFormat: "png",
    outputExtension: "png",
    outputContentType: "image/png",
  }],
  ["image/jpeg", {
    extensions: new Set([".jpg", ".jpeg"]),
    decodedFormat: "jpeg",
    outputExtension: "jpg",
    outputContentType: "image/jpeg",
  }],
  ["image/webp", {
    extensions: new Set([".webp"]),
    decodedFormat: "webp",
    outputExtension: "webp",
    outputContentType: "image/webp",
  }],
])

const EXECUTABLE_INTERMEDIATE_EXTENSIONS = new Set([
  "asp", "aspx", "bat", "cgi", "cmd", "com", "exe", "htm", "html", "js", "jsp",
  "jspx", "mjs", "phtml", "phar", "php", "php3", "php4", "php5", "pl", "py", "rb",
  "sh", "shtml", "svg", "xml",
])

function hasSafeOriginalFilename(name: string, extensions: ReadonlySet<string>): boolean {
  const basename = name.split(/[\\/]/).at(-1) ?? ""
  const extension = path.extname(basename).toLowerCase()
  const stem = basename.slice(0, -extension.length)
  const intermediateExtensions = stem.toLowerCase().split(".").slice(1)
  return extension.length > 0
    && stem.length > 0
    && extensions.has(extension)
    && !intermediateExtensions.some((part) => EXECUTABLE_INTERMEDIATE_EXTENSIONS.has(part))
}

function containsActiveContentMarker(input: Buffer): boolean {
  const sample = input.toString("latin1").toLowerCase()
  return ["<?php", "<script", "<svg", "javascript:"].some((marker) => sample.includes(marker))
}

export type SafeRasterResult =
  | {
      ok: true
      bytes: Buffer
      extension: "png" | "jpg" | "webp"
      contentType: "image/png" | "image/jpeg" | "image/webp"
    }
  | { ok: false; reason: "type" | "size" | "content" }

export async function decodeAndReencodeSafeRaster(
  file: File,
  options: {
    maxInputBytes: number
    maxOutputBytes: number
    maxOutputDimension: number
  },
): Promise<SafeRasterResult> {
  if (
    !Number.isSafeInteger(options.maxInputBytes)
    || !Number.isSafeInteger(options.maxOutputBytes)
    || !Number.isSafeInteger(options.maxOutputDimension)
    || options.maxInputBytes < 1
    || options.maxOutputBytes < 1
    || options.maxOutputDimension < 1
  ) {
    throw new Error("Safe raster limits must be positive safe integers")
  }

  if (file.size < 1 || file.size > options.maxInputBytes) {
    return { ok: false, reason: "size" }
  }

  const mimeType = file.type.toLowerCase().trim()
  const inputFormat = INPUT_FORMATS.get(mimeType)
  if (!inputFormat || !hasSafeOriginalFilename(file.name, inputFormat.extensions)) {
    return { ok: false, reason: "type" }
  }

  const input = Buffer.from(await file.arrayBuffer())
  if (
    input.byteLength !== file.size
    || validateUploadBytes(mimeType, input)
    || containsActiveContentMarker(input)
  ) {
    return { ok: false, reason: "content" }
  }

  try {
    const image = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    })
    const metadata = await image.metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if (
      metadata.format !== inputFormat.decodedFormat
      || width < 1
      || height < 1
      || width > MAX_INPUT_DIMENSION
      || height > MAX_INPUT_DIMENSION
      || width * height > MAX_INPUT_PIXELS
      || (metadata.pages ?? 1) !== 1
    ) {
      return { ok: false, reason: "content" }
    }

    const raster = image
      .rotate()
      .resize(options.maxOutputDimension, options.maxOutputDimension, {
        fit: "inside",
        withoutEnlargement: true,
      })

    let bytes: Buffer
    if (inputFormat.outputExtension === "png") {
      bytes = await raster.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    } else if (inputFormat.outputExtension === "jpg") {
      bytes = await raster.jpeg({ quality: 88, mozjpeg: true }).toBuffer()
    } else {
      bytes = await raster.webp({ quality: 86, alphaQuality: 90 }).toBuffer()
    }

    if (bytes.byteLength < 1 || bytes.byteLength > options.maxOutputBytes) {
      return { ok: false, reason: "size" }
    }

    return {
      ok: true,
      bytes,
      extension: inputFormat.outputExtension,
      contentType: inputFormat.outputContentType,
    }
  } catch {
    return { ok: false, reason: "content" }
  }
}
