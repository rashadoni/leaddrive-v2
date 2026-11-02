import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { ATTENDANCE_FEATURE_SETTING_KEY, attendanceFeatureOnSql, readAttendanceFeature } from "@/lib/mtm/attendance-feature"

// Architecture audit 2026-10-14, finding 9: the "Workday attendance" switch was
// read straight from mtm_settings in ~15 places. Stage 2c moves its control to
// Personnel → Settings; a copy left behind keeps half of the feature on after
// HR switches it off. Storage reads go through src/lib/mtm/attendance-feature.ts.
const STORAGE_READ = /attendanceEnabled/
const STORAGE_CONTEXT = /mtm_settings|mtmSetting\.|organizationId/
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe("Workday attendance switch", () => {
  it("is on only for an explicit true, and locks before reading when asked", async () => {
    const calls: string[] = []
    const db = (value: unknown) => ({
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => { calls.push(strings.join("?")); return [] }),
      mtmSetting: { findUnique: vi.fn(async () => value === undefined ? null : { value }) },
    }) as unknown as Parameters<typeof readAttendanceFeature>[0]
    expect(await readAttendanceFeature(db(true), "org")).toBe(true)
    expect(await readAttendanceFeature(db(undefined), "org")).toBe(false)
    expect(await readAttendanceFeature(db("true"), "org")).toBe(false)
    expect(calls).toEqual([])
    expect(await readAttendanceFeature(db(true), "org", { lock: true })).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain(`"key" = '${ATTENDANCE_FEATURE_SETTING_KEY}' FOR SHARE`)
  })

  it("binds an organization id and embeds a column reference in SQL", () => {
    const bound = attendanceFeatureOnSql("org-1")
    expect(bound.values).toEqual(["org-1"])
    expect(bound.sql).toContain(`s.key='${ATTENDANCE_FEATURE_SETTING_KEY}' AND s.value='true'::jsonb`)
    const column = attendanceFeatureOnSql(Prisma.raw('a."organizationId"'))
    expect(column.values).toEqual([])
    expect(column.sql).toContain(`s."organizationId"=a."organizationId"`)
  })

  it("is read from storage only in attendance-feature.ts", () => {
    const readers = sources("src").filter(file => !file.endsWith(join("mtm", "attendance-feature.ts"))).filter(file =>
      readFileSync(file, "utf8").split("\n").some(line => STORAGE_READ.test(line) && STORAGE_CONTEXT.test(line)))
    expect(readers).toEqual([])
  })
})
