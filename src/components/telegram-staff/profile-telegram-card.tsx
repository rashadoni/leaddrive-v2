"use client"

/**
 * Profile → «Telegram»: link this employee's Telegram to the organization's
 * bot. «Telegram-ı bağla» opens a one-time t.me link (15 minutes); the bot's
 * «Start» finishes it. Approved as a mockup on 2026-10-25.
 *
 * On a computer the link is a QR code for the phone's camera (owner 2026-11-25: «я не буду делать
 * кустарно»): a Mac without the Telegram app opened t.me in a tab whose «START BOT» did nothing. On a
 * phone (coarse pointer, or no way to tell) the tab opens as before. While the code is on screen the
 * card asks every few seconds whether the link went through and turns into «linked» by itself.
 */
import { useCallback, useEffect, useState } from "react"
import QRCode from "qrcode"
import { startVisibleInterval } from "@/lib/client/visible-interval"
import { useTranslations } from "next-intl"
import { Send, Unlink } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"

interface LinkView {
  botConnected: boolean
  botUsername: string | null
  linked: boolean
  telegramUsername: string | null
}

/** A computer with a mouse: the link goes to the phone by QR. Unknown counts as a phone (old behaviour). */
function onComputer(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches
}

/** The one-time link lives 15 minutes; asking past that is pointless. */
const LINK_WATCH_MS = 15 * 60_000

async function fetchView(): Promise<LinkView | null> {
  const body = await fetch("/api/v1/profile/telegram", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
  return body?.success ? body.data : null
}

export function ProfileTelegramCard() {
  const t = useTranslations("telegramStaff")
  const [view, setView] = useState<LinkView | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState<string | null>(null)

  const load = useCallback(() => {
    void fetchView().then(setView)
  }, [])
  useEffect(load, [load])

  // While a code is on screen, learn about the «Start» on the phone without a click.
  const waiting = Boolean(link) && view?.linked === false
  useEffect(() => {
    if (!waiting) return
    const stop = startVisibleInterval(load, 3000)
    const timeout = window.setTimeout(stop, LINK_WATCH_MS)
    return () => {
      stop()
      window.clearTimeout(timeout)
    }
  }, [waiting, load])

  async function startLink() {
    if (onComputer()) {
      setBusy(true)
      const body = await fetch("/api/v1/profile/telegram", { method: "POST" }).then((r) => r.json()).catch(() => null)
      setBusy(false)
      if (!body?.success) return
      setLink(body.data.url)
      setQr(await QRCode.toDataURL(body.data.url, { margin: 1, width: 220 }).catch(() => null))
      return
    }
    // The tab is opened inside the tap and pointed at the link once it
    // arrives. Opened after the await, the window no longer counts as the
    // user's own and phone browsers block it (owner, 2026-10-25). If the
    // browser blocks even this, «Open again» below is a plain link.
    const tab = window.open("", "_blank")
    setBusy(true)
    const body = await fetch("/api/v1/profile/telegram", { method: "POST" }).then((r) => r.json()).catch(() => null)
    setBusy(false)
    if (body?.success) {
      setLink(body.data.url)
      if (tab) {
        tab.opener = null
        tab.location.href = body.data.url
      }
    } else {
      tab?.close()
    }
  }

  async function unlink() {
    setBusy(true)
    const body = await fetch("/api/v1/profile/telegram", { method: "DELETE" }).then((r) => r.json()).catch(() => null)
    setBusy(false)
    setLink(null)
    setQr(null)
    if (body?.success) setView(body.data)
  }

  if (!view) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" aria-hidden="true" />Telegram</CardTitle>
        <CardDescription>{view.botConnected ? t("profileDesc", { bot: `@${view.botUsername}` }) : t("profileNoBot")}</CardDescription>
      </CardHeader>
      {view.botConnected ? (
        <CardContent className="space-y-3">
          {view.linked ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{t("linkedAs", { user: view.telegramUsername ? `@${view.telegramUsername}` : t("yourAccount") })}</span>
              <Hint text={t("unlinkHint")}>
                <Button variant="outline" size="sm" onClick={() => void unlink()} disabled={busy}><Unlink className="h-4 w-4" aria-hidden="true" />{t("unlink")}</Button>
              </Hint>
            </div>
          ) : (
            <>
              <Hint text={t("linkHint")}>
                <Button onClick={() => void startLink()} disabled={busy}><Send className="h-4 w-4" aria-hidden="true" />{t("link")}</Button>
              </Hint>
              {link && qr ? (
                <div className="flex flex-wrap items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn here, nothing to optimise */}
                  <img src={qr} alt={t("qrAlt")} width={160} height={160} className="rounded-md border border-border bg-white p-1" />
                  <div className="max-w-xs space-y-2 text-sm text-muted-foreground">
                    <p>{t("scanQr")}</p>
                    <p>
                      <a href={link} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">{t("openHere")}</a>
                    </p>
                  </div>
                </div>
              ) : link ? (
                <p className="text-sm text-muted-foreground">
                  {t("linkOpened")}{" "}
                  <a href={link} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">{t("openAgain")}</a>
                  {" · "}
                  <button type="button" className="underline underline-offset-4" onClick={load}>{t("checkLinked")}</button>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("linkSteps")}</p>
              )}
            </>
          )}
        </CardContent>
      ) : null}
    </Card>
  )
}
