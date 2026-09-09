import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { PAGE_SIZE } from "@/lib/constants"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"

const MODEL = process.env.MANAGER_MODEL || "claude-sonnet-4-5-20250929"

const LANG_MAP: Record<string, { name: string; instruction: string }> = {
  az: { name: "Azerbaijani", instruction: "Cavab Azərbaycan dilində olmalıdır." },
  ru: { name: "Russian", instruction: "Ответ должен быть на русском языке." },
  en: { name: "English", instruction: "Answer in English." },
}

export const POST = withRls(async (req, { orgId }) => {

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: "Da Vinci AI requires ANTHROPIC_API_KEY. Configure in Settings → Integrations." }, { status: 503 })

  let body: { lang?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const lang = body.lang && LANG_MAP[body.lang] ? body.lang : "en"
  const langCfg = LANG_MAP[lang]

  // Load email logs
  const logs = await prisma.emailLog.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE.INBOX,
  })

  if (logs.length === 0) {
    return NextResponse.json({ error: "No email logs found" }, { status: 404 })
  }

  // Compute stats
  const total = logs.length
  const outbound = logs.filter((l: any) => l.direction === "outbound").length
  const inbound = logs.filter((l: any) => l.direction === "inbound").length
  const sent = logs.filter((l: any) => l.status === "sent" || l.status === "delivered").length
  const failed = logs.filter((l: any) => l.status === "failed").length
  const bounced = logs.filter((l: any) => l.status === "bounced").length
  const deliveryRate = outbound > 0 ? Math.round((sent / outbound) * 100) : 0

  // Top recipients
  const recipientMap: Record<string, number> = {}
  logs.filter((l: any) => l.direction === "outbound").forEach((l: any) => {
    recipientMap[l.toEmail] = (recipientMap[l.toEmail] || 0) + 1
  })
  const topRecipients = Object.entries(recipientMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([email, count]) => `  - ${email}: ${count} emails`)
    .join("\n")

  // Campaign stats
  const campaignCount = logs.filter((l: any) => l.campaignId).length

  // Failed emails details
  const failedEmails = logs
    .filter((l: any) => l.status === "failed" || l.status === "bounced")
    .slice(0, 10)
    .map((l: any) => `  - To: ${l.toEmail}, Subject: "${l.subject || "(no subject)"}", Error: ${l.errorMessage || "unknown"}, Date: ${new Date(l.createdAt).toLocaleDateString()}`)
    .join("\n")

  // Recent activity (last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 86400000)
  const recentLogs = logs.filter((l: any) => new Date(l.createdAt) >= weekAgo)
  const recentSent = recentLogs.filter((l: any) => l.status === "sent" || l.status === "delivered").length
  const recentFailed = recentLogs.filter((l: any) => l.status === "failed" || l.status === "bounced").length

  const prompt = `You are Da Vinci, an AI email analytics assistant for an IT outsourcing company CRM.

${langCfg.instruction}

Here is the email activity data:

Total emails: ${total}
Outbound: ${outbound}, Inbound: ${inbound}
Delivered: ${sent} (${deliveryRate}% delivery rate)
Failed: ${failed}, Bounced: ${bounced}
Campaign emails: ${campaignCount} (${total > 0 ? Math.round((campaignCount / total) * 100) : 0}% of total)

Last 7 days: ${recentLogs.length} emails (${recentSent} delivered, ${recentFailed} failed)

Top 10 recipients:
${topRecipients || "  (none)"}

Recent failed/bounced emails:
${failedEmails || "  (none)"}

Provide a comprehensive email activity analysis (250-400 words) with:
1. Deliverability Summary — overall health of email sending
2. Issue Analysis — failed/bounced patterns, problematic recipients
3. Engagement Insights — sending patterns, campaign effectiveness
4. Recommendations — 3-5 specific steps to improve email deliverability and engagement

Use professional CRM analyst style. Be specific about email addresses and error patterns.`

  try {
    const client = getAnthropicClient({ apiKey })
    const piiMasker = new PiiMasker()
    const maskedPrompt = piiMasker.mask(prompt)
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: maskedPrompt }],
    })

    const analysis = piiMasker.unmask(msg.content[0].type === "text" ? msg.content[0].text : "")
    return NextResponse.json({ success: true, data: { analysis } })
  } catch (e: any) {
    console.error("Da Vinci email analysis error:", e)
    return NextResponse.json({ error: "Da Vinci service unavailable" }, { status: 503 })
  }
})
