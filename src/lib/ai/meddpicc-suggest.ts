/**
 * D3 (Creatio 10X roadmap) — AI-fill MEDDPICC from a deal's correspondence.
 *
 * The advisor reads the deal's logged activities (notes/calls/meetings) and the
 * emails to/from the deal's contacts, then proposes DRAFT MEDDPICC blocks
 * ({ score 1-5, note, next }) grounded ONLY in that evidence. Nothing is saved —
 * the route returns the draft and the deal card lets the manager confirm & save.
 *
 * Mirrors meeting-recap.ts: shared timeout-bounded client, PiiMasker, strict
 * JSON, cost logging. Cheap Haiku model — this is structured extraction, not
 * generation.
 */
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { prisma } from "@/lib/prisma"
import { calculateAiCost } from "@/lib/ai/budget"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { MEDDPICC_BLOCKS, parseMeddpicc, type MeddpiccData } from "@/lib/meddpicc"

const SUGGEST_MODEL = "claude-haiku-4-5-20251001"

/** How much evidence to feed the model (bounded like meeting-recap's transcript). */
const MAX_ACTIVITIES = 40
const MAX_EMAILS = 25
const MAX_EVIDENCE_CHARS = 9000

export interface MeddpiccSuggestSource {
  kind: "activity" | "email"
  label: string
  at: string
}

export interface MeddpiccSuggestResult {
  /** Draft blocks the manager reviews; empty when there was nothing to go on. */
  suggestions: MeddpiccData
  /** What the model looked at (for the "based on N items" line). */
  sources: MeddpiccSuggestSource[]
  /** Count of evidence items gathered (0 → the UI shows "no correspondence yet"). */
  evidenceCount: number
  model: string
}

type ActivityRow = { type: string; subject: string | null; description: string | null; createdAt: Date }
type EmailRow = { direction: string; subject: string | null; body: string | null; createdAt: Date }
type ContactNameRow = { fullName: string | null }

const BLOCK_GUIDE: Record<(typeof MEDDPICC_BLOCKS)[number], string> = {
  metrics: "quantified economic impact / ROI the customer cares about",
  economicBuyer: "the person who controls the budget and can say yes",
  decisionCriteria: "the formal/technical criteria the deal is judged on",
  decisionProcess: "the steps, dates and approvals to a signed decision",
  paperProcess: "procurement / legal / security paperwork to close",
  identifyPain: "the concrete pain driving the purchase",
  champion: "an internal advocate selling on your behalf",
  competition: "competing vendors or the status-quo / do-nothing option",
}

/**
 * Build the draft. Returns evidenceCount:0 (no LLM call) when the deal has no
 * correspondence, so the caller can show a clean empty state instead of paying
 * for a hallucination.
 */
export async function suggestMeddpiccFromCorrespondence(
  orgId: string,
  dealId: string,
): Promise<MeddpiccSuggestResult | null> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId: orgId },
    select: {
      id: true, name: true, stage: true, valueAmount: true, currency: true,
      contactId: true, companyId: true,
      company: { select: { name: true } },
      contactRoles: { select: { contactId: true } },
    },
  })
  if (!deal) return null

  const roleContactIds = deal.contactRoles.map((r: { contactId: string }) => r.contactId)
  const contactIds = Array.from(
    new Set([deal.contactId, ...roleContactIds].filter((x): x is string => !!x)),
  )

  const [activities, emails, contacts] = (await Promise.all([
    prisma.activity.findMany({
      where: { organizationId: orgId, relatedType: "deal", relatedId: dealId },
      orderBy: { createdAt: "desc" },
      take: MAX_ACTIVITIES,
      select: { type: true, subject: true, description: true, createdAt: true },
    }),
    contactIds.length
      ? prisma.emailLog.findMany({
          where: { organizationId: orgId, contactId: { in: contactIds } },
          orderBy: { createdAt: "desc" },
          take: MAX_EMAILS,
          select: { direction: true, subject: true, body: true, createdAt: true },
        })
      : Promise.resolve([] as EmailRow[]),
    contactIds.length
      ? prisma.contact.findMany({
          where: { organizationId: orgId, id: { in: contactIds } },
          select: { fullName: true },
        })
      : Promise.resolve([] as ContactNameRow[]),
  ])) as [ActivityRow[], EmailRow[], ContactNameRow[]]

  const sources: MeddpiccSuggestSource[] = [
    ...activities.map((a) => ({
      kind: "activity" as const,
      label: `${a.type}: ${a.subject || a.description || ""}`.slice(0, 120),
      at: a.createdAt.toISOString(),
    })),
    ...emails.map((e) => ({
      kind: "email" as const,
      label: `${e.direction === "inbound" ? "←" : "→"} ${e.subject || ""}`.slice(0, 120),
      at: e.createdAt.toISOString(),
    })),
  ]
  const evidenceCount = sources.length
  if (evidenceCount === 0) {
    return { suggestions: {}, sources: [], evidenceCount: 0, model: SUGGEST_MODEL }
  }

  // Compose a compact, newest-first evidence log, bounded by char budget.
  const lines: string[] = []
  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  for (const a of activities) {
    lines.push(`[${a.createdAt.toISOString().slice(0, 10)}] ${a.type}: ${(a.subject ? a.subject + " — " : "") + (a.description || "")}`.slice(0, 500))
  }
  for (const e of emails) {
    lines.push(`[${e.createdAt.toISOString().slice(0, 10)}] email ${e.direction}: ${(e.subject ? e.subject + " — " : "") + stripHtml(e.body || "")}`.slice(0, 500))
  }
  let evidence = ""
  for (const l of lines) {
    if (evidence.length + l.length + 1 > MAX_EVIDENCE_CHARS) break
    evidence += l + "\n"
  }

  const blockList = MEDDPICC_BLOCKS.map((k) => `- "${k}": ${BLOCK_GUIDE[k]}`).join("\n")
  const prompt = `You are a B2B sales qualification assistant. Score this deal on the MEDDPICC framework using ONLY the evidence below. Do not invent facts.

Deal: ${deal.name} (stage: ${deal.stage}, value: ${decimalToNumber(deal.valueAmount)} ${deal.currency || ""})${deal.company?.name ? `, company: ${deal.company.name}` : ""}

MEDDPICC blocks:
${blockList}

Evidence (newest first — activities and emails logged on the deal):
${evidence}

Return STRICT JSON (no markdown, no code fences). Include a block key ONLY when the evidence actually says something about it — OMIT blocks with no signal (do NOT guess). For each included block:
{
  "<blockKey>": { "score": <1-5 integer: 1 unknown/at risk … 5 fully nailed down>, "note": "<one short sentence: what the evidence shows>", "next": "<one short sentence: the next step to de-risk it>" }
}
Write "note" and "next" in the same language as the evidence. Keep each under 160 characters. Return {} if the evidence supports nothing.`

  const masker = new PiiMasker()
  masker.addKnownNames(contacts.map((c) => c.fullName).filter((x): x is string => !!x))
  masker.addKnownCompanies([deal.company?.name || "", deal.name].filter(Boolean))
  const maskedPrompt = masker.mask(prompt)

  const anthropic = getAnthropicClient()
  const start = Date.now()
  let response: { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } }
  try {
    response = (await anthropic.messages.create({
      model: SUGGEST_MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content: maskedPrompt }],
    })) as typeof response
  } catch (e) {
    // Distinct from the null "deal not found" path — let the route answer 502.
    console.error("[meddpicc-suggest] AI call failed:", e)
    throw new Error("ai_call_failed")
  }

  const textBlock = response.content?.find(
    (b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string",
  )
  const raw = masker.unmask(textBlock?.text ?? "{}")
  const cleaned = raw.replace(/```(?:json)?\s*|\s*```/g, "").trim()

  let parsedJson: unknown = {}
  try {
    parsedJson = JSON.parse(cleaned)
  } catch {
    parsedJson = {}
  }
  // parseMeddpicc clamps scores to 1-5, trims notes, and drops unknown keys — so
  // a malformed/hallucinated shape fails soft to a smaller (or empty) draft.
  const suggestions = parseMeddpicc(parsedJson)

  const inputTokens = response.usage?.input_tokens || 0
  const outputTokens = response.usage?.output_tokens || 0
  await prisma.aiInteractionLog
    .create({
      data: {
        organizationId: orgId,
        userMessage: `meddpicc_suggest:${dealId}`,
        aiResponse: cleaned.slice(0, 2000),
        model: SUGGEST_MODEL,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        costUsd: calculateAiCost(SUGGEST_MODEL, inputTokens, outputTokens),
        latencyMs: Date.now() - start,
      },
    })
    .catch(() => {})

  return { suggestions, sources, evidenceCount, model: SUGGEST_MODEL }
}
