/**
 * Field photo thumbnails — the URL half, safe for client components.
 *
 * Phone cameras upload 4080 px originals of 2–4 MB. A visit grid or the
 * /mtm/photos gallery showing twenty of them downloaded tens of megabytes to
 * paint 120 px tiles, and on prod 2026-09-14 the tiles stayed grey for
 * seconds. Tiles now ask the same scoped upload proxy for a resized copy:
 *
 *   /uploads/mtm-photos/<file>?w=480
 *
 * The proxy authorizes that request exactly like the original (tenant, MTM
 * module, field scope) and only then resizes. Widths are an allowlist so a
 * caller cannot mint an unbounded number of cache entries.
 */

export const MTM_PHOTO_THUMBNAIL_WIDTHS = [240, 480, 960] as const
export type MtmPhotoThumbnailWidth = typeof MTM_PHOTO_THUMBNAIL_WIDTHS[number]
export const DEFAULT_MTM_PHOTO_THUMBNAIL_WIDTH: MtmPhotoThumbnailWidth = 480

const MTM_PHOTO_URL = /^\/uploads\/mtm-photos\/[^/?#\\]+$/

/**
 * Thumbnail URL for a stored photo URL. Anything that is not a plain
 * `/uploads/mtm-photos/<file>` path (empty, external, already carrying a
 * query) is returned unchanged, so a caller can always use the result as the
 * image source.
 */
export function mtmPhotoThumbnailUrl(
  url: string,
  width: MtmPhotoThumbnailWidth = DEFAULT_MTM_PHOTO_THUMBNAIL_WIDTH,
): string {
  if (!MTM_PHOTO_URL.test(url)) return url
  return `${url}?w=${width}`
}

/**
 * Parses the `w` query parameter of an upload-proxy request.
 * - `null`: no thumbnail requested, serve the original;
 * - `"invalid"`: a width outside the allowlist (or repeated/garbled);
 * - a width: serve that thumbnail.
 */
export function parseMtmPhotoThumbnailWidth(
  searchParams: URLSearchParams,
): MtmPhotoThumbnailWidth | "invalid" | null {
  const values = searchParams.getAll("w")
  if (values.length === 0) return null
  if (values.length !== 1 || !/^\d{1,4}$/.test(values[0] ?? "")) return "invalid"
  const width = Number(values[0])
  return (MTM_PHOTO_THUMBNAIL_WIDTHS as readonly number[]).includes(width)
    ? width as MtmPhotoThumbnailWidth
    : "invalid"
}
