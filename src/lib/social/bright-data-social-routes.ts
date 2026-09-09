import type { BrightDataDatasetRoute } from "@/lib/social/bright-data-client"

/**
 * Endpoint IDs and modes verified in the Bright Data control panel on
 * 2026-07-13. IDs identify public Scraper API products, not tenant secrets.
 * Live promotion still requires the account-specific POC and schema fixtures.
 */
export const BRIGHT_DATA_SOCIAL_ROUTES: BrightDataDatasetRoute[] = [
  {
    platform: "instagram",
    capability: "DISCOVER_URLS",
    datasetId: "gd_lk5ns7kz21pck8jpis",
    operation: "DISCOVER",
    discoverBy: "url",
  },
  {
    platform: "instagram",
    capability: "ENRICH_CONTENT",
    datasetId: "gd_lk5ns7kz21pck8jpis",
    operation: "COLLECT",
  },
  {
    platform: "instagram",
    capability: "READ_COMMENTS",
    datasetId: "gd_ltppn085pokosxh13",
    operation: "COLLECT",
  },
  {
    platform: "instagram",
    capability: "READ_MEDIA",
    datasetId: "gd_lk5ns7kz21pck8jpis",
    operation: "COLLECT",
  },
  {
    platform: "instagram",
    capability: "UPDATE_METRICS",
    datasetId: "gd_lk5ns7kz21pck8jpis",
    operation: "COLLECT",
  },
  {
    platform: "facebook",
    capability: "DISCOVER_URLS",
    datasetId: "gd_lkaxegm826bjpoo9m5",
    operation: "COLLECT",
  },
  {
    platform: "facebook",
    capability: "ENRICH_CONTENT",
    datasetId: "gd_lyclm1571iy3mv57zw",
    operation: "COLLECT",
  },
  {
    platform: "facebook",
    capability: "READ_COMMENTS",
    datasetId: "gd_lkay758p1eanlolqw8",
    operation: "COLLECT",
  },
  {
    platform: "facebook",
    capability: "READ_MEDIA",
    datasetId: "gd_lyclm1571iy3mv57zw",
    operation: "COLLECT",
  },
  {
    platform: "facebook",
    capability: "UPDATE_METRICS",
    datasetId: "gd_lyclm1571iy3mv57zw",
    operation: "COLLECT",
  },
  {
    platform: "tiktok",
    capability: "DISCOVER_URLS",
    datasetId: "gd_lu702nij2f790tmv9h",
    operation: "DISCOVER",
    discoverBy: "keyword",
  },
  {
    platform: "tiktok",
    capability: "ENRICH_CONTENT",
    datasetId: "gd_lu702nij2f790tmv9h",
    operation: "COLLECT",
  },
  {
    platform: "tiktok",
    capability: "READ_COMMENTS",
    datasetId: "gd_lkf2st302ap89utw5k",
    operation: "COLLECT",
  },
  {
    platform: "tiktok",
    capability: "READ_MEDIA",
    datasetId: "gd_lu702nij2f790tmv9h",
    operation: "COLLECT",
  },
  {
    platform: "tiktok",
    capability: "UPDATE_METRICS",
    datasetId: "gd_lu702nij2f790tmv9h",
    operation: "COLLECT",
  },
]

export type BrightDataDiscoveryInputKind = "PROFILE_URL" | "KEYWORD"

export function brightDataDiscoveryInputKind(platform: string): BrightDataDiscoveryInputKind | null {
  if (platform.toLowerCase() === "tiktok") return "KEYWORD"
  if (["instagram", "facebook"].includes(platform.toLowerCase())) return "PROFILE_URL"
  return null
}
