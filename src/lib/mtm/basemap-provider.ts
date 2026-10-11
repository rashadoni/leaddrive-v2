import { escapeTileAttribution, tileUrlTemplate, type LiveMapBaseMapTiles } from "@/lib/mtm/live-map-base-maps"

/**
 * Whose tiles the MTM maps are drawn on when they are not CARTO's.
 *
 * Every MTM map has one background, CARTO's (src/components/mtm/carto-basemap.tsx).
 * On 29 September 2026 CARTO put it under new terms: free for a business up
 * to a million tile requests a month, and the free service may be slowed or
 * cut off at any time, above the limit or for no reason, without warning
 * (its terms, sections 3.c and 12.e). A refused background is a grey map for
 * every dispatcher of every tenant at once, and until now the only way out
 * was a release.
 *
 * So the deployment can name a second provider, the «backup», and it is used
 * in two ways:
 *
 *  - by itself: a map whose CARTO tiles are refused — several in a row, and
 *    more refused than drawn on the screen it shows — goes over to the backup
 *    then and there, and the browser remembers it for half an hour so the
 *    next map does not ask CARTO again;
 *  - on purpose: `MTM_BASEMAP_PRIMARY=backup` makes the backup the background
 *    of every map, and CARTO is not asked at all (a key that was revoked is
 *    answered with a tile that reads «API KEY REQUIRED» — a picture, not an
 *    error, which no map can notice by itself).
 *
 * The settings are read by the SERVER when a page is asked for and handed to
 * the browser in a <meta> of the document (src/app/layout.tsx) — not built
 * into the bundle. That is the whole point: they are changed on the running
 * deployment by an operator job (.github/workflows/set-map-provider.yml),
 * in a couple of minutes, with no build and no release; a page that is
 * already open asks the server again (basemap-provider-store.ts). The address carries
 * the provider's browser-facing key, as CARTO's does; it must be a key
 * restricted to this application's sites.
 *
 * Pure: no React, no Leaflet. docs/mtm-basemap-provider.md says how to use it.
 */

export const BASEMAP_PROVIDER_META = "leaddrive-basemap"

export type BasemapPrimary = "carto" | "backup"

export interface BasemapBackup {
  url: string
  /** Plain words, as the provider asks to be credited; escaped where they become HTML. */
  attribution: string
  /** 512 for providers whose tiles are twice the classic size (the layer then asks one zoom lower). */
  tileSize: 256 | 512
}

export interface BasemapProvider {
  /** "backup" only when there is a backup to use. */
  primary: BasemapPrimary
  backup: BasemapBackup | null
}

export const CARTO_ONLY: BasemapProvider = { primary: "carto", backup: null }

const ATTRIBUTION_MAX_LENGTH = 300

function backupFrom(url: unknown, attribution: unknown, tileSize: unknown): BasemapBackup | null {
  const address = tileUrlTemplate(typeof url === "string" ? url : null)
  const credit = typeof attribution === "string" ? attribution.trim() : ""
  // Whose map it is must be said on the map: an address without the words is not a provider.
  if (!address || !credit || credit.length > ATTRIBUTION_MAX_LENGTH) return null
  const size = String(tileSize ?? "").trim()
  if (size !== "" && size !== "256" && size !== "512") return null
  return { url: address, attribution: credit, tileSize: size === "512" ? 512 : 256 }
}

function providerFrom(primary: unknown, backup: BasemapBackup | null): BasemapProvider {
  return { primary: backup && String(primary ?? "").trim().toLowerCase() === "backup" ? "backup" : "carto", backup }
}

/**
 * What this deployment says, read from the server's own environment at the
 * moment a page is asked for. Anything half-said — an address without its
 * credit, a size that is not a size — is no backup at all.
 */
export function basemapProviderFromEnv(env: Record<string, string | undefined> = process.env): BasemapProvider {
  return providerFrom(
    env.MTM_BASEMAP_PRIMARY,
    backupFrom(env.MTM_BASEMAP_BACKUP_TILE_URL, env.MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION, env.MTM_BASEMAP_BACKUP_TILE_SIZE),
  )
}

/** What goes into the document for the browser; null when there is nothing to say, and then no tag is written. */
export function serializeBasemapProvider(provider: BasemapProvider): string | null {
  if (!provider.backup) return null
  return JSON.stringify({ primary: provider.primary, ...provider.backup })
}

/** What a document says, checked again as if a stranger had written it. Unreadable is «CARTO only». */
export function parseBasemapProvider(raw: string | null | undefined): BasemapProvider {
  if (!raw) return CARTO_ONLY
  try {
    const said = JSON.parse(raw) as Record<string, unknown> | null
    if (!said || typeof said !== "object" || Array.isArray(said)) return CARTO_ONLY
    return providerFrom(said.primary, backupFrom(said.url, said.attribution, said.tileSize))
  } catch {
    return CARTO_ONLY
  }
}

/**
 * What the page a map stands on was told. Outside a browser there is nobody
 * to tell. Read from the document's head only — where the server writes it:
 * a tag of the same name that found its way into the body is not the server's.
 */
export function basemapProviderFromDocument(doc: Document | null = typeof document === "undefined" ? null : document): BasemapProvider {
  return parseBasemapProvider(doc?.head?.querySelector(`meta[name="${BASEMAP_PROVIDER_META}"]`)?.getAttribute("content"))
}

/** What the server answers at BASEMAP_PROVIDER_PATH, checked as the document's tag is. */
export function basemapProviderFromAnswer(answer: unknown): BasemapProvider {
  const data = answer && typeof answer === "object" ? (answer as { data?: unknown }).data : null
  if (!data || typeof data !== "object") return CARTO_ONLY
  const said = data as { primary?: unknown; backup?: unknown }
  const backup = said.backup && typeof said.backup === "object" ? said.backup as Record<string, unknown> : null
  return providerFrom(said.primary, backup ? backupFrom(backup.url, backup.attribution, backup.tileSize) : null)
}

/**
 * Where a page that is already open asks what the deployment says now. The
 * document's tag is written once, when the page is loaded, and an app that is
 * navigated without reloading keeps the same document for days.
 */
export const BASEMAP_PROVIDER_PATH = "/api/v1/public/basemap-provider"

export function sameBasemapProvider(one: BasemapProvider, other: BasemapProvider): boolean {
  return JSON.stringify(one) === JSON.stringify(other)
}

/** The backup as a tile layer takes it: the credit as HTML, the address as given. */
export function basemapBackupTiles(backup: BasemapBackup): LiveMapBaseMapTiles & { tileSize: 256 | 512 } {
  return { url: backup.url, attribution: escapeTileAttribution(backup.attribution), tileSize: backup.tileSize }
}

/**
 * How many tiles in a row a provider must refuse before a map takes it for a
 * refusal of service. One bad tile is a bad tile; four in a row, with more
 * refused than drawn, is a refusal.
 */
export const BASEMAP_FAILOVER_AFTER_REFUSALS = 4

/** How long a browser keeps to the backup after CARTO refused it, before asking CARTO again. */
export const BASEMAP_FAILOVER_MEMORY_MS = 30 * 60_000

const FAILOVER_KEY = "leaddrive.mtm.basemap.failover.v1"

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

// A browser that will keep nothing (storage refused) still must not swing
// between the two providers at every move of the map: the page itself remembers.
let rememberedUntil = 0

/** Remembered for this tab only: another tab, or tomorrow, asks CARTO first again. */
export function rememberBasemapFailover(now: number = Date.now()): void {
  rememberedUntil = now + BASEMAP_FAILOVER_MEMORY_MS
  try {
    sessionStore()?.setItem(FAILOVER_KEY, String(rememberedUntil))
  } catch {
    // Kept by the page alone, then.
  }
}

/** The backup refused as well: nothing is gained by keeping to it. */
export function forgetBasemapFailover(): void {
  rememberedUntil = 0
  try {
    sessionStore()?.removeItem(FAILOVER_KEY)
  } catch {
    // Nothing was kept there.
  }
}

export function basemapFailoverRemembered(now: number = Date.now()): boolean {
  if (rememberedUntil > now) return true
  try {
    const until = Number(sessionStore()?.getItem(FAILOVER_KEY))
    return Number.isFinite(until) && until > now
  } catch {
    return false
  }
}
