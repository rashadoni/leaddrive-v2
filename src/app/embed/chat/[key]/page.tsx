import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { isWidgetOnline } from "@/lib/widget-hours"
import { parsePreChatForm } from "@/lib/web-chat-prechat"
import { EmbedChatClient } from "./embed-chat-client"
import { resolveWidgetLang } from "./widget-i18n"

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
      include: { organization: { select: { name: true } } },
    })
  )

  if (!widget || !widget.enabled) notFound()

  const online = isWidgetOnline(widget.workingHours)
  const lang = resolveWidgetLang(sp?.lang)

  // RLS: org resolved — render runs tenant-scoped (no further queries today;
  // any future data added to this render inherits the correct scope).
  return runWithTenant(widget.organizationId, () => (
    <EmbedChatClient
      publicKey={widget.publicKey}
      title={widget.title}
      greeting={widget.greeting}
      primaryColor={widget.primaryColor}
      organizationName={widget.organization.name}
      online={online}
      offlineMessage={widget.offlineMessage}
      lang={lang}
      preChatForm={parsePreChatForm(widget.preChatForm)}
      uiOptions={(widget.uiOptions as { onboardingEnabled?: boolean; historyEnabled?: boolean; customQuestions?: string[] } | null) ?? undefined}
    />
  ))
}
