import { describe, expect, it } from "vitest"
import { readdirSync } from "node:fs"
import { join, relative } from "node:path"

const APP_ROOT = join(process.cwd(), "src/app")
const DYNAMIC_SEGMENT = /^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/

function findConflictingDynamicSiblings(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  const dynamicNames = entries
    .map((entry) => DYNAMIC_SEGMENT.exec(entry.name)?.[1])
    .filter((name): name is string => Boolean(name))
  const conflicts = dynamicNames.length > 1
    ? [`${relative(APP_ROOT, directory) || "."}: ${dynamicNames.join(", ")}`]
    : []

  return entries.reduce<string[]>(
    (found, entry) => found.concat(findConflictingDynamicSiblings(join(directory, entry.name))),
    conflicts,
  )
}

describe("Next.js dynamic route segments", () => {
  it("uses one slug name for dynamic siblings under the same parent", () => {
    expect(findConflictingDynamicSiblings(APP_ROOT)).toEqual([])
  })
})
