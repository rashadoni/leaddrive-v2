"use client"

/**
 * A photo in a conversation of the inbox: a thumbnail that opens the photo on the whole window.
 *
 * Until 2026-11-19 the thumbnail was a bare `<img>` cut to 192 px with `object-cover`, and a click
 * did nothing — a customer's photo of a receipt, a prescription or a broken product could not be
 * read in the CRM at all (client report: «фотография не увеличивается при нажатии»). The window
 * shows the whole photo (`object-contain`, never cropped) and links the original for download.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import { ExternalLink } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export function MessagePhoto({ src, title }: { src: string; title?: string }) {
  const t = useTranslations("inboxV2")
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("photoOpen")}
        title={t("photoOpen")}
        data-testid="inbox-photo-thumb"
        className="mb-1 block cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img loading="lazy" decoding="async" src={src} alt="attachment" className="max-h-48 rounded-lg object-cover" />
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        widthClassName="max-w-5xl"
        maxHeightClassName="max-h-[calc(100dvh-2rem)]"
      >
        {open ? (
          <>
            <DialogHeader className="pb-2">
              <DialogTitle className="truncate text-sm">{title || t("photoViewerTitle")}</DialogTitle>
            </DialogHeader>
            <DialogContent className="flex items-center justify-center bg-black/90 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                data-testid="inbox-photo-full"
                className="max-h-[calc(100dvh-12rem)] w-auto max-w-full object-contain"
              />
            </DialogContent>
            <DialogFooter>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="mr-auto inline-flex items-center gap-1.5 self-center text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" /> {t("photoOpenOriginal")}
              </a>
              <Button variant="outline" onClick={() => setOpen(false)}>{t("photoClose")}</Button>
            </DialogFooter>
          </>
        ) : null}
      </Dialog>
    </>
  )
}
