"use client"

/**
 * Profile → «Telegram»: link this employee's Telegram to the organization's
 * bot. «Telegram-ı bağla» opens a one-time t.me link (15 minutes); the bot's
 * «Start» finishes it. Approved as a mockup on 2026-10-25.
 */
import { useCallback, useEffect, useState } from "react"
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

async function fetchView(): Promise<LinkView | null> {
  const body = await fetch("/api/v1/profile/telegram", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
  return body?.success ? body.data : null
}

export function ProfileTelegramCard() {
  const t = useTranslations("telegramStaff")
  const [view, setView] = useState<LinkView | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    void fetchView().then(setView)
  }, [])
  useEffect(load, [load])

  async function startLink() {
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
              {link ? (
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
