import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Prod 2026-09-14: the visit review grid and /mtm/photos tiles stayed grey for
 * seconds because every tile downloaded a 4080 px camera original. Tiles load
 * the proxy thumbnail; only the enlarged view loads the original.
 */
describe("field photo tiles use thumbnails", () => {
  const grid = readFileSync("src/components/mtm/visit-photo-grid.tsx", "utf8")
  const page = readFileSync("src/app/(dashboard)/mtm/photos/page.tsx", "utf8")
  const upload = readFileSync("src/app/api/v1/mtm/photos/route.ts", "utf8")

  it("visit grid (review + workspace) requests the thumbnail and opens the original", () => {
    expect(grid).toContain("src={photo.thumbnailUrl || mtmPhotoThumbnailUrl(photo.url)}")
    expect(grid).toContain('loading="lazy"')
    expect(grid).toContain('decoding="async"')
    expect(grid).toMatch(/width=\{480\}\s+height=\{480\}/)
    expect(grid).toContain("<img src={open.url}")
  })

  it("photos page tiles request thumbnails, the lightbox the original, and a missing file keeps its placeholder", () => {
    expect(page).toContain("src={mtmPhotoThumbnailUrl(photo.url, thumbnailWidth)}")
    expect(page).not.toContain("<img src={photo.url}")
    expect(page).toContain("<img src={lightboxPhoto.url}")
    expect(page).toContain("onError={() => onMissing(photo.id)}")
    expect(page).toContain("thumbnailWidth={960}")
  })

  it("new uploads record their thumbnail URL", () => {
    expect(upload).toContain("thumbnailUrl: mtmPhotoThumbnailUrl(url),")
  })
})
