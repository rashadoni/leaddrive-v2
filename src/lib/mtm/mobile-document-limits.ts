/**
 * The largest document a field upload or the product catalog accepts. Kept
 * apart from mobile-document.ts, which brings node's fs and path with it, so
 * the browser can say the limit before a 25 MB upload is refused.
 */
export const MAX_MOBILE_DOCUMENT_BYTES = 25 * 1024 * 1024
