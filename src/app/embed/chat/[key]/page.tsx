import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { isWidgetOnline } from "@/lib/widget-hours"
import { parsePreChatForm } from "@/lib/web-chat-prechat"
import { organizationLocale } from "@/lib/ticketing/customer-locale"
import { EmbedChatClient } from "./embed-chat-client"
import { chosenWidgetLang, widgetGreeting, widgetTitle } from "./widget-i18n"

export const dynamic = "force-dynamic"

export default async function EmbedChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { key } = await params
  const sp = await searchParams
  // RLS: public widget key → org resolution (external identifier) → bypass scope.
  const widget = await runWithRlsBypass(() =>
    prisma.webChatWidget.findUnique({
      where: { publicKey: key },
      include: { organization: { select: { name: true, settings: true } } },
    })
  )

  if (!widget || !widget.enabled) notFound()

  const online = isWidgetOnline(widget.workingHours)
  // The page's data-lang, else the organization's language — not English: the embed code the
  // CRM gives tenants sets none (web-chat-visitor-language.ts).
  const chosenLang = chosenWidgetLang(sp?.lang)
  const lang = chosenLang ?? organizationLocale(widget.organization.settings)

  // RLS: org resolved — render runs tenant-scoped (no further queries today;
  // any future data added to this render inherits the correct scope).
  return runWithTenant(widget.organizationId, () => (
    <EmbedChatClient
      publicKey={widget.publicKey}
      title={widgetTitle(widget.title, lang)}
      greeting={widgetGreeting(widget.greeting, lang)}
      primaryColor={widget.primaryColor}
      organizationName={widget.organization.name}
      online={online}
      offlineMessage={widget.offlineMessage}
      lang={lang}
      langChosen={chosenLang !== null}
      preChatForm={parsePreChatForm(widget.preChatForm)}
      uiOptions={(widget.uiOptions as { onboardingEnabled?: boolean; historyEnabled?: boolean; customQuestions?: string[] } | null) ?? undefined}
    />
  ))
}
