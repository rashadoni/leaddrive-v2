import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Owner, 2026-09-21, after the field app was simplified: «всё напичкано,
 * растянуто, непонятно с первого раза» — and then the audit of the admin
 * module found the same disease. Five screens opened with a panel titled
 * «Для чего нужен этот раздел?» / «Три шага, чтобы…» and numbered steps 1-2-3
 * that repeated the navigation standing right next to them. A screen that
 * needs a manual on top of itself is the defect; the manual is not the fix.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe("the field module explains itself by being clear, not by a manual", () => {
  it("renders no three-step orientation panel on any screen", () => {
    const offenders = [...sources("src/app/(dashboard)/mtm"), ...sources("src/components/mtm")]
      .filter((path) => readFileSync(path, "utf8").includes("<MtmWorkflowGuide"))
    expect(offenders).toEqual([])
  })

  it("no longer ships the component that drew it", () => {
    expect(existsSync("src/components/mtm/mtm-workflow-guide.tsx")).toBe(false)
  })
})
