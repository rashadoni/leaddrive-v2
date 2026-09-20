import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withSocialConnectAuth } from "@/lib/social/oauth-access"
import { subscribePageToMessages } from "@/lib/social/meta-subscribe"

/**
 * Subscribe ONE named Facebook Page to this app's `messages` webhook — deliberately, by id.
 *
 * Why this is a separate, explicit action. The OAuth callback subscribes automatically, and it loops
 * over every Page the connecting Meta user administers — which is right for an ordinary connect and
 * wrong for a staged app under review, where the same loop would move real customers' DM delivery
 * onto an app still in development. Staged connects therefore subscribe nothing
 * (`ensureInboxChannelForPage`, option `staged`), and this endpoint is how a single, chosen Page is
 * then wired: one config row, named by the operator, one Graph call.
 *
 * It subscribes the Page to whichever app minted the stored page token — the token IS the app
 * binding, so there is no way for this call to attach a Page to an app the operator did not connect
 * it through. No secret is read or returned; the page token goes out in the POST body, never a URL
 * (see meta-subscribe.ts) and is never logged.
 */
const bodySchema = z.object({ configId: z.string().min(1) })

export const POST = withSocialConnectAuth("write", async (req, auth) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "configId is required" }, { status: 400 })
  }

  const cfg = await prisma.channelConfig.findFirst({
    where: { id: parsed.data.configId, organizationId: auth.orgId },
    select: { id: true, channelType: true, pageId: true, apiKey: true, settings: true, configName: true },
  })
  if (!cfg) return NextResponse.json({ error: "Channel configuration not found" }, { status: 404 })

  if (cfg.channelType !== "facebook") {
    // An Instagram business account cannot be subscribed directly — `subscribed_apps` answers "(#3)
    // Application does not have the capability". IG Direct rides the LINKED Page's subscription, so
    // the Page is what has to be subscribed here.
    return NextResponse.json(
      { error: "Only a Facebook Page can be subscribed. Instagram Direct is delivered through the linked Page's subscription — subscribe that Page instead." },
      { status: 400 },
    )
  }
  if (!cfg.pageId || !cfg.apiKey) {
    return NextResponse.json(
      { error: "This configuration has no connected Page yet. Finish the OAuth connect first." },
      { status: 409 },
    )
  }

  const result = await subscribePageToMessages(cfg.pageId, cfg.apiKey)

  const prevSettings =
    cfg.settings && typeof cfg.settings === "object" && !Array.isArray(cfg.settings)
      ? (cfg.settings as Record<string, unknown>)
      : {}
  const nextSettings: Record<string, unknown> = { ...prevSettings, inboxSubscribed: result.success }
  // Clear the "we never asked" marker once we actually have asked, whatever the answer — leaving it
  // set would keep the card claiming the subscription is merely pending after Meta has refused it.
  delete nextSettings.subscriptionPending
  await prisma.channelConfig.update({ where: { id: cfg.id }, data: { settings: nextSettings } })

  return NextResponse.json({
    success: result.success,
    configId: cfg.id,
    pageId: cfg.pageId,
    subscribedFields: ["messages", "messaging_postbacks"],
    ...(result.success ? {} : { error: result.error }),
  }, { status: result.success ? 200 : 502 })
})
