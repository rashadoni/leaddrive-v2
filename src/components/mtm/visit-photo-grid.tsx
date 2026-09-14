"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { mtmPhotoThumbnailUrl } from "@/lib/mtm/photo-thumbnail-url"
import { PhotoThumbnailImg } from "@/components/mtm/photo-thumbnail-img"

export interface VisitPhoto {
  id: string
  url: string
  thumbnailUrl?: string | null
  createdAt?: string | null
}

/**
 * Visit photos as thumbnails; a click opens the full image. Thumbnails keep a
 * fixed square so a portrait shelf shot and a landscape display do not make
 * the row jump, and they load lazily because a visit may carry many.
 *
 * Tiles request a server-resized copy (`?w=480`, ~30 KB) instead of the
 * 4080 px camera original (2–4 MB); the dialog still opens the original.
 */
export function VisitPhotoGrid({ photos, formatTime, openLabel, titleLabel }: {
  photos: readonly VisitPhoto[]
  formatTime: (value: string) => string
  /** Accessible name for one thumbnail button, e.g. "Open photo 2". */
  openLabel: (index: number) => string
  titleLabel: (index: number) => string
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const open = openIndex == null ? null : photos[openIndex] ?? null

  if (photos.length === 0) return null
  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" data-testid="mtm-visit-photo-grid">
        {photos.map((photo, index) => (
          <li key={photo.id} className="min-w-0">
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              aria-label={openLabel(index + 1)}
              className="group block w-full overflow-hidden rounded-lg border border-zinc-200 bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-zinc-800"
            >
              <PhotoThumbnailImg
                src={photo.thumbnailUrl || mtmPhotoThumbnailUrl(photo.url)}
                alt=""
                width={480}
                height={480}
                loading="lazy"
                decoding="async"
                className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.02] motion-reduce:transition-none"
              />
            </button>
            {photo.createdAt ? <p className="mt-1 truncate text-xs tabular-nums text-muted-foreground">{formatTime(photo.createdAt)}</p> : null}
          </li>
        ))}
      </ul>
      <Dialog open={open !== null} onOpenChange={(next) => { if (!next) setOpenIndex(null) }} widthClassName="max-w-5xl" maxHeightClassName="max-h-[92vh]">
        {open && openIndex != null ? (
          <>
            <DialogHeader>
              <DialogTitle>{titleLabel(openIndex + 1)}</DialogTitle>
              {open.createdAt ? <p className="mt-1 text-sm tabular-nums text-muted-foreground">{formatTime(open.createdAt)}</p> : null}
            </DialogHeader>
            <DialogContent className="pt-2">
              <img src={open.url} alt="" className="mx-auto max-h-[75vh] w-auto max-w-full rounded-md object-contain" />
            </DialogContent>
          </>
        ) : null}
      </Dialog>
    </>
  )
}
