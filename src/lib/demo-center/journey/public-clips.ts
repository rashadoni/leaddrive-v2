/**
 * Clips the open demo may stream to a visitor with no session at all.
 *
 * Only clips filmed on the invented demo stand (scripts/seeds/demo-journey-clips.mjs,
 * «Demo Mebel»): nothing in them belongs to anyone. The owner decided on
 * 2026-09-22 to show them in the open demo too. The help library's own clips
 * that the story also plays (deal-detail, quotes) show LeadDrive Inc.'s test
 * records and stay behind a grant; the open demo says so in their place.
 */
export const DEMO_PUBLIC_CLIP_SLUGS: ReadonlySet<string> = new Set([
  "demo-campaigns",
  "demo-inbox",
  "demo-leads",
  "demo-boards",
])

/**
 * Part of every public clip URL. The app's service worker keeps media by URL
 * and renews it on every visit, so a clip re-filmed under the same URL would
 * never reach a returning visitor: change this when any public clip changes.
 */
export const DEMO_PUBLIC_CLIPS_VERSION = "20260921"

export function demoPublicClipUrl(slug: string, kind: "video" | "poster"): string {
  const file = `${slug}.az.${kind === "video" ? "VOICE.mp4" : "poster.jpg"}`
  return `/api/v1/public/demo-clips/${encodeURIComponent(file)}?v=${DEMO_PUBLIC_CLIPS_VERSION}`
}
