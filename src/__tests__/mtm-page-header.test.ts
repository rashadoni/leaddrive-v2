// One page header across MTM (owner 2026-10-31, from a before/after picture):
// a large title and a plain «Kömək» last. Fourteen pages printed their name in
// 14 px through the CRM-wide PageDescription beside an orange «Kömək» plaque.
import { execFileSync } from "child_process"
import { readFileSync } from "fs"
import { describe, expect, it } from "vitest"

const MTM_FILES = execFileSync("git", ["ls-files", "src/app/(dashboard)/mtm", "src/components/mtm"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => file.endsWith(".tsx"))

// The agent's own home keeps its greeting header; only the team screens moved.
const KEEPS_PAGE_DESCRIPTION = new Set(["src/app/(dashboard)/mtm/page.tsx"])

describe("MTM page header", () => {
  it("is drawn by MtmPageHeader, not by the CRM-wide 14 px PageDescription", () => {
    const offenders = MTM_FILES.filter((file) => !KEEPS_PAGE_DESCRIPTION.has(file)
      && /<PageDescription\b/.test(readFileSync(file, "utf8")))
    expect(offenders).toEqual([])
  })

  it("shows «Kömək» as a plain outlined button, not the orange plaque", () => {
    const offenders = MTM_FILES.filter((file) => /<HelpButton\b[^>]*variant="label"/.test(readFileSync(file, "utf8")))
    expect(offenders).toEqual([])
  })

  it("never leaves «Kömək» as a round «?» without its word", () => {
    // «Marşrutlar», «Marşrut təqvimi» kept the orange icon and round «?» after
    // the header pass; the owner asked to finish the small things (2026-11-01).
    const offenders = MTM_FILES.filter((file) => [...readFileSync(file, "utf8").matchAll(/<HelpButton\b[^>]*>/g)]
      .some(([tag]) => !tag.includes('variant="quiet"')))
    expect(offenders).toEqual([])
  })

  it("puts the title in an h1", () => {
    const header = readFileSync("src/components/mtm/page-header.tsx", "utf8")
    expect(header).toMatch(/<h1 className="text-2xl font-semibold tracking-tight">/)
  })
})
