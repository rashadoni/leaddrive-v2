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
  campaignRecordsEngagement,
  findSection,
  quoteTotals,
  type DemoCampaignType,
  type DemoJourneyManifest,
  type DemoJourneySnapshot,
} from "@/lib/demo-center/journey"

const CAMPAIGN_TYPE: Readonly<Record<DemoCampaignType, string>> = { email: "e-poçt", sms: "SMS", whatsapp: "WhatsApp", telegram: "Telegram" }

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
  // Opens and clicks exist for e-mail campaigns only; the assistant is not
  // handed a figure the screen itself shows as «—».
  const engagement = campaignRecordsEngagement(records.campaign.type)
  lines.push(
    `- Kampaniya «${records.campaign.name}», növ: ${CAMPAIGN_TYPE[records.campaign.type]}, `
    + `auditoriya ${records.campaign.audience}, göndərilib ${records.campaign.sent}, `
    + (engagement ? `açılıb ${records.campaign.opened}, kliklənib ${records.campaign.clicked}, ` : "açılış və klik bu növ üçün qeydə alınmır, ")
    + `tarix ${date(records.campaign.sentAt)}.`,
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
    // The score is the product's rules; Da Vinci's reading appears on the card
    // only after «Da Vinci ilə yenidən hesabla».
    lines.push(`  Bal qaydalarla hesablanır (ən böyük çəki menecerin söhbət nəticəsidir). Da Vinci-nin izahı (kartda düymə ilə): ${lead.scoreDetails.daVinci.reasoning}`)
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
      + `aralıq cəm ${money(totals.subtotal)}, endirim yoxdur, cəmi ${money(totals.total)}, etibarlıdır ${date(records.quote.validUntil)}`
      + `${records.quote.contractNumber ? `; qəbuldan sonra müqavilə qaralaması ${records.quote.contractNumber} yaradılıb` : ""}.`,
    )
  }

  lines.push("")
  lines.push("Bu demoda görünən bölmələr: Əsas, Satış, Marketinq, Omni-Channel (o cümlədən VoIP Zənglər — Call Center), Dəstək (Service Desk), Marşrut & Sahə, Kadr uçotu, Müqavilə nəzarəti. Call Center, Service Desk, Marşrut & Sahə, Kadr uçotu və Müqavilə nəzarəti ayrıca modullardır: uydurma komanda və şirkət, lid hekayəsi ilə bağlı deyil. Müqavilə nəzarətində: təklif qəbul edilmiş kimi qeyd olunanda müqavilənin qaralaması özü yaranır; razılaşma zənciri mərhələ-mərhələ keçir, vaxtı keçən mərhələ barədə rəhbərlərə xatırlatma gedir; imza LeadDrive-ın öz elektron imzasıdır (müştəri e-poçtla 30 günlük link alır, adını yazır və ya çəkir), imza tamamlananda müqavilə aktiv olur; bitməzdən 90/60/30/14/7 gün əvvəl administrator və menecerlərə bildiriş gedir. Yeniləmə və xitam avtomatik deyil — qərarı komanda verir; müqavilələrdə AI funksiyaları standart olaraq söndürülüb. Call Center-də telefoniya şirkətin öz PBX stansiyasıdır (Asterisk): satıcı lid kartından zəng edir, stansiya əvvəlcə müştərini yığır, müştəri cavab verəndə satıcının profilindəki nömrəyə zəng gəlir; zəngin gedişini stansiya CRM jurnalına özü yazır, zəng yazısı (audio) CRM-ə düşmür. «Geri zəng» nəticəsi vaxtla satıcıya tapşırıq yaradır; tapşırıq vaxtında açıq qalsa, satıcı bildiriş alır, 45 dəqiqə sonra rəhbərlər. Service Desk-də agentin cavabı müştəriyə WhatsApp ilə (bilet WhatsApp-dan gəlibsə) və müştəri portalında çatır, e-poçtla getmir; bilet kartında Da Vinci cavabı yalnız qaralama kimi yazır, göndərən agentdir. Kadr uçotunda biometriya yoxdur, fasilədə yer yazılmır, günü əməkdaş özü bağlayır. Qalan modullar bu sessiyada gizlədilib.")
  lines.push(manifest.capabilities.liveCall
    ? "AI telefon zəngi bu sessiyada realdır: yalnız müştərinin razılığından və nömrəsi təsdiqləndikdən sonra edilir, ən çoxu iki dəqiqə çəkir."
    : "AI telefon zəngi bu sessiyada söndürülüb — zəng edilmir.")
  lines.push("Bütün yuxarıdakı qeydlər nümunədir və yalnız bu sessiya üçün yaradılıb.")

  return lines.join("\n")
}
