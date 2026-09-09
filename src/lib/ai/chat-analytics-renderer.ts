import { VOICE_SECTIONS } from "@/lib/ai/voice/sections"
import { navItemPathname, navItems } from "@/lib/nav-items"
import ruMessages from "../../../messages/ru.json"
import enMessages from "../../../messages/en.json"
import azMessages from "../../../messages/az.json"

type Locale = "ru" | "az" | "en"

type SectionSummary = {
  whatItIs: string
  howItWorks: string
  keyFeatures: string[]
}

type NavMessages = { nav?: Record<string, unknown> }

const NAV_MESSAGES: Record<Locale, NavMessages> = {
  ru: ruMessages,
  az: azMessages,
  en: enMessages,
}

const LOCALIZED_SECTION_SUMMARIES: Record<Locale, Record<string, SectionSummary>> = {
  ru: {},
  az: {
    leads: {
      whatItIs: "Lidlər potensial müştərilərin CRM qeydləridir.",
      howItWorks: "Bu bölmədə lidləri mərhələ, məsul şəxs, mənbə və digər mövcud filtrlər üzrə izləmək, lid kartını açmaq və növbəti satış addımını idarə etmək olar.",
      keyFeatures: ["Lid siyahısı və Kanban görünüşü", "Məsul şəxs və status nəzarəti", "Lid kartı və fəaliyyət tarixçəsi"],
    },
    deals: {
      whatItIs: "Sövdələşmələr satış imkanlarının boru xəttində idarə olunduğu bölmədir.",
      howItWorks: "Sövdələşmə mərhələsi, məsul şəxs, məbləğ və gözlənilən bağlanma tarixi CRM məlumatları əsasında izlənir.",
      keyFeatures: ["Satış boru xətti", "Mərhələ və məsul şəxs", "Məbləğ və bağlanma tarixi"],
    },
    quotes: {
      whatItIs: "Kommersiya təklifləri müştəriyə hazırlanmış qiymət və şərtlərin idarə olunduğu bölmədir.",
      howItWorks: "Təklif yaradılır, statusu və etibarlılıq müddəti izlənir, sonra göndərilmə və qəbul nəticələri CRM-də saxlanılır.",
      keyFeatures: ["Təklifin yaradılması", "Status və etibarlılıq müddəti", "Göndərilmə və qəbul izlənməsi"],
    },
    leaderboard: {
      whatItIs: "KPI Arena əməkdaşların nəticələrini KPI faizi və iş həcmi üzrə müqayisə edən reytinq bölməsidir.",
      howItWorks: "Qrup və dövr seçilir; satış göstəricisi cari rüb kvotasına əsaslanır, digər qruplar isə seçilmiş dövrün qeydə alınmış iş nəticələrini göstərir.",
      keyFeatures: ["Qrup üzrə reytinq", "KPI faizi", "İş həcmi və dövr seçimi"],
    },
  },
  en: {
    leads: {
      whatItIs: "Leads are CRM records for prospective customers.",
      howItWorks: "Use this section to follow leads by stage, assignee, source, and available filters, open the lead card, and manage the next sales step.",
      keyFeatures: ["List and Kanban views", "Assignee and status tracking", "Lead card and activity history"],
    },
    deals: {
      whatItIs: "Deals is the section where sales opportunities are managed through the pipeline.",
      howItWorks: "The CRM tracks each deal's stage, assignee, value, and expected close date using the stored deal record.",
      keyFeatures: ["Sales pipeline", "Stage and assignee", "Value and expected close date"],
    },
    quotes: {
      whatItIs: "Quotes is the section for managing customer-facing commercial proposals, prices, and terms.",
      howItWorks: "A proposal is created, its status and validity are tracked, and its sent and accepted outcomes are stored in CRM.",
      keyFeatures: ["Proposal creation", "Status and validity", "Sent and accepted tracking"],
    },
    leaderboard: {
      whatItIs: "KPI Arena is the ranking section that compares employee results by KPI percentage and work volume.",
      howItWorks: "Select a group and period; Sales uses the current-quarter quota, while other groups show recorded work results for the selected period.",
      keyFeatures: ["Group ranking", "KPI percentage", "Work volume and period selection"],
    },
  },
}

const METRIC_LABELS: Record<Locale, Record<string, string>> = {
  ru: {
    leads_created: "созданные лиды",
    deals_created: "созданные сделки",
    sales_won: "выигранные продажи",
    quotes_created: "созданные коммерческие предложения",
    quotes_sent: "отправленные коммерческие предложения",
    quotes_accepted: "принятые коммерческие предложения",
    tasks_completed: "выполненные задачи",
    tickets_resolved: "решённые тикеты",
    won_deals: "выигранные сделки",
    answered_leads_by_call: "уникальные лиды с отвеченным исходящим звонком менеджера",
    created_leads: "новые лиды по текущему ответственному",
    completed_tasks: "выполненные задачи",
    resolved_tickets: "решённые тикеты",
    created_quotes: "созданные коммерческие предложения",
  },
  az: {
    leads_created: "yaradılmış lidlər",
    deals_created: "yaradılmış sövdələşmələr",
    sales_won: "qazanılmış satışlar",
    quotes_created: "yaradılmış kommersiya təklifləri",
    quotes_sent: "göndərilmiş kommersiya təklifləri",
    quotes_accepted: "qəbul edilmiş kommersiya təklifləri",
    tasks_completed: "tamamlanmış tapşırıqlar",
    tickets_resolved: "həll edilmiş tiketlər",
    won_deals: "qazanılmış sövdələşmələr",
    answered_leads_by_call: "cavablandırılmış insan zəngi olan fərqli lidlər",
    created_leads: "cari məsula görə yeni lidlər",
    completed_tasks: "tamamlanmış tapşırıqlar",
    resolved_tickets: "həll edilmiş tiketlər",
    created_quotes: "yaradılmış kommersiya təklifləri",
  },
  en: {
    leads_created: "leads created",
    deals_created: "deals created",
    sales_won: "sales won",
    quotes_created: "commercial proposals created",
    quotes_sent: "commercial proposals sent",
    quotes_accepted: "commercial proposals accepted",
    tasks_completed: "tasks completed",
    tickets_resolved: "tickets resolved",
    won_deals: "deals won",
    answered_leads_by_call: "distinct leads with an answered outbound human call",
    created_leads: "new leads by current assignee",
    completed_tasks: "tasks completed",
    resolved_tickets: "tickets resolved",
    created_quotes: "commercial proposals created",
  },
}

const KPI_GROUP_LABELS: Record<Locale, Record<string, string>> = {
  ru: { sales: "Продажи", mtm: "Полевые агенты", tickets: "Поддержка", projects: "Проекты", tasks: "Задачи" },
  az: { sales: "Satış", mtm: "Sahə agentləri", tickets: "Dəstək", projects: "Layihələr", tasks: "Tapşırıqlar" },
  en: { sales: "Sales", mtm: "Route & Field", tickets: "Support", projects: "Projects", tasks: "Tasks" },
}

const KPI_PERIOD_LABELS: Record<Locale, Record<string, string>> = {
  ru: { day: "день", week: "неделя", month: "месяц", quarter: "квартал", year: "год", all: "всё время", current_quarter: "текущий квартал" },
  az: { day: "gün", week: "həftə", month: "ay", quarter: "rüb", year: "il", all: "bütün dövr", current_quarter: "cari rüb" },
  en: { day: "day", week: "week", month: "month", quarter: "quarter", year: "year", all: "all time", current_quarter: "current quarter" },
}

function localeKey(value: unknown): Locale {
  return value === "az" || value === "en" ? value : "ru"
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(object) : []
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function formatNumber(value: unknown, locale: Locale): string {
  const tag = locale === "az" ? "az-AZ" : locale === "en" ? "en-US" : "ru-RU"
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(number(value))
}

function periodText(evidence: Record<string, unknown>): string {
  // Just the human period label. The timezone stays in the evidence payload for
  // audit; reciting it in every sentence made the assistant sound like a report
  // generator, which the owner explicitly rejected.
  const period = object(evidence.period)
  return String(period.label ?? "—")
}

function localizedCaveats(evidence: Record<string, unknown>, locale: Locale): string[] {
  const metric = String(evidence.metric ?? "")
  const coverage = object(evidence.coverage)
  const missingHistory = number(coverage.wonDealsWithoutHistory)
  const caveats: string[] = []

  if ((metric === "sales_won" || metric === "won_deals") && missingHistory > 0) {
    const n = formatNumber(missingHistory, locale)
    if (locale === "az") caveats.push(`Daha ${n} qazanılmış sövdələşmənin qazanılma tarixi sistemdə qeyd olunmayıb, ona görə heç bir dövrə aid edilə bilmir.`)
    else if (locale === "en") caveats.push(missingHistory === 1
      ? "1 more won deal has no recorded win date, so it cannot be placed in any period."
      : `${n} more won deals have no recorded win date, so they cannot be placed in any period.`)
    else caveats.push(missingHistory === 1
      ? "Ещё у 1 выигранной сделки дата выигрыша не зафиксирована, поэтому её нельзя отнести ни к одному периоду."
      : `Ещё у ${n} выигранных сделок дата выигрыша не зафиксирована, поэтому их нельзя отнести ни к одному периоду.`)
  }

  if (metric === "deals_created") {
    if (locale === "az") caveats.push("Bu, yaradılmış sövdələşmələrin sayıdır — qazanılmışların deyil.")
    else if (locale === "en") caveats.push("This counts deals created, not deals won.")
    else caveats.push("Это количество созданных сделок, а не выигранных.")
  }

  // Same shape guard as the amount clause in renderSalesWon: the disclosure
  // must never fire for an amount the sentence did not actually print.
  const money = object(evidence.money)
  if (metric === "sales_won" && money.mixedCurrencies === true
    && typeof money.amount === "number" && typeof money.currency === "string") {
    if (locale === "az") caveats.push("Məbləğ bu qazanclarda ən çox rast gəlinən valyuta üzrə göstərilib; dövrdə başqa valyutalarla da qazanılmış sövdələşmələr var.")
    else if (locale === "en") caveats.push("The amount is in the most common currency of these wins; the period also has wins in other currencies.")
    else caveats.push("Сумма показана в валюте большинства этих сделок; в периоде есть выигрыши и в других валютах.")
  }

  if (metric === "won_deals") {
    if (locale === "az") caveats.push("Keçid onu edən istifadəçiyə aid edilir; avtomatik keçidlər adsız qalır.")
    else if (locale === "en") caveats.push("A transition is attributed to the user who made it; automated transitions remain unattributed.")
    else caveats.push("Переход относится к выполнившему его пользователю; автоматические переходы остаются без автора.")
  } else if (metric === "answered_leads_by_call") {
    if (locale === "az") caveats.push("Yalnız lidə bağlı cavablandırılmış çıxan insan zəngləri əhatə olunur; poçt, görüşlər, süni intellekt zəngləri və əlaqəsiz zənglər daxil deyil.")
    else if (locale === "en") caveats.push("Only answered outbound human calls linked to a lead are covered; email, meetings, AI calls, and unlinked calls are not included.")
    else caveats.push("Учитываются только отвеченные исходящие звонки человека, связанные с лидом; почта, встречи, ИИ-звонки и несвязанные звонки не входят.")
  } else if (metric === "created_leads") {
    if (locale === "az") caveats.push("Yaradılma anındakı təyinat tarixçəsi saxlanmadığı üçün lid cari məsula aid edilir.")
    else if (locale === "en") caveats.push("The lead is attributed to its current assignee because assignment-at-creation history is not stored.")
    else caveats.push("Лид относится к текущему ответственному, потому что история назначения на момент создания не хранится.")
  } else if (metric === "created_quotes") {
    if (locale === "az") caveats.push("Reytinq təklifi yaradana aiddir; göndərilmə vaxtı onu kimin göndərdiyini saxlamır.")
    else if (locale === "en") caveats.push("The ranking is by proposal creator; the sent timestamp does not store who sent it.")
    else caveats.push("Рейтинг строится по создателю предложения; отметка отправки не хранит, кто его отправил.")
  } else if (metric === "completed_tasks") {
    if (locale === "az") caveats.push("Tapşırıq onun məsul şəxsinə sayılır.")
    else if (locale === "en") caveats.push("A task is credited to its assignee.")
    else caveats.push("Задача засчитывается её ответственному.")
  } else if (metric === "resolved_tickets") {
    if (locale === "az") caveats.push("Tiket onun məsul şəxsinə sayılır.")
    else if (locale === "en") caveats.push("A ticket is credited to its assignee.")
    else caveats.push("Обращение засчитывается его ответственному.")
  }

  if (evidence.direction === "bottom") {
    if (locale === "az") caveats.push("Ən aşağı nəticə yalnız sıfırdan böyük qeydə alınmış iştirakçılar arasındadır; sıfır fəaliyyəti olan əməkdaşlar daxil deyil.")
    else if (locale === "en") caveats.push("Bottom is among recorded non-zero participants only; employees with zero activity are not included.")
    else caveats.push("Минимум показан только среди участников с ненулевой зафиксированной активностью; сотрудники с нулём не включены.")
  }

  const unattributed = number(evidence.unattributed)
  if (unattributed > 0) {
    if (locale === "az") caveats.push(`Aktiv əməkdaşa aid edilməyən nəticə: ${formatNumber(unattributed, locale)}.`)
    else if (locale === "en") caveats.push(`Results not attributed to an active employee: ${formatNumber(unattributed, locale)}.`)
    else caveats.push(`Результаты без привязки к активному сотруднику: ${formatNumber(unattributed, locale)}.`)
  }
  return caveats
}

function caveatText(evidence: Record<string, unknown>, locale: Locale): string {
  const caveats = localizedCaveats(evidence, locale)
  if (caveats.length === 0) return ""
  const prefix = locale === "az" ? "Qeyd" : locale === "en" ? "Note" : "Примечание"
  return `\n${prefix}: ${caveats.join(" ")}`
}

// The numbers stay verified evidence, but the sentence must sound like a
// colleague. Internal identifiers (basisField, Prisma model names) and metric
// definitions never reach the user: the definition nuances that actually change
// interpretation live in localizedCaveats instead.
function renderSalesWon(evidence: Record<string, unknown>, locale: Locale): string {
  const period = periodText(evidence)
  const won = formatNumber(evidence.value, locale)
  // Speak only counts the evidence actually carries: an absent lostCount must
  // not become an asserted zero.
  const lost = typeof evidence.lostCount === "number" ? formatNumber(evidence.lostCount, locale) : null
  const money = object(evidence.money)
  const amountPart = typeof money.amount === "number" && typeof money.currency === "string"
    ? { amount: formatNumber(money.amount, locale), currency: money.currency }
    : null
  if (locale === "az") {
    const amountText = amountPart ? `, ümumi məbləğ ${amountPart.amount} ${amountPart.currency}` : ""
    const lostText = lost === null ? "" : `; itirilmiş — ${lost}`
    return `${period}: qazanılmış sövdələşmələr — ${won}${amountText}${lostText}.${caveatText(evidence, locale)}`
  }
  if (locale === "en") {
    const amountText = amountPart ? `, total ${amountPart.amount} ${amountPart.currency}` : ""
    const lostText = lost === null ? "" : `; lost — ${lost}`
    return `${period}: deals won — ${won}${amountText}${lostText}.${caveatText(evidence, locale)}`
  }
  const amountText = amountPart ? ` на сумму ${amountPart.amount} ${amountPart.currency}` : ""
  const lostText = lost === null ? "" : `; проиграно — ${lost}`
  return `${period}: выиграно сделок — ${won}${amountText}${lostText}.${caveatText(evidence, locale)}`
}

function renderPeriodReport(evidence: Record<string, unknown>, locale: Locale): string {
  const metric = String(evidence.metric ?? "")
  if (metric === "sales_won") return renderSalesWon(evidence, locale)
  const label = METRIC_LABELS[locale][metric] ?? metric
  const value = formatNumber(evidence.value, locale)
  const period = periodText(evidence)
  return `${period}: ${label} — ${value}.${caveatText(evidence, locale)}`
}

function renderRanking(evidence: Record<string, unknown>, locale: Locale): string {
  const metric = String(evidence.metric ?? "")
  const label = METRIC_LABELS[locale][metric] ?? metric
  const ranked = rows(evidence.rows)
  const list = ranked.length > 0
    ? ranked.map((row, index) => `${index + 1}. ${String(row.name ?? "—")} — ${formatNumber(row.count, locale)}`).join("; ")
    : (locale === "az" ? "qeydə alınmış nəticə yoxdur" : locale === "en" ? "no recorded results" : "нет зафиксированных результатов")
  const period = periodText(evidence)
  const periodPart = locale === "ru" ? `период ${period}` : period
  return `${label}; ${periodPart}: ${list}.${caveatText(evidence, locale)}`.trim()
}

function renderKpi(evidence: Record<string, unknown>, locale: Locale): string {
  const groupKey = String(evidence.group ?? "")
  const group = KPI_GROUP_LABELS[locale][groupKey] ?? groupKey
  const appliedKey = String(evidence.appliedPeriod ?? evidence.requestedPeriod ?? "")
  const applied = KPI_PERIOD_LABELS[locale][appliedKey] ?? appliedKey
  const ranked = rows(evidence.rows)
  const list = ranked.length > 0
    ? ranked.map((row, index) => {
        const name = String(row.name ?? "—")
        const kpi = formatNumber(row.attainmentPct, locale)
        const volume = formatNumber(row.volume, locale)
        const volumeLabel = locale === "az" ? "həcm" : locale === "en" ? "volume" : "объём"
        const currency = row.volumeFormat === "currency" && typeof row.currency === "string" ? ` ${row.currency}` : ""
        return `${index + 1}. ${name} — KPI ${kpi}%, ${volumeLabel} ${volume}${currency}`
      }).join("; ")
    : (locale === "az" ? "nəticə yoxdur" : locale === "en" ? "no results" : "нет результатов")
  const semantics = groupKey === "sales"
    ? (locale === "az"
        ? "Satış KPI-si kvotaya əsaslanır və həmişə cari rüb üzrə hesablanır."
        : locale === "en"
          ? "Sales KPI is quota-based and always uses the current quarter."
          : "KPI продаж основан на квоте и всегда рассчитывается за текущий квартал.")
    : (locale === "az"
        ? "KPI Arena-da gün və həftə sürüşən dövrlərdir; ay, rüb və il təqvim dövrünün əvvəlindən cari ana qədər hesablanır."
        : locale === "en"
          ? "In KPI Arena, day and week are rolling windows; month, quarter, and year are calendar-to-date."
          : "В KPI Arena день и неделя — скользящие периоды; месяц, квартал и год считаются от начала календарного периода до текущего момента.")
  if (locale === "az") return `KPI Arena, ${group}, dövr ${applied}: ${list}. ${semantics}`.trim()
  if (locale === "en") return `KPI Arena, ${group}, period ${applied}: ${list}. ${semantics}`.trim()
  return `KPI Arena, группа ${group}, период ${applied}: ${list}. ${semantics}`.trim()
}

function localizedSectionTitle(section: string, locale: Locale): string {
  const path = VOICE_SECTIONS[section]
  const item = path
    ? navItems.find((candidate) => navItemPathname(candidate.href) === navItemPathname(path))
    : undefined
  const translated = item ? NAV_MESSAGES[locale].nav?.[item.tKey] : undefined
  if (typeof translated === "string" && translated.trim()) return translated.trim()
  return section.replaceAll("_", " ").replaceAll("-", " ").trim()
}

function localizedSectionFallback(section: string, locale: Exclude<Locale, "ru">): SectionSummary {
  const title = localizedSectionTitle(section, locale)
  if (locale === "az") {
    return {
      whatItIs: `«${title}» LeadDrive CRM-in yoxlanılmış menyu bölməsidir.`,
      howItWorks: "Bölməni açdıqda rolunuza və təşkilatda aktiv modullara uyğun məlumat və alətlər göstərilir. Dəqiq imkanlar giriş hüquqlarınızdan asılıdır.",
      keyFeatures: ["Menyudan təhlükəsiz keçid", "Rol və modul üzrə giriş nəzarəti"],
    }
  }
  return {
    whatItIs: `“${title}” is a verified LeadDrive CRM menu section.`,
    howItWorks: "Opening it shows the data and tools allowed by your role and the modules enabled for your organization. Exact capabilities depend on your access rights.",
    keyFeatures: ["Safe menu navigation", "Role and module access controls"],
  }
}

function formatSectionSummary(summary: SectionSummary, locale: Locale): string {
  const prefix = locale === "az"
    ? "Yoxlanılmış bölmə təsviri"
    : locale === "en"
      ? "Verified section description"
      : "Проверенное описание раздела"
  const featureLabel = locale === "az"
    ? "Əsas imkanlar"
    : locale === "en"
      ? "Key capabilities"
      : "Основные возможности"
  return `${prefix}: ${summary.whatItIs}\n\n${summary.howItWorks}${summary.keyFeatures.length > 0 ? `\n\n${featureLabel}:\n- ${summary.keyFeatures.join("\n- ")}` : ""}`
}

function renderSectionGuide(evidence: Record<string, unknown>, locale: Locale): string {
  const section = String(evidence.section ?? "")
  if (!section || !VOICE_SECTIONS[section]) return ""
  // The audited long-form guide is Russian. AZ/EN therefore use code-reviewed
  // summaries for core business sections and a deterministic localized menu
  // fallback for every other advertised safe section. Raw Russian guide text
  // and model paraphrases never cross the locale boundary.
  if (locale !== "ru") {
    const summary = LOCALIZED_SECTION_SUMMARIES[locale][section]
      ?? localizedSectionFallback(section, locale)
    return formatSectionSummary(summary, locale)
  }
  const whatItIs = typeof evidence.whatItIs === "string" ? evidence.whatItIs.trim() : ""
  const howItWorks = typeof evidence.howItWorks === "string" ? evidence.howItWorks.trim() : ""
  const features = Array.isArray(evidence.keyFeatures)
    ? evidence.keyFeatures.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 5)
    : []
  if (!whatItIs || !howItWorks) return ""
  return formatSectionSummary({ whatItIs, howItWorks, keyFeatures: features }, locale)
}

/** Render only values present in verified tool evidence; no model arithmetic or paraphrased counts. */
export function renderChatAnalyticsEvidence(evidence: Record<string, unknown>, localeValue: unknown): string {
  const locale = localeKey(localeValue)
  if (evidence.kind === "crm_period_report") return renderPeriodReport(evidence, locale)
  if (evidence.kind === "crm_ranking") return renderRanking(evidence, locale)
  if (evidence.kind === "kpi_arena_ranking") return renderKpi(evidence, locale)
  // Section help is rendered from server evidence too. Letting the model
  // paraphrase it re-opened fabricated tenant counts and invented behavior.
  if (evidence.kind === "crm_section_guide") return renderSectionGuide(evidence, locale)
  return ""
}
