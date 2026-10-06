"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/format-date"
import type { MtmRouteRecord } from "@/components/mtm/route-types"
import { routesAwaitingPublish } from "@/lib/mtm/routes-awaiting-publish"

/** As many as fit without pushing the page's own content off the screen. */
const SHOWN = 5

/**
 * Route & Field → Routes: «these routes are waiting for you», above everything
 * else, with the one action that ends the wait next to each of them (see
 * lib/mtm/routes-awaiting-publish.ts for why). Shown only to someone who can
 * publish; an agent's own drafts are the field app's business.
 */
export function MtmRoutesAwaitingPublish({
  routes,
  todayKey,
  canPublish,
  onOpen,
  onPublish,
}: {
  routes: readonly MtmRouteRecord[]
  todayKey: string
  canPublish: boolean
  onOpen: (route: MtmRouteRecord) => void
  onPublish: (route: MtmRouteRecord) => Promise<void> | void
}) {
  const t = useTranslations("mtmRoutesPage")
  const locale = useLocale()
  const [publishing, setPublishing] = useState<string | null>(null)
  const waiting = canPublish ? routesAwaitingPublish(routes, todayKey) : []
  if (waiting.length === 0) return null

  const publish = async (route: MtmRouteRecord) => {
    setPublishing(route.id)
    try {
      await onPublish(route)
    } finally {
      setPublishing(null)
    }
  }

  return (
    <section
      data-testid="mtm-routes-awaiting-publish"
      aria-labelledby="mtm-routes-awaiting-publish-title"
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30"
    >
      <h2 id="mtm-routes-awaiting-publish-title" className="text-sm font-semibold text-amber-950 dark:text-amber-100">
        {t("awaitingTitle", { count: waiting.length })}
      </h2>
      <p className="mt-0.5 text-xs text-amber-900 dark:text-amber-200">{t("awaitingBody")}</p>
      <ul className="mt-2 divide-y divide-amber-200 dark:divide-amber-900">
        {waiting.slice(0, SHOWN).map(({ route, agentName, stops }) => (
          <li
            key={route.id}
            data-testid={`mtm-route-awaiting-${route.id}`}
            className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="min-w-0 text-sm">
              <span className="font-medium">{agentName}</span>
              <span className="text-muted-foreground">
                {" · "}{formatDate(new Date(route.date), locale, { weekday: "short", day: "numeric", month: "long" })}
                {" · "}{t("awaitingStops", { count: stops })}
              </span>
            </p>
            <div className="flex shrink-0 gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => onOpen(route)}>{t("awaitingOpen")}</Button>
              <Button type="button" size="sm" disabled={publishing !== null} onClick={() => { void publish(route) }}>
                <Send className="mr-1 h-4 w-4" aria-hidden="true" />
                {publishing === route.id ? t("publishing") : t("publishRoute")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {waiting.length > SHOWN ? (
        <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">{t("awaitingMore", { count: waiting.length - SHOWN })}</p>
      ) : null}
    </section>
  )
}
