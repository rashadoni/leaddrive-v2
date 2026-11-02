import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }))
const { default: PersonnelTimesheetPage } = await import("@/app/(dashboard)/mtm/attendance/timesheet/page")
const { MtmAttendanceReportWorkspace } = await import("@/components/mtm/attendance-report-workspace")
const { MtmAttendanceMonths } = await import("@/components/mtm/attendance-months")

type Props = { initialForm?: string; initialDate?: string; initialEmployeeId?: string; initialFilter?: string }
async function open(params: Record<string, string>) {
  return await PersonnelTimesheetPage({ searchParams: Promise.resolve(params) }) as ReactElement<Props & { children?: unknown }>
}

// Owner, 2026-10-14: nine timesheet tabs were too many to explain to HR. The
// page is one month grid now; links into the former tabs must still land.
describe("Personnel → Timesheet page", () => {
  it("opens the month grid with no tab row", async () => {
    const page = await open({})
    expect(page.type).toBe(MtmAttendanceReportWorkspace)
    expect(page.props).toMatchObject({ initialForm: "MONTH", initialFilter: undefined })
  })

  it.each([
    [{ tab: "late" }, { initialFilter: "late" }],
    [{ tab: "absence" }, { initialFilter: "absent" }],
    [{ tab: "overtime" }, { initialFilter: "overtime" }],
    [{ tab: "journal" }, { initialFilter: "missing-finish" }],
    [{ tab: "journal", date: "2026-10-13", employeeId: "e1" }, { initialFilter: undefined, initialDate: "2026-10-13", initialEmployeeId: "e1" }],
    [{ tab: "days", date: "2026-10-13" }, { initialFilter: undefined, initialDate: "2026-10-13" }],
    [{ filter: "missing-finish" }, { initialFilter: "missing-finish" }],
    [{ filter: "anything" }, { initialFilter: undefined }],
  ])("keeps the former link %j working", async (params, expected) => {
    const page = await open(params)
    expect(page.type).toBe(MtmAttendanceReportWorkspace)
    expect(page.props).toMatchObject({ initialForm: "MONTH", ...expected })
  })

  it.each<Record<string, string>>([{ view: "months" }, { tab: "months" }])("opens a rarer report from More with a way back (%j)", async params => {
    const page = await open(params)
    const children = page.props.children as ReactElement<{ href?: string }>[]
    expect(children[0].props.href).toBe("/mtm/attendance/timesheet")
    expect(children[1].type).toBe(MtmAttendanceMonths)
  })
})

// CI E2E, 2026-10-14: the page imported the filter list from a "use client"
// file. On the server such a value is a client-reference stub, so `.includes`
// threw and the page showed "Something went wrong" while jsdom tests passed.
describe("Personnel server pages", () => {
  function pages(dir: string): string[] {
    return readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? pages(join(dir, name)) : name === "page.tsx" || name === "layout.tsx" ? [join(dir, name)] : [])
  }
  function resolve(spec: string): string | null {
    if (!spec.startsWith("@/")) return null
    const base = join("src", spec.slice(2))
    return [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")].find(existsSync) ?? null
  }
  it("take only components and types from client modules", () => {
    const offenders: string[] = []
    for (const file of pages("src/app/(dashboard)/mtm/attendance")) {
      const source = readFileSync(file, "utf8")
      if (/^["']use client["']/m.test(source)) continue
      for (const match of source.matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s+from\s+"([^"]+)"/gm)) {
        const target = resolve(match[2])
        if (!target || !/^["']use client["']/.test(readFileSync(target, "utf8").trimStart())) continue
        const values = match[1].split(",").map(name => name.trim()).filter(name => name && !name.startsWith("type ") && !/^[A-Z][a-z]/.test(name))
        offenders.push(...values.map(name => `${file}: ${name} from ${match[2]}`))
      }
    }
    expect(offenders).toEqual([])
  })
})
