/**
 * Turns a journey snapshot into the assistant's grounding text.
 *
 * Pure. This is the assistant's entire world: where the prospect is in the
 * story, what their synthetic records currently say, and what the section is
 * about. Nothing is read from a tenant, and no commercial claim is included —
 * the policy forbids answering those, so the model is not handed material to
 * improvise them from.
 */
import {
  DEMO_CHANNEL_LABELS,
  DEMO_DEAL_STAGES,
  activeSections,
  findSection,
  quoteTotals,
  type DemoJourneyManifest,
  type DemoJourneySnapshot,
} from "@/lib/demo-center/journey"

function money(amount: number): string {
  return `${amount.toLocaleString("az-AZ")} AZN`
}

function date(value: string): string {
  return value.slice(0, 10)
}

export function buildAssistantGrounding(
  snapshot: DemoJourneySnapshot,
  manifest: DemoJourneyManifest,
): string {
  const sections = activeSections(manifest)
  const section = findSection(manifest, snapshot.sectionId)
  const index = sections.findIndex((candidate) => candidate.id === snapshot.sectionId)
  const step = section?.steps.find((candidate) => candidate.id === snapshot.stepId)
  const { identity, records } = snapshot
  const lines: string[] = []

  lines.push("Ssenari: " + manifest.title)
  lines.push(`Ümumi bölmə sayı: ${sections.length}. Hazırda: ${index + 1} — «${section?.title ?? "—"}».`)
  if (section) lines.push(`Bu bölmə haqqında: ${section.summary}`)
  if (step) lines.push(`Cari addım: «${step.title}». Tapşırıq: ${step.instruction}`)
  lines.push(`Hekayənin vəziyyəti (texniki ad): ${snapshot.state}.`)
  lines.push("")

  lines.push("Demo iştirakçısı (o, həm də bu hekayədəki liddir):")
  lines.push(`- Ad: ${identity.name}`)
  lines.push(`- Şirkət: ${identity.company}`)
  if (identity.jobTitle) lines.push(`- Vəzifə: ${identity.jobTitle}`)
  lines.push(`- E-poçt (maskalanmış): ${identity.emailMasked}`)
  if (identity.phoneMasked) lines.push(`- Telefon (maskalanmış): ${identity.phoneMasked}`)
  lines.push("")

  lines.push("Sintetik qeydlər:")
  lines.push(
    `- Kampaniya «${records.campaign.name}», kanal: ${DEMO_CHANNEL_LABELS[records.campaign.channel]}, `
    + `auditoriya ${records.campaign.audience}, göndərilib ${records.campaign.sent}, `
    + `açılıb ${records.campaign.opened}, kliklənib ${records.campaign.clicked}, tarix ${date(records.campaign.sentAt)}.`,
  )
  lines.push(
    `- Söhbət: ${DEMO_CHANNEL_LABELS[records.conversation.channel]}, mesaj sayı ${records.conversation.messages.length}, `
    + `məsul ${records.conversation.assignedTo}, AI qaralaması ${records.conversation.aiDraft ? "gözləyir" : "yoxdur"}.`,
  )

  if (records.lead) {
    const lead = records.lead
    lines.push(
      `- Lid: ${lead.contactName} (${lead.companyName}), status ${lead.status}, bal ${lead.score}/100, `
      + `prioritet ${lead.priority}, təxmini dəyər ${money(lead.estimatedValue)}, mənbə ${lead.sourceDetail}, `
      + `məsul ${lead.assignedToName}.`,
    )
    lines.push(`  Balın izahı: ${lead.scoreDetails.reasoning}`)
    lines.push(`  Lentdə: ${lead.timeline.map((entry) => entry.title).join("; ")}.`)
  } else {
    lines.push("- Lid hələ yaradılmayıb.")
  }

  if (records.task) {
    lines.push(
      `- Tapşırıq: «${records.task.title}», status ${records.task.status}, `
      + `məsul ${records.task.assigneeName}, son tarix ${date(records.task.dueAt)}.`,
    )
  }

  if (records.deal) {
    const stage = DEMO_DEAL_STAGES[records.deal.stageIndex]
    lines.push(
      `- Sövdələşmə: «${records.deal.title}», mərhələ ${stage.key}, ehtimal ${records.deal.probability}%, `
      + `məbləğ ${money(records.deal.amount)}, gözlənilən bağlanma ${date(records.deal.expectedCloseAt)}`
      + `${records.deal.wonAt ? ", QAZANILIB" : ""}.`,
    )
  }

  if (records.quote) {
    const totals = quoteTotals(records.quote)
    lines.push(
      `- Kommersiya təklifi ${records.quote.quoteNumber}: status ${records.quote.status}, `
      + `sətirlər — ${records.quote.lines.map((line) => `${line.product} ×${line.quantity}`).join(", ")}; `
      + `cəm ${money(totals.net)}, ƏDV ${records.quote.vatPercent}% = ${money(totals.vat)}, `
      + `yekun ${money(totals.gross)}, etibarlıdır ${date(records.quote.validUntil)}.`,
    )
  }

  lines.push("")
  lines.push("Bu demoda görünən bölmələr: Əsas, Satış, Kommunikasiya, Marketinq. Qalan modullar bu sessiyada gizlədilib.")
  lines.push("AI telefon zəngi bu sessiyada söndürülüb — zəng edilmir.")
  lines.push("Bütün yuxarıdakı qeydlər nümunədir və yalnız bu sessiya üçün yaradılıb.")

  return lines.join("\n")
}
