"use client"

/**
 * «First time here — watch the video?» (owner, 2026-11-09: «каждый кто первый
 * раз заходит на какой-то раздел, чтоб ему была выдана подсказка всплывающая,
 * которая предлагает смотреть видео гайд»; mockup approved «Давай, по макету»).
 *
 * Once per section and per person: the sections already offered are kept in
 * the person's own preferences on the server (users/me/preferences →
 * helpVideoSeen), so another browser or device does not offer them again.
 * Either button counts as «shown». «Watch» opens the same player the in-flow
 * «Video tutorial» card opens; that card stays, so the video is still one
 * click away later.
 *
 * A page's first-visit tour waits while this is undecided or open
 * (TourProvider.holdAutoTours) — a newcomer meets one window, then the other.
 * If the server could not say what was already offered, nothing is shown: a
 * prompt that comes back on every visit is worse than none.
 */
import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { usePathname } from "next/navigation"
import { Play, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTour } from "@/components/tour/tour-provider"
import { useLauncherPrefs } from "@/contexts/launcher-prefs-context"
import { matchNavItem } from "@/lib/nav-items"
import {
  getHelpVideoAsset,
  getHelpVideoForPath,
  isHelpVideoAvailable,
  normalizeHelpVideoLocale,
} from "@/content/help/video-assets"

const LABELS = {
  az: {
    eyebrow: "Video dərslik",
    title: (section: string | null) => (section ? `«${section}» bölməsində ilk dəfəsiniz` : "Bu bölmədə ilk dəfəsiniz"),
    body: "Bu bölmədə necə işləmək lazım olduğunu qısa videoda göstəririk. Sonra da yuxarıdakı «Video dərslik» kartından aça bilərsiniz.",
    watch: "Videoya bax",
    later: "Sonra",
  },
  ru: {
    eyebrow: "Видео-инструкция",
    title: (section: string | null) => (section ? `Вы впервые в разделе «${section}»` : "Вы впервые в этом разделе"),
    body: "Коротко показываем в видео, как работать в этом разделе. Позже его можно открыть из карточки «Видео-инструкция» вверху.",
    watch: "Смотреть видео",
    later: "Позже",
  },
  en: {
    eyebrow: "Video tutorial",
    title: (section: string | null) => (section ? `First time in «${section}»` : "First time in this section"),
    body: "A short video shows how this section works. You can open it later from the «Video tutorial» card at the top.",
    watch: "Watch video",
    later: "Later",
  },
} as const

export type FirstVisitPromptState = "none" | "wait" | "show"

/**
 * `wait` holds the page's tour until the server says whether this section
 * was offered already; `show` is the prompt; `none` lets everything run.
 */
export function firstVisitPromptState(
  slug: string | null,
  seen: ReadonlySet<string> | null,
  closedSlug: string | null,
  serverUnavailable: boolean,
): FirstVisitPromptState {
  if (!slug || closedSlug === slug || serverUnavailable) return "none"
  if (!seen) return "wait"
  return seen.has(slug) ? "none" : "show"
}

/** How long a section waits for the server before giving up on the prompt. */
const SEEN_WAIT_MS = 6000

export function HelpVideoFirstVisitPrompt() {
  const pathname = usePathname()
  const locale = normalizeHelpVideoLocale(useLocale())
  const tNav = useTranslations("nav")
  const { helpVideoSeen, markHelpVideoSeen } = useLauncherPrefs()
  const { holdAutoTours } = useTour()
  const [closedSlug, setClosedSlug] = useState<string | null>(null)
  const [gaveUp, setGaveUp] = useState(false)

  const entry = useMemo(() => {
    if (!pathname || pathname.startsWith("/settings/channels")) return null
    return getHelpVideoForPath(pathname, locale)
  }, [pathname, locale])
  const assets = entry && isHelpVideoAvailable(entry, locale) ? getHelpVideoAsset(entry, locale) : null
  const slug = assets && entry ? entry.slug : null

  const navItem = pathname ? matchNavItem(pathname) : undefined
  const section = navItem ? tNav(navItem.tKey) : null

  const state = firstVisitPromptState(slug, helpVideoSeen, closedSlug, gaveUp)

  // The server is slow or down: stop holding the tour and do not prompt.
  useEffect(() => {
    if (state !== "wait") return
    const timer = setTimeout(() => setGaveUp(true), SEEN_WAIT_MS)
    return () => clearTimeout(timer)
  }, [state])

  useEffect(() => {
    holdAutoTours(state !== "none")
  }, [state, holdAutoTours])
  useEffect(() => () => holdAutoTours(false), [holdAutoTours])

  // Either answer counts as «offered»: the prompt never comes back here.
  function close(openVideo: boolean) {
    if (!slug) return
    markHelpVideoSeen(slug)
    setClosedSlug(slug)
    if (openVideo) window.dispatchEvent(new CustomEvent("leaddrive:open-help-video", { detail: { slug } }))
  }
  const later = () => close(false)
  const watch = () => close(true)

  useEffect(() => {
    if (state !== "show" || !slug) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      markHelpVideoSeen(slug!)
      setClosedSlug(slug)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [state, slug, markHelpVideoSeen])

  if (state !== "show" || !slug || !assets) return null
  const labels = LABELS[locale]

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={later}
      data-testid="help-video-first-visit"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-video-first-visit-title"
        className="w-[min(380px,100%)] overflow-hidden rounded-xl border border-border/70 bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={watch}
          className="group relative block aspect-video w-full overflow-hidden bg-muted"
          aria-label={labels.watch}
        >
          <Image src={assets.posterSrc} alt="" fill sizes="380px" unoptimized className="object-cover" />
          <span className="absolute inset-0 bg-black/15 transition group-hover:bg-black/25" aria-hidden="true" />
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition group-hover:scale-110">
              <Play className="h-5 w-5 fill-current" />
            </span>
          </span>
        </button>
        <div className="px-4 pb-4 pt-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Video className="h-3.5 w-3.5" />
            <span>{labels.eyebrow}</span>
          </div>
          <h2 id="help-video-first-visit-title" className="mt-1 text-base font-semibold leading-6">
            {labels.title(section)}
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{labels.body}</p>
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={watch} className="gap-1.5" data-testid="help-video-first-visit-watch">
              <Play className="h-4 w-4 fill-current" />
              {labels.watch}
            </Button>
            <Button type="button" variant="outline" onClick={later} data-testid="help-video-first-visit-later">
              {labels.later}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
