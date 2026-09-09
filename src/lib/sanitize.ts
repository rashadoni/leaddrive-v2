import DOMPurify from "isomorphic-dompurify"
import { z } from "zod"
import { CONTRACT_LINK_PROTOCOLS } from "@/lib/clm/link-protocols"

export function sanitizeHtml(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: ["b", "i", "em", "strong"] })
}

/** Rich HTML sanitizer for KB articles, email templates, and previews */
export function sanitizeRichHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "ul", "ol", "li",
      "strong", "em", "b", "i", "u", "s", "del",
      "a", "img",
      "blockquote", "pre", "code",
      "table", "thead", "tbody", "tr", "th", "td",
      "div", "span", "font",
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title",
      "target", "rel", "width", "height",
      "color", "size", "face",
    ],
    ALLOW_DATA_ATTR: false,
  })
}

/**
 * Sanitizer for the Contract Editor body (Slice 1, Step 3 + toolbar Phases 1-3).
 * Tighter than `sanitizeRichHtml`: only the tags the contract serializer
 * round-trips, no inline-style/`font` (a contract body is typeset text).
 * `start` is allowed so `<ol start="N">` numbering survives (the serializer +
 * the legacy-seed round-trip depend on it). `class` is allowed but a scoped
 * hook narrows it to the four `ta-*` alignment classes the editor's
 * class-based TextAlign emits — the inline `style` ban stays absolute
 * (DOMPurify FORBID_ATTR would override any hook, which is exactly why
 * alignment is classes, not styles).
 *
 * Phase 2 link surface (deliberately narrow):
 *  - `a[href]` is allowed ONLY when the href parses as an absolute URL with
 *    an allowlisted protocol (CONTRACT_LINK_PROTOCOLS — the SHARED module
 *    the editor's isAllowedUri/applyLink also import, so client and server
 *    can't drift). Anything else — relative paths, javascript:, data:,
 *    tel:, ftp:, unparseable — drops the attribute; the anchor degrades to
 *    plain text. Intentionally tighter than DOMPurify's default URI policy.
 *  - every surviving `a[href]` gets `rel="noopener noreferrer"` FORCED in an
 *    afterSanitizeAttributes hook (attacker-supplied rel can't stick);
 *    `target` is not allowlisted, so it never persists.
 *
 * Phase 3 image surface (opt-in per call):
 *  - `img` is allowed ONLY when the caller passes `opts.imageOrgId` (the
 *    editor body route does; import-docx and other callers don't, so images
 *    stay banned there). The src hook then accepts exactly ONE shape:
 *    `/uploads/contract-images/<imageOrgId>/<safe-filename>` — same-origin
 *    relative, the caller's own org, a conservative filename charset, no
 *    `..` anywhere. External URLs / data: / other subdirs / other orgs all
 *    drop the attribute, and an src-less <img> is REMOVED outright in the
 *    after-hook (no broken-image litter). Serving is further gated by the
 *    F-41 route (auth + per-org path check + traversal guard).
 *
 * `ALLOW_DATA_ATTR` is OFF — generic `data-*` is an injection/exfil surface
 * in a re-rendered body; Step-5 merge variables will re-allow ONLY `data-var`
 * via `ADD_ATTR`. DOMPurify already strips scripts/event-handlers.
 */
const CONTRACT_ALIGN_CLASS = /^ta-(left|right|center|justify)$/
// Conservative stored-image filename: must start alphanumeric, no path
// separators, no "..", must end in a real extension.
const CONTRACT_IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[a-z0-9]{2,5}$/

export interface SanitizeContractBodyOpts {
  /** Enable <img> for THIS org's contract-images subdir only. */
  imageOrgId?: string
}

export function sanitizeContractBody(input: string, opts?: SanitizeContractBodyOpts): string {
  const imageOrgId = opts?.imageOrgId
  const imagePrefix = imageOrgId ? `/uploads/contract-images/${imageOrgId}/` : null

  // Scoped hooks (addHook/removeHook in try/finally — the shared DOMPurify
  // instance must stay clean for the other sanitizers in this module):
  //  - `class`: keep only the subset of allowlisted ta-* tokens; anything
  //    else (or an emptied list) drops the attribute entirely.
  //  - `href`: keep only absolute URLs with shared-allowlist protocols.
  //  - `src` (images enabled only): keep only this org's contract-images.
  const attrHook = (_node: unknown, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    if (data.attrName === "class") {
      const kept = data.attrValue.split(/\s+/).filter((c) => CONTRACT_ALIGN_CLASS.test(c))
      if (kept.length) data.attrValue = kept.join(" ")
      else data.keepAttr = false
      return
    }
    if (data.attrName === "href") {
      try {
        const parsed = new URL(data.attrValue)
        if ((CONTRACT_LINK_PROTOCOLS as readonly string[]).includes(parsed.protocol)) {
          // Canonicalize (Codex P2): store the parser's serialization, not
          // the raw input — strips stray whitespace/control chars and keeps
          // the stored value aligned with the decision the parser made.
          data.attrValue = parsed.href
          return
        }
      } catch {
        /* relative or unparseable → drop below */
      }
      data.keepAttr = false // not an allowlisted absolute URL
      return
    }
    if (data.attrName === "src") {
      const v = data.attrValue
      // Tag-bound (architect): ALLOWED_ATTR is global, so without this check
      // a valid own-org value could ride inert on <span>/<p>. src is for IMG.
      const isImg = (_node as Element | null)?.tagName === "IMG"
      if (
        isImg &&
        imagePrefix &&
        v.startsWith(imagePrefix) &&
        !v.includes("..") &&
        CONTRACT_IMAGE_FILE.test(v.slice(imagePrefix.length))
      ) {
        return // exactly <img src="/uploads/contract-images/<own-org>/<safe-file.ext>">
      }
      data.keepAttr = false
    }
  }
  // Post-filter node fixups: forced rel on anchors (value can't be
  // overridden by input markup) + drop <img> that lost its src (no broken
  // image placeholders in a stored body).
  const nodeHook = (node: Element) => {
    if (node.tagName === "A") {
      if (node.hasAttribute("href")) node.setAttribute("rel", "noopener noreferrer")
      else node.removeAttribute("rel")
    }
    if (node.tagName === "IMG" && !node.getAttribute("src")) {
      node.remove()
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DOMPurify.addHook("uponSanitizeAttribute", attrHook as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DOMPurify.addHook("afterSanitizeAttributes", nodeHook as any)
  try {
    return DOMPurify.sanitize(input, {
      ALLOWED_TAGS: [
        "p", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr",
        "ul", "ol", "li",
        "strong", "em", "u", "b", "i", "s", "del",
        "sub", "sup", "mark",
        "a",
        ...(imagePrefix ? ["img"] : []),
        "blockquote", "pre", "code",
        "table", "thead", "tbody", "tr", "th", "td",
        "span",
      ],
      // start: <ol> numbering; class: ta-* only; href: shared protocol
      // allowlist; src/alt: org-scoped contract images (all via hooks);
      // rel: forced to a fixed value post-filter.
      ALLOWED_ATTR: ["start", "class", "href", "rel", ...(imagePrefix ? ["src", "alt"] : [])],
      ALLOW_DATA_ATTR: false, // block generic data-* (Step 5 re-allows data-var only)
      ALLOW_ARIA_ATTR: false, // block aria-* — injection surface on a re-rendered body
      FORBID_TAGS: ["script", "style", "iframe", "object", ...(imagePrefix ? [] : ["img"]), "font", "div"],
      FORBID_ATTR: ["style", ...(imagePrefix ? [] : ["src"]), "onerror", "onload", "onclick"],
    })
  } finally {
    // NOTE (Codex P2): removeHook(entryPoint) pops the LAST hook for that
    // entry point, not this specific function. Safe today — sanitize calls
    // are synchronous and nothing else in this process registers DOMPurify
    // hooks — but if another module ever adds persistent hooks, switch the
    // contract sanitizer to an isolated DOMPurify instance instead.
    DOMPurify.removeHook("uponSanitizeAttribute")
    DOMPurify.removeHook("afterSanitizeAttributes")
  }
}

export function sanitizeText(input: string): string {
  return input.replace(/[<>]/g, "")
}

/** Sanitize user data before injecting into AI system prompts.
 *  Strips newlines, control characters, and caps length to prevent prompt injection. */
export function sanitizeForPrompt(input: string, maxLength = 100): string {
  return input
    .replace(/[\r\n\t]/g, " ")       // strip newlines/tabs
    .replace(/[\x00-\x1f\x7f]/g, "") // strip control characters
    .trim()
    .slice(0, maxLength)
}

/** Strip newlines and ANSI escape codes from strings before logging */
export function sanitizeLog(input: string): string {
  return input.replace(/[\n\r]/g, " ").replace(/\x1b\[[0-9;]*m/g, "").substring(0, 1000)
}

// Common sanitized Zod schemas
export const sanitizedStringSchema = z
  .string()
  .max(500)
  .transform((val) => sanitizeText(val))

export const sanitizedHtmlSchema = z
  .string()
  .max(5000)
  .transform((val) => sanitizeHtml(val))

export const sanitizedEmailSchema = z
  .string()
  .email()
  .toLowerCase()
  .transform((val) => sanitizeText(val))

export const contactSchema = z.object({
  firstName: sanitizedStringSchema,
  lastName: sanitizedStringSchema,
  email: sanitizedEmailSchema,
  phone: sanitizedStringSchema.optional(),
  notes: sanitizedHtmlSchema.optional(),
})

export const dealSchema = z.object({
  name: sanitizedStringSchema,
  description: sanitizedHtmlSchema.optional(),
  value: z.number().positive(),
})
