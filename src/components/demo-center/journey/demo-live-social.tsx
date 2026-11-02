"use client"

import { useState } from "react"
import { Bot, ExternalLink, Facebook, Loader2, MessageCircle, Unplug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEMO_SOCIAL_CONSENT_TEXT, META_BUSINESS_INTEGRATIONS_URL } from "@/lib/demo-center/demo-social-consent"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"
import type { DemoLiveSocialHandle } from "./use-demo-live-social"

function bakuTime(iso: string): string {
  return new Intl.DateTimeFormat("az-AZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baku" }).format(new Date(iso))
}

/**
 * The prospect's own Facebook Page inside the demo (docs/DEMO_CENTER.md,
 * «Live social connections»): the offer and the consent line, Meta's dialog
 * in a new tab, the choice when several Pages were granted, and once one is
 * connected — its name, the end of the day, this session's code, a link to
 * write to the Page on Messenger, the conversation of the one person who wrote
 * with the code, and «Ayır». After «Ayır» (or the day's end) it says the Page
 * is being released, and where in Meta the person removes LeadDrive himself:
 * the authorization he gave stays with him.
 *
 * The state is read once for the page (./use-demo-live-social.ts) and shown here.
 */
export function DemoLiveSocial({ live }: { live: DemoLiveSocialHandle }) {
  const { state, busy, error } = live
  const [consent, setConsent] = useState(false)
  if (!state?.enabled) return null

  const connectForm = (label: string) => (
    <div className="mt-2 space-y-2">
      <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed">
        <input
          type="checkbox"
          data-testid="demo-social-consent"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-sky-600"
        />
        <span className="min-w-0 break-words">{DEMO_SOCIAL_CONSENT_TEXT}</span>
      </label>
      <Button
        size="sm"
        data-testid="demo-social-connect"
        onClick={() => {
          if (!consent || busy) return
          void live.connect()
        }}
        disabled={!consent || busy}
        className="h-auto min-h-8 whitespace-normal bg-sky-600 text-left hover:bg-sky-700"
      >
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin" /> : <Facebook className="mr-1 h-3.5 w-3.5 shrink-0" />} {label}
      </Button>
    </div>
  )

  const metaRemoval = (
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
      {S.socialRemoveAtMeta}{" "}
      <a
        data-testid="demo-social-business-integrations"
        href={META_BUSINESS_INTEGRATIONS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 font-medium text-sky-700 underline underline-offset-2 dark:text-sky-300"
      >
        {S.socialRemoveAtMetaLink} <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </p>
  )

  return (
    <div data-testid="demo-live-social" data-phase={state.phase} className="min-w-0 rounded-lg border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-500/40 dark:bg-sky-500/10">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <Facebook className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden="true" /> {S.socialTitle}
      </p>

      {state.phase === "offer" ? (
        <>
          {state.released ? (
            <div data-testid="demo-social-released" className="mt-2 rounded-md bg-background p-2">
              <p className="text-[11px] leading-relaxed">{S.socialReleased}</p>
              {metaRemoval}
            </div>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed">{S.socialOffer}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
            {S.socialOfferPoints.map((point) => <li key={point}>{point}</li>)}
          </ul>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{S.socialMetaAiNote}</p>
          {connectForm(S.socialConnect)}
        </>
      ) : null}

      {state.phase === "waiting" ? (
        <div data-testid="demo-social-waiting" className="mt-2 space-y-2">
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed">
            <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" aria-hidden="true" /> <span className="min-w-0">{S.socialWaiting}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {live.openUrl ? (
              <Button asChild size="sm" className="bg-sky-600 hover:bg-sky-700">
                <a data-testid="demo-social-open-facebook" href={live.openUrl} target="_blank" rel="noopener noreferrer">
                  <Facebook className="mr-1 h-3.5 w-3.5" /> {S.socialOpenFacebook}
                </a>
              </Button>
            ) : null}
            <Button size="sm" variant="outline" data-testid="demo-social-restart" disabled={busy} onClick={() => void live.connect()}>
              {S.socialRestart}
            </Button>
          </div>
        </div>
      ) : null}

      {state.phase === "choose" ? (
        <div data-testid="demo-social-choose" className="mt-2 space-y-2">
          <p className="text-[11px] leading-relaxed">{S.socialChoose}</p>
          <div className="flex flex-col gap-1.5">
            {state.pages.map((name, index) => (
              <Button
                key={`${index}-${name}`}
                size="sm"
                variant="outline"
                data-testid="demo-social-choose-page"
                disabled={busy}
                onClick={() => void live.choose(index)}
                className="h-auto min-h-8 justify-start whitespace-normal break-words text-left"
              >
                {S.socialChoosePage(name)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {state.phase === "refused" ? (
        <>
          <p data-testid="demo-social-refused" className="mt-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">{S.socialRefused}</p>
          {connectForm(S.socialReconnect)}
        </>
      ) : null}

      {state.phase === "connected" ? (
        <div data-testid="demo-social-connected" className="mt-2 space-y-2">
          <p className="break-words text-[11px] font-medium leading-relaxed">
            {S.socialConnected(state.pageName ?? "", state.until ? bakuTime(state.until) : "23:59")}
          </p>
          {state.code ? (
            <p data-testid="demo-social-code" className="break-words rounded-md bg-background px-2 py-1.5 text-[11px] leading-relaxed">
              {S.socialCode(state.code)}
            </p>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <a data-testid="demo-social-messenger" href={live.messengerHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-1 h-3.5 w-3.5" /> {S.socialWriteMessenger}
            </a>
          </Button>
          <p className="text-[10px] leading-relaxed text-muted-foreground">{S.socialOthersNote}</p>
          {state.proven ? (
            <div className="space-y-1.5" aria-live="polite">
              {state.messages.map((message, index) => (
                <div key={`${index}-${message.at}`} className={message.direction === "outbound" ? "flex justify-end" : "flex justify-start"}>
                  <span
                    className={
                      message.direction === "outbound"
                        ? "max-w-[85%] break-words rounded-lg bg-sky-600 px-2 py-1 text-[11px] leading-relaxed text-white"
                        : "max-w-[85%] break-words rounded-lg bg-background px-2 py-1 text-[11px] leading-relaxed"
                    }
                  >
                    {message.by === "ai" ? (
                      <span className="mb-0.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide opacity-80">
                        <Bot className="h-3 w-3" aria-hidden="true" /> {S.socialAiBadge}
                      </span>
                    ) : null}
                    {message.text}
                  </span>
                </div>
              ))}
              <p data-testid="demo-social-agent" className="text-[10px] leading-relaxed text-muted-foreground">
                {state.agentActive ? S.socialAgentActive(state.repliesLeft) : S.socialAgentDone}
              </p>
            </div>
          ) : (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {S.socialWaitingMessage}
            </p>
          )}
          <Button size="sm" variant="outline" data-testid="demo-social-disconnect" disabled={busy} onClick={() => void live.disconnect()}>
            <Unplug className="mr-1 h-3.5 w-3.5" /> {S.socialDisconnect}
          </Button>
        </div>
      ) : null}

      {state.phase === "releasing" ? (
        <div data-testid="demo-social-releasing" className="mt-2">
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed">
            <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
            <span className="min-w-0">{state.connectFailed ? S.socialConnectFailed : S.socialReleasing}</span>
          </p>
          {metaRemoval}
        </div>
      ) : null}

      {error ? (
        <p role="status" className="mt-2 break-words text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          {error}
        </p>
      ) : null}
    </div>
  )
}
