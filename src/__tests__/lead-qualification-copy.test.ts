import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const expected = {
  en: {
    leads: {
      salesCallTitle: "Lead qualification",
      salesCallHint: "Set the lead's current sales qualification here. When a browser or AI call is given an outcome, that outcome is saved separately; this qualification syncs to linked Inbox conversations and sales analytics.",
      salesCallResult: "Current qualification",
      salesCallSave: "Save qualification",
      salesCallLastUpdated: "Qualification updated: {date}",
    },
    inboxAnalytics: {
      handoffSalesReported: "Lead qualification saved",
      handoffSalesReportedDetail: "{n} leads are still awaiting qualification",
      handoffSalesTeamHint: "Assigned leads, saved qualifications, and selected signals for every seller",
      colCallReports: "Qualified leads",
      colAwaitingReport: "Awaiting qualification",
      colCallOutcomes: "Qualification signals",
    },
    inboxV2: {
      leadHandoffHint: "The salesperson will mark the lead's current qualification, such as Interested or Potential.",
    },
  },
  ru: {
    leads: {
      salesCallTitle: "Квалификация лида",
      salesCallHint: "Укажите здесь текущую квалификацию лида. Если для браузерного или AI-звонка выбран результат, он сохраняется отдельно; квалификация синхронизируется со связанными диалогами Inbox и аналитикой продаж.",
      salesCallResult: "Текущая квалификация",
      salesCallSave: "Сохранить квалификацию",
      salesCallLastUpdated: "Квалификация обновлена: {date}",
    },
    inboxAnalytics: {
      handoffSalesReported: "Квалификация лида сохранена",
      handoffSalesReportedDetail: "{n} лидов ещё ожидают квалификацию",
      handoffSalesTeamHint: "Назначенные лиды, сохранённые квалификации и выбранные признаки по каждому продавцу",
      colCallReports: "Квалифицировано лидов",
      colAwaitingReport: "Ждут квалификацию",
      colCallOutcomes: "Признаки квалификации",
    },
    inboxV2: {
      leadHandoffHint: "Продавец отметит текущую квалификацию лида, например «Заинтересован» или «Потенциальный».",
    },
  },
  az: {
    leads: {
      salesCallTitle: "Lidin kvalifikasiyası",
      salesCallHint: "Lidin cari satış kvalifikasiyasını burada qeyd edin. Brauzer və ya AI zəngi üçün nəticə seçildikdə, həmin nəticə ayrıca saxlanılır; kvalifikasiya əlaqəli Inbox söhbətlərinə və satış analitikasına ötürülür.",
      salesCallResult: "Cari kvalifikasiya",
      salesCallSelectedCount: "{count} əlamət seçilib",
      salesCallSave: "Kvalifikasiyanı saxla",
      salesCallLastUpdated: "Kvalifikasiya yenilənib: {date}",
    },
    inboxAnalytics: {
      handoffSalesReported: "Lidin kvalifikasiyası saxlanıldı",
      handoffSalesReportedDetail: "{n} lid hələ kvalifikasiya gözləyir",
      handoffSalesTeamHint: "Hər satıcı üzrə təyin edilmiş lidlər, saxlanmış kvalifikasiyalar və seçilmiş əlamətlər",
      colCallReports: "Kvalifikasiya edilmiş lidlər",
      colAwaitingReport: "Kvalifikasiya gözləyir",
      colCallOutcomes: "Kvalifikasiya əlamətləri",
    },
    inboxV2: {
      leadHandoffHint: "Satıcı lidin cari kvalifikasiyasını, məsələn «Maraqlanan» və ya «Potensial» kimi qeyd edəcək.",
    },
  },
} as const

describe("lead qualification copy stays distinct from per-call outcomes", () => {
  it.each(Object.entries(expected))("uses qualification language in %s", (locale, copy) => {
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8"),
    )

    for (const [namespace, values] of Object.entries(copy)) {
      for (const [key, value] of Object.entries(values)) {
        expect(messages[namespace][key], `${namespace}.${key}`).toBe(value)
      }
    }
    expect(messages.voip.callOutcome).not.toBe(messages.leads.salesCallResult)
  })

  it("uses the same qualification meaning in runtime errors, audit history, and the AI guide", () => {
    const leadRoute = readFileSync(
      join(process.cwd(), "src/app/api/v1/leads/[id]/route.ts"),
      "utf8",
    )
    expect(leadRoute.includes('message: "A short lead qualification note is required"')).toBe(true)
    expect(leadRoute.match(/Choose at least one compatible qualification signal/g)).toHaveLength(2)
    expect(leadRoute.includes('error: "Only the assigned salesperson can update the lead qualification"')).toBe(true)

    const inboxRoute = readFileSync(
      join(process.cwd(), "src/app/api/v1/inbox/conversations/[id]/route.ts"),
      "utf8",
    )
    expect(inboxRoute.includes('error: "Lead qualification must be updated from the assigned lead"')).toBe(true)

    const customerStage = readFileSync(
      join(process.cwd(), "src/lib/inbox/customer-stage.ts"),
      "utf8",
    )
    expect(customerStage.includes('reason: reason || "Lead qualification updated from lead card"')).toBe(true)

    const guide = readFileSync(
      join(process.cwd(), "src/lib/ai/voice/section-guide.ts"),
      "utf8",
    )
    expect(guide.includes("квалификация лида сохранена → продано")).toBe(true)
    expect(guide.includes("квалифицировано лидов, ждут квалификацию, признаки квалификации")).toBe(true)
  })
})
