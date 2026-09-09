import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  MTM_STATUS_GROUPS,
  isMtmStatusValue,
  mtmStatusKey,
  mtmStatusLabel,
  type MtmStatusGroup,
} from "@/lib/mtm/status-labels"

/**
 * Field UX audit 2026-09-05, task A5 (Definition of Done rule 3): no enum
 * value reaches the interface. The dictionary must cover every Prisma enum
 * it stands for, in all three languages, and the screens that used to print
 * the raw value must go through it.
 */
const schema = readFileSync("prisma/schema.prisma", "utf8")

function prismaEnum(name: string): string[] {
  const match = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`))
  if (!match) throw new Error(`enum ${name} not found`)
  return match[1].split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("//"))
}

const PRISMA_ENUMS: Partial<Record<MtmStatusGroup, string>> = {
  visit: "MtmVisitStatus",
  visitOutcome: "MtmVisitOutcome",
  customer: "MtmCustomerStatus",
  customerType: "MtmCustomerObjectType",
  role: "MtmAgentRole",
  route: "MtmRouteStatus",
  task: "MtmTaskStatus",
  dayKind: "MtmWorkCalendarDayKind",
  importJob: "MtmImportStatus",
}

function messages(locale: string): Record<string, Record<string, Record<string, string> | string>> {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmStatus
}

describe("MTM status dictionary", () => {
  it.each(Object.keys(PRISMA_ENUMS) as MtmStatusGroup[])("covers every value of the %s enum", (group) => {
    for (const value of prismaEnum(PRISMA_ENUMS[group]!)) {
      expect(MTM_STATUS_GROUPS[group] as readonly string[], `${group}.${value}`).toContain(value)
    }
  })

  it.each(["az", "ru", "en"])("has a %s label for every value and the unknown fallback", (locale) => {
    const catalog = messages(locale)
    expect(catalog.unknown).toEqual(expect.any(String))
    for (const [group, values] of Object.entries(MTM_STATUS_GROUPS)) {
      for (const value of values) {
        const label = (catalog[group] as Record<string, string> | undefined)?.[value]
        expect(label, `${locale}: mtmStatus.${group}.${value}`).toEqual(expect.any(String))
        expect(label, `${locale}: mtmStatus.${group}.${value} is still the raw value`).not.toBe(value)
      }
    }
  })

  it("resolves labels and never returns the raw identifier", () => {
    const t = (key: string) => `<${key}>`
    expect(mtmStatusKey("visit", "CHECKED_OUT")).toBe("visit.CHECKED_OUT")
    expect(mtmStatusKey("role", " agent ")).toBe("role.AGENT")
    expect(mtmStatusKey("route", "SOMETHING_ELSE")).toBe("unknown")
    expect(mtmStatusLabel(t, "dayKind", "WEEKEND")).toBe("<dayKind.WEEKEND>")
    expect(mtmStatusLabel(t, "dayKind", null)).toBe("<unknown>")
    expect(isMtmStatusValue("customer", "ACTIVE")).toBe(true)
    expect(isMtmStatusValue("customer", "Active")).toBe(false)
  })

  it("keeps the raw value out of the screens that used to print it", () => {
    const sources: Array<[string, string[]]> = [
      ["src/components/mtm/contact-scoring-entry-dialogs.tsx", ["{agent.name} · {agent.role}"]],
      ["src/components/mtm/route-builder.tsx", ['className="text-xs text-muted-foreground">{agent.role}</span>']],
      ["src/components/mtm/customer-request-queue.tsx", ["· ${request.route.status}`"]],
      ["src/components/mtm/excel-exchange-panel.tsx", ["{job.status}</span>"]],
      ["src/components/mtm/pharmacy-promotion-detail.tsx", [": detail.eligibility.status}"]],
      ["src/components/mtm/pharmacy-promotion-campaign-admin.tsx", [": version.status}"]],
      ["src/components/mtm/pharmacy-promotion-agent-capture.tsx", [": selectedTarget.eligibilityStatus", ": selectedCorrection.status"]],
      // A5 tail: the photos page printed PENDING in the badge and said
      // "Photo approved" in English whatever the interface language.
      ["src/app/(dashboard)/mtm/photos/page.tsx", [
        "{photo.status}</span>",
        "`Photo ${status.toLowerCase()}`",
        "(${photo.status})",
        "Failed to update photo",
      ]],
      // A5 tail: the agents page translated with two local conditional lists,
      // so an unknown value printed raw and an ADMIN was shown as a manager.
      ["src/app/(dashboard)/mtm/agents/page.tsx", [
        'role === "SUPERVISOR" ? t("roleSupervisor")',
        's === "ACTIVE" ? t("filterActive")',
      ]],
    ]
    for (const [file, fragments] of sources) {
      const text = readFileSync(file, "utf8")
      for (const fragment of fragments) expect(text, `${file} still prints ${fragment}`).not.toContain(fragment)
    }
  })

  it("has a label for every photo status the schema allows", () => {
    // The three values come from MtmPhotoStatus in prisma/schema.prisma; a
    // fourth added there without a label here would render as "not specified"
    // rather than as the identifier, and this test says so out loud.
    expect(MTM_STATUS_GROUPS.photo).toEqual(["PENDING", "APPROVED", "REJECTED"])
    const schema = readFileSync("prisma/schema.prisma", "utf8")
    const block = schema.slice(schema.indexOf("enum MtmPhotoStatus"))
    const values = block.slice(block.indexOf("{") + 1, block.indexOf("}")).split("\n")
      .map((line) => line.trim()).filter(Boolean)
    expect(values).toEqual([...MTM_STATUS_GROUPS.photo])
  })

  it("has a label for every agent role and status the schema allows", () => {
    // Two local lists drifted from the schema in two ways at once: ADMIN and
    // MANAGER shared one label, and anything unlisted printed as itself. The
    // dictionary cannot drift silently — this compares it to the enums.
    const schema = readFileSync("prisma/schema.prisma", "utf8")
    for (const [enumName, group] of [["MtmAgentRole", "role"], ["MtmAgentStatus", "agentStatus"]] as const) {
      const block = schema.slice(schema.indexOf(`enum ${enumName}`))
      const values = block.slice(block.indexOf("{") + 1, block.indexOf("}")).split("\n")
        .map((line) => line.trim()).filter(Boolean)
      expect(values, `${enumName} drifted from ${group}`).toEqual([...MTM_STATUS_GROUPS[group]])
    }
  })

  it("keeps the calendar kind out of the mobile week's human reason", () => {
    const route = readFileSync("src/app/api/v1/mtm/mobile/week/route.ts", "utf8")
    expect(route).not.toContain("calendarDay.name ?? calendarDay.kind")
    expect(route).toContain("calendarKind: calendarDay.kind")
  })
})
