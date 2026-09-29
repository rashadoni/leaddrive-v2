"use client"

/**
 * In-app help drawer.
 *
 * Right-side slide-out (shadcn Sheet) that loads an article from
 * `src/content/help/<slug>/<locale>.tsx` based on the current next-intl
 * locale. Articles are lazy-loaded so unused ones don't bloat the
 * initial page JS.
 *
 * Designed to be opened by `<HelpButton slug="..." />` but can be
 * controlled directly via the `open`/`onOpenChange` props if a parent
 * page needs to surface help from a different trigger.
 */
import { Suspense, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ArrowLeft, BookOpenText, Loader2, Video } from "lucide-react"
import {
  resolveHelpArticle,
  type HelpLocale,
  type HelpSlug,
} from "@/content/help/registry"
import { getHelpVideoForSlug, normalizeHelpVideoLocale } from "@/content/help/video-assets"
import { locales } from "@/i18n/routing"

const SUPPORTED: ReadonlySet<HelpLocale> = new Set(locales)

function toHelpLocale(raw: string): HelpLocale {
  return SUPPORTED.has(raw as HelpLocale) ? (raw as HelpLocale) : "en"
}

const VIDEO_LABEL: Record<HelpLocale, string> = {
  az: "Video",
  en: "Video",
  ru: "Видео",
}

const HELP_GUIDE_LABEL: Record<HelpLocale, string> = {
  az: "Kömək haqqında",
  en: "About Help",
  ru: "О справке",
}

const BACK_TO_ARTICLE_LABEL: Record<HelpLocale, string> = {
  az: "Bölmə təlimatına qayıt",
  en: "Back to section guide",
  ru: "Назад к справке раздела",
}

interface HelpDrawerProps {
  slug: HelpSlug
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HelpDrawer({ slug, open, onOpenChange }: HelpDrawerProps) {
  const rawLocale = useLocale()
  const locale = toHelpLocale(rawLocale)
  const t = useTranslations("nav")
  const [activeSlug, setActiveSlug] = useState<HelpSlug>(slug)
  const resolved = resolveHelpArticle(activeSlug, locale)

  if (!resolved) {
    // Unknown slug → silently no-op rather than crash; surfaces in dev only.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[HelpDrawer] No article registered for slug="${activeSlug}"`)
    }
    return null
  }

  const { component: ArticleComponent, title, subtitle, locale: rendered } = resolved
  const videoEntry = getHelpVideoForSlug(activeSlug, normalizeHelpVideoLocale(locale))

  function handleOpenChange(nextOpen: boolean) {
    // Switching to the general guide is local to one drawer session. Reset on
    // close so the next open always starts with the caller's section article.
    if (!nextOpen) setActiveSlug(slug)
    onOpenChange(nextOpen)
  }

  function openVideo() {
    if (!videoEntry) return

    window.dispatchEvent(
      new CustomEvent("leaddrive:open-help-video", {
        detail: { slug: videoEntry.slug },
      })
    )
    handleOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b px-6 py-4 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-base">{title}</SheetTitle>
              <SheetDescription className="text-xs">{subtitle}</SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {videoEntry && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openVideo}
                >
                  <Video className="h-3.5 w-3.5" />
                  {VIDEO_LABEL[locale]}
                </Button>
              )}
              {activeSlug === slug && slug !== "help-center" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveSlug("help-center")}
                >
                  <BookOpenText className="h-3.5 w-3.5" />
                  {HELP_GUIDE_LABEL[locale]}
                </Button>
              ) : activeSlug !== slug ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveSlug(slug)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {BACK_TO_ARTICLE_LABEL[locale]}
                </Button>
              ) : null}
            </div>
          </div>
          {rendered !== locale && (
            <p className="text-[0.65rem] text-amber-600 dark:text-amber-400 pt-1">
              {t("helpFallbackBanner")}
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading…
              </div>
            }
          >
            <ArticleComponent />
          </Suspense>
        </div>
      </SheetContent>
    </Sheet>
  )
}
