/**
 * Content-Security-Policy builder — Phase 2 (ENFORCE).
 *
 * Extracted from middleware.ts so the policy is unit-testable without the
 * next-auth middleware harness. History: shipped 2026-07-08 as Report-Only
 * (Phase 1), 9 days of prod violation reports reviewed 2026-07-17, allowlist
 * patched and flipped to enforce on app + tenant hosts. Marketing host stays
 * Report-Only until Cloudflare Email Obfuscation (which parser-injects
 * /cdn-cgi/.../email-decode.min.js without a nonce — unallowable under
 * 'strict-dynamic') is turned off for the zone.
 *
 * Decisions baked in (from the report review):
 *  - style-src has NO nonce: CSP3 ignores 'unsafe-inline' whenever a nonce is
 *    present, and client libs inject <style> / setAttribute("style") at
 *    runtime on every page — a style nonce would break the whole app. Script
 *    protection (nonce + 'strict-dynamic') is the control that matters.
 *  - No 'unsafe-eval': the one real eval in the prod bundle is webpack's
 *    globalThis shim (`Function("return this")()` inside try/catch with a
 *    `window` fallback) — verified benign under enforce in a clean-browser
 *    prod-mode smoke (every page works; it logs one script-src eval report
 *    per load, which is expected noise). lodash/core-js have the same shim
 *    in dead branches that never execute in browsers.
 *  - Social-monitoring renders media straight off Meta/TikTok CDNs, which
 *    shard across many regional hostnames — enumerate the CDN apex wildcards
 *    (CSP host wildcards match multi-label subdomains) instead of https:.
 *  - frame-ancestors is per-path: 'none' default, 'self' for same-origin
 *    invoice previews, OMITTED for /embed/chat/ (customer-site widget must be
 *    embeddable from any origin; the API layer enforces allowedOrigins).
 */

export type FrameAncestorsMode = "none" | "self" | "omit"

export const CSP_REPORT_URI = "/api/v1/public/csp-report"

// Meta (Facebook/Instagram) + TikTok media CDNs used by social monitoring.
// Wildcards cover the regional shards (scontent-*.xx.fbcdn.net,
// v16-webapp-prime.us.tiktok.com, p16-common-sign.tiktokcdn-us.com, …).
const SOCIAL_MEDIA_CDNS = [
  "https://*.fbcdn.net",
  "https://*.cdninstagram.com",
  "https://*.tiktokcdn.com",
  "https://*.tiktokcdn-us.com",
  "https://*.tiktok.com",
].join(" ")

// Inline video players embedded in the social-monitoring feed (mention cards
// render an <iframe> for YouTube watch/shorts and TikTok video URLs). Without
// these in frame-src the browser blocks every embed under the default policy.
const VIDEO_EMBED_FRAMES = [
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://www.tiktok.com",
].join(" ")

export function buildCsp(nonce: string, frameAncestors: FrameAncestorsMode = "none"): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://editor.unlayer.com https://*.unlayer.com`,
    "script-src-attr 'none'",
    // Google Fonts: /sign/[token] @imports Dancing Script from
    // fonts.googleapis.com (css → style-src, woff2 → font-src).
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    `media-src 'self' blob: ${SOCIAL_MEDIA_CDNS}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' ${process.env.NEXTAUTH_URL || "https://app.leaddrivecrm.org"} ${process.env.NEXT_PUBLIC_MARKETING_URL || "https://leaddrivecrm.org"} https://api.anthropic.com https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com https://accounts.google.com https://login.microsoftonline.com https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://tile.openstreetmap.de https://core-renderer-tiles.maps.yandex.net https://unpkg.com ${SOCIAL_MEDIA_CDNS}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self' https://accounts.google.com https://login.microsoftonline.com",
    // The optional MTM Google Maps Embed iframe is separate from the
    // product-owned Leaflet map and is rendered only after an explicit click.
    `frame-src 'self' https://editor.unlayer.com https://*.unlayer.com https://www.google.com ${VIDEO_EMBED_FRAMES}`,
  ]
  if (frameAncestors !== "omit") {
    directives.push(`frame-ancestors '${frameAncestors}'`)
  }
  directives.push(`report-uri ${CSP_REPORT_URI}`)
  return directives.join("; ")
}
