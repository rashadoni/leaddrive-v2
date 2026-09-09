/**
 * Mobile content validator — C2 slice 1.
 *
 * Per-channel shape + length checks on MobileMessageTemplate or
 * MobileCampaign inline content. Slice-2 dispatchers run another
 * sanitisation pass (XSS scrub for in_app HTML, GSM-7 encoding
 * check for SMS) before delivery — validator just enforces the
 * authorship boundaries.
 *
 *   push   — title ≤ 100 chars, body ≤ 240 chars, optional deepLink
 *   in_app — title ≤ 200 chars, body ≤ 5000 chars (HTML allowed,
 *            DOMPurify in slice-2 render layer)
 *   sms    — body ≤ 1600 chars (multi-part), NO title
 *
 * Pure synchronous. Discriminated union.
 */
import {
  DEFAULT_CONTENT_LIMITS,
  MOBILE_CHANNELS,
  type ContentLimits,
  type MobileChannel,
  type ValidateContentInput,
  type ValidateContentResult,
} from "./types"

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

export function validateContent(input: ValidateContentInput): ValidateContentResult {
  const errors: string[] = []
  if (!input.content || typeof input.content !== "object") {
    return { ok: false, errors: ["content must be an object"] }
  }

  const c = input.content
  if (!(MOBILE_CHANNELS as readonly string[]).includes(c.channel as MobileChannel)) {
    errors.push(`channel "${String(c.channel)}" must be one of ${MOBILE_CHANNELS.join(", ")}`)
    return { ok: false, errors }
  }

  const limits: ContentLimits = {
    ...DEFAULT_CONTENT_LIMITS,
    ...(input.limits ?? {}),
  }
  // Negative-limit guard.
  for (const [k, v] of Object.entries(limits)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      errors.push(`limits.${k} must be a positive number`)
    }
  }
  if (errors.length > 0) return { ok: false, errors }

  // Body — required across all channels.
  if (!isNonEmptyString(c.body)) {
    errors.push("body must be a non-empty string")
    return { ok: false, errors }
  }

  switch (c.channel) {
    case "push": {
      if (!isNonEmptyString(c.title)) {
        errors.push("push: title is required")
        return { ok: false, errors }
      }
      if (c.title.length > limits.pushTitleMax) {
        errors.push(`push: title length ${c.title.length} exceeds ${limits.pushTitleMax}`)
        return { ok: false, errors }
      }
      if (c.body.length > limits.pushBodyMax) {
        errors.push(`push: body length ${c.body.length} exceeds ${limits.pushBodyMax}`)
        return { ok: false, errors }
      }
      break
    }
    case "in_app": {
      if (!isNonEmptyString(c.title)) {
        errors.push("in_app: title is required")
        return { ok: false, errors }
      }
      if (c.title.length > limits.inAppTitleMax) {
        errors.push(`in_app: title length ${c.title.length} exceeds ${limits.inAppTitleMax}`)
        return { ok: false, errors }
      }
      if (c.body.length > limits.inAppBodyMax) {
        errors.push(`in_app: body length ${c.body.length} exceeds ${limits.inAppBodyMax}`)
        return { ok: false, errors }
      }
      break
    }
    case "sms": {
      // SMS rejects a title — sender field is set at dispatch time, not authorship.
      if (c.title !== null && c.title !== undefined && c.title !== "") {
        errors.push("sms: title is not supported (body-only channel)")
        return { ok: false, errors }
      }
      if (c.body.length > limits.smsBodyMax) {
        errors.push(`sms: body length ${c.body.length} exceeds ${limits.smsBodyMax}`)
        return { ok: false, errors }
      }
      break
    }
  }

  // Optional deepLink — present on push + in_app; SMS may carry an
  // inline shortened URL in body instead.
  if (c.deepLinkUrl !== null && c.deepLinkUrl !== undefined && c.deepLinkUrl !== "") {
    if (typeof c.deepLinkUrl !== "string") {
      errors.push("deepLinkUrl must be a string")
      return { ok: false, errors }
    }
    if (c.deepLinkUrl.length > limits.deepLinkUrlMax) {
      errors.push(
        `deepLinkUrl length ${c.deepLinkUrl.length} exceeds ${limits.deepLinkUrlMax}`
      )
      return { ok: false, errors }
    }
    if (!/^https?:\/\//.test(c.deepLinkUrl)) {
      errors.push("deepLinkUrl must start with http:// or https://")
      return { ok: false, errors }
    }
  }

  return { ok: true, content: c }
}
