"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Circle, ChevronDown, ChevronUp, ExternalLink, Link as LinkIcon } from "lucide-react"

interface Props {
  hasFacebook: boolean
  hasInstagram: boolean
  defaultOpen?: boolean
}

export function SocialOnboardingChecklist({ hasFacebook, hasInstagram, defaultOpen }: Props) {
  const t = useTranslations("socialMonitoring")
  const fullyDone = hasFacebook && hasInstagram
  const [open, setOpen] = useState(defaultOpen ?? !fullyDone)

  // Everything connected → a minimal confirmation bar. Returned regardless of `open`, so the
  // "accounts load after mount" race (open initialised true while fullyDone flips true only later)
  // can't leave an empty card with no incomplete steps to render.
  if (fullyDone) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-300" />
        </span>
        {t("onboardingDoneShort")}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-700">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <div className="text-left">
          <h3 className="text-sm font-semibold">{t("onboardingTitle")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("onboardingSubtitle")}
          </p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t px-4 py-4 space-y-3">
          {/* Only INCOMPLETE steps render — a completed step disappears (not struck-through). Step 1
              ("has a Facebook Page") is a prerequisite, always satisfied here, so it never shows. */}
          {!hasInstagram && (
            <Step
              title={t("onboardingStep2")}
              help={t.rich("onboardingStep2Help", {
                b: (chunks) => <b>{chunks}</b>,
                a: (chunks) => (
                  <a href="https://help.instagram.com/176235449218188" target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5 hover:underline">
                    {chunks} <ExternalLink className="h-3 w-3" />
                  </a>
                ),
              })}
            />
          )}
          {!hasFacebook && (
            <Step
              title={t("onboardingStep3")}
              help={t.rich("onboardingStep3Help", { b: (chunks) => <b>{chunks}</b> })}
              action={
                <a
                  href="/api/v1/social/oauth/facebook/start"
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.97]"
                >
                  <LinkIcon className="h-3 w-3" /> {t("connectFacebookPage")}
                </a>
              }
            />
          )}
          {!hasFacebook && (
            <Step
              title={t("onboardingStep4")}
              help={t.rich("onboardingStep4Help", { b: (chunks) => <b>{chunks}</b> })}
            />
          )}

          <div className="pt-2 mt-1 border-t text-[11px] text-muted-foreground">
            {t("onboardingNote")}
          </div>
        </div>
      )}
    </div>
  )
}

// Renders an INCOMPLETE onboarding step only (completed steps are filtered out upstream, so there's
// no done/strikethrough state here).
function Step({
  title,
  help,
  action,
}: {
  title: string
  help: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 mt-0.5">
        <Circle className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{help}</p>
        {action && <div className="pt-1.5">{action}</div>}
      </div>
    </div>
  )
}
