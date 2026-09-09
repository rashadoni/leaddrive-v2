/**
 * Signature-payload validator — M6 Phase 6 Block C slice 1.
 *
 * Validates the submitted signature payload against its declared
 * method. Three accepted methods, each with method-specific shape:
 *
 *   drawn    — { svgPath, widthPx, heightPx }
 *   typed    — { typedName, font }
 *   uploaded — { fileRefId }
 *
 * Defense-in-depth limits (anti-DoS / anti-injection):
 *   • svgPath length cap (default 50K chars) — prevents 1MB SVG
 *     dumps via signature blob.
 *   • typedName length cap (200 chars) — sanity bound.
 *   • Pixel-dimension bounds (drawn) — rejects unrealistic canvas
 *     sizes that would crash PDF renderers in slice 2.
 *   • Font slug length cap — UI-side allowlist is the real gate,
 *     but the helper still bounds length defensively.
 *   • All shape checks use Object.prototype.hasOwnProperty.call
 *     to skip prototype-chain reads (defense-in-depth against
 *     payload-injected `__proto__`).
 *
 * Pure synchronous. Returns discriminated union with parsed payload
 * on success, error array on failure.
 */
import {
  DEFAULT_SIGNATURE_LIMITS,
  SIGNATURE_METHODS,
  type DrawnSignaturePayload,
  type SignatureLimits,
  type SignatureMethod,
  type TypedSignaturePayload,
  type UploadedSignaturePayload,
  type ValidateSignatureInput,
  type ValidateSignatureResult,
} from "./types"

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function has(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}

function validateDrawn(
  raw: Record<string, unknown>,
  limits: SignatureLimits,
  errors: string[]
): DrawnSignaturePayload | null {
  let ok = true
  let svgPath = ""
  let widthPx = 0
  let heightPx = 0
  if (!has(raw, "svgPath") || typeof raw.svgPath !== "string") {
    errors.push("drawn: svgPath must be a string")
    ok = false
  } else if (raw.svgPath.length === 0) {
    errors.push("drawn: svgPath must be non-empty")
    ok = false
  } else if (raw.svgPath.length > limits.maxSvgPathChars) {
    errors.push(
      `drawn: svgPath length ${raw.svgPath.length} exceeds limit ${limits.maxSvgPathChars}`
    )
    ok = false
  } else {
    svgPath = raw.svgPath
  }
  if (!has(raw, "widthPx") || typeof raw.widthPx !== "number" || !Number.isFinite(raw.widthPx)) {
    errors.push("drawn: widthPx must be a finite number")
    ok = false
  } else if (raw.widthPx <= 0 || raw.widthPx > limits.maxWidthPx) {
    errors.push(`drawn: widthPx ${raw.widthPx} must be in (0, ${limits.maxWidthPx}]`)
    ok = false
  } else {
    widthPx = raw.widthPx
  }
  if (
    !has(raw, "heightPx") ||
    typeof raw.heightPx !== "number" ||
    !Number.isFinite(raw.heightPx)
  ) {
    errors.push("drawn: heightPx must be a finite number")
    ok = false
  } else if (raw.heightPx <= 0 || raw.heightPx > limits.maxHeightPx) {
    errors.push(`drawn: heightPx ${raw.heightPx} must be in (0, ${limits.maxHeightPx}]`)
    ok = false
  } else {
    heightPx = raw.heightPx
  }
  return ok ? { svgPath, widthPx, heightPx } : null
}

function validateTyped(
  raw: Record<string, unknown>,
  limits: SignatureLimits,
  errors: string[]
): TypedSignaturePayload | null {
  let ok = true
  let typedName = ""
  let font = ""
  if (!has(raw, "typedName") || typeof raw.typedName !== "string") {
    errors.push("typed: typedName must be a string")
    ok = false
  } else if (raw.typedName.trim().length === 0) {
    errors.push("typed: typedName must be non-empty (after trim)")
    ok = false
  } else if (raw.typedName.length > limits.maxTypedNameChars) {
    errors.push(
      `typed: typedName length ${raw.typedName.length} exceeds ${limits.maxTypedNameChars}`
    )
    ok = false
  } else {
    typedName = raw.typedName
  }
  if (!has(raw, "font") || typeof raw.font !== "string") {
    errors.push("typed: font must be a string")
    ok = false
  } else if (raw.font.length === 0) {
    errors.push("typed: font must be non-empty")
    ok = false
  } else if (raw.font.length > limits.maxFontSlugChars) {
    errors.push(`typed: font length ${raw.font.length} exceeds ${limits.maxFontSlugChars}`)
    ok = false
  } else if (!/^[a-z0-9][a-z0-9_-]*$/i.test(raw.font)) {
    errors.push(`typed: font "${raw.font}" must be an alphanumeric slug`)
    ok = false
  } else {
    font = raw.font
  }
  return ok ? { typedName, font } : null
}

function validateUploaded(
  raw: Record<string, unknown>,
  errors: string[]
): UploadedSignaturePayload | null {
  if (!has(raw, "fileRefId") || typeof raw.fileRefId !== "string") {
    errors.push("uploaded: fileRefId must be a string")
    return null
  }
  if (raw.fileRefId.length === 0) {
    errors.push("uploaded: fileRefId must be non-empty")
    return null
  }
  // No upper-length cap here — fileRefId is opaque storage key; slice-2
  // storage layer validates existence.
  return { fileRefId: raw.fileRefId }
}

export function validateSignaturePayload(
  input: ValidateSignatureInput
): ValidateSignatureResult {
  const errors: string[] = []

  if (!(SIGNATURE_METHODS as readonly string[]).includes(input.method as SignatureMethod)) {
    errors.push(
      `unknown method "${String(input.method)}" (allowed: ${SIGNATURE_METHODS.join(", ")})`
    )
    return { ok: false, errors }
  }

  if (!isPlainObject(input.payload)) {
    errors.push("payload must be a plain object")
    return { ok: false, errors }
  }

  const limits: SignatureLimits = {
    ...DEFAULT_SIGNATURE_LIMITS,
    ...(input.limits ?? {}),
  }

  // Negative-/zero-limit guard — caller bug protection.
  if (
    limits.maxSvgPathChars <= 0 ||
    limits.maxTypedNameChars <= 0 ||
    limits.maxWidthPx <= 0 ||
    limits.maxHeightPx <= 0 ||
    limits.maxFontSlugChars <= 0
  ) {
    errors.push("limits must all be positive")
    return { ok: false, errors }
  }

  switch (input.method) {
    case "drawn": {
      const r = validateDrawn(input.payload, limits, errors)
      if (!r) return { ok: false, errors }
      return { ok: true, payload: r }
    }
    case "typed": {
      const r = validateTyped(input.payload, limits, errors)
      if (!r) return { ok: false, errors }
      return { ok: true, payload: r }
    }
    case "uploaded": {
      const r = validateUploaded(input.payload, errors)
      if (!r) return { ok: false, errors }
      return { ok: true, payload: r }
    }
  }
}
