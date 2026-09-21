import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CAMPAIGNS, LEADS as LEGEND_LEADS, MAIL, TASKS as LEGEND_TASKS } from "../../scripts/seeds/demo-journey-legend.mjs"

/**
 * The guided demo's intro clips are filmed on this stand, and a prospect
 * watches them. On 2026-09-21 two help-library clips turned out to be filmed
 * on a real organisation's records; these checks keep the stand that
 * replaces them invented, and keep its seeder from reaching past its own rows.
 */
const legend = readFileSync("scripts/seeds/demo-journey-legend.mjs", "utf8")
const seeder = readFileSync("scripts/seeds/demo-journey-clips.mjs", "utf8")
const rescorer = readFileSync("scripts/seeds/demo-journey-clips-rescore.mjs", "utf8")
const workflow = readFileSync(".github/workflows/seed-demo-journey-clips.yml", "utf8")
const reel = readFileSync("scripts/seeds/inbox-reel-demo.mjs", "utf8")

// The legend is plain JS, whose rows differ in which optional fields they
// carry; read them through the shape the checks below rely on.
const LEADS = LEGEND_LEADS as ReadonlyArray<{ contactName: string; email?: string }>
const TASKS = LEGEND_TASKS as Record<string, ReadonlyArray<{ title: string; lead?: string }>>

/** Comments explain what the file must not do; only code is searched. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

// The brands that already live in this repository's other seeders — the most
// likely thing to be copied in (see tour-legend-safety.test.ts).
const REAL_BRANDS = [
  "Azercell", "SOCAR", "Pasha", "Kapital", "Bravo", "Azersun", "AzerGold",
  "Silk Way", "ASAN", "Pepsi", "Mars Overseas", "Araz", "Neptun", "KFC",
  "McDonald", "CinemaPlus", "Ramada", "Hilton", "Chenot", "TABİA", "Zeytun",
  "LeadDrive Inc",
]

describe("demo clip stand legend", () => {
  it("writes no real brand", () => {
    // Code only: the seeder's header has to say whose records the old clips showed.
    for (const brand of REAL_BRANDS) {
      expect(code(legend).includes(brand), `legend names ${brand}`).toBe(false)
      expect(code(seeder).includes(brand), `seeder names ${brand}`).toBe(false)
    }
  })

  it("has no phone number and mails only a reserved .example domain", () => {
    expect(code(legend)).not.toMatch(/\+?\d[\d\s()-]{7,}\d/)
    expect(MAIL.endsWith(".example")).toBe(true)
    for (const lead of LEADS) {
      if (lead.email) expect(lead.email.endsWith(`@${MAIL}`), lead.email).toBe(true)
    }
  })

  it("casts people the Omni-channel reel does not", () => {
    const reelCustomers = reel.slice(reel.indexOf("const CUSTOMERS"), reel.indexOf("]", reel.indexOf("const CUSTOMERS")))
    for (const lead of LEADS) {
      expect(reelCustomers.includes(lead.contactName), `${lead.contactName} is in the reel`).toBe(false)
    }
  })

  it("leaves no campaign in a state a worker would pick up and send", () => {
    for (const campaign of CAMPAIGNS) {
      expect(["sent", "scheduled", "draft", "cancelled"], campaign.name).toContain(campaign.status)
    }
  })

  it("links tasks only to leads the legend has", () => {
    const names = new Set(LEADS.map((lead) => lead.contactName))
    for (const task of Object.values(TASKS).flat()) {
      if (task.lead) expect(names.has(task.lead), task.title).toBe(true)
    }
  })

  it("leaves the scores to the product", () => {
    expect(code(legend)).not.toMatch(/\bscore\s*:/)
    expect(code(seeder)).not.toMatch(/\bscore\s*:/)
    expect(rescorer).toContain("/api/v1/leads/")
  })
})

describe("demo clip stand seeder", () => {
  it("refuses to run without the allow-listed tenant and a confirmation", () => {
    expect(seeder).toContain('const ALLOWED_SLUGS = new Set(["demo"])')
    expect(seeder).toContain("process.env.CONFIRM_PROD")
    expect(rescorer).toContain('auth.organizationSlug !== "demo"')
  })

  it("deletes only rows the legend names, inside the organisation", () => {
    const source = code(seeder)
    const deletes: string[] = []
    for (let at = source.indexOf("deleteMany("); at !== -1; at = source.indexOf("deleteMany(", at + 1)) {
      let depth = 0
      let end = at + "deleteMany".length
      do {
        if (source[end] === "(") depth += 1
        if (source[end] === ")") depth -= 1
        end += 1
      } while (depth > 0 && end < source.length)
      deletes.push(source.slice(at, end))
    }
    expect(deletes).toHaveLength(5)
    for (const call of deletes) {
      expect(call, call).toContain("organizationId: orgId")
      expect(call, call).toMatch(/\bin:/)
    }
  })

  it("never writes the reel's rows", () => {
    for (const table of ["contact", "socialConversation", "channelMessage", "chatbotRule", "kbArticle", "organization.update", "user.update", "user.create"]) {
      expect(code(seeder).includes(`prisma.${table}`), table).toBe(false)
    }
  })

  it("ships every module the seeder imports to the server", () => {
    for (const file of ["scripts/_rls.mjs", "scripts/seeds/tour-legend.mjs", "scripts/seeds/demo-journey-legend.mjs", "scripts/seeds/demo-journey-clips.mjs"]) {
      expect(workflow, file).toContain(file)
    }
    expect(workflow).toContain("runs-on: ubuntu-24.04")
    expect(workflow).not.toContain("pull_request_target")
  })
})
