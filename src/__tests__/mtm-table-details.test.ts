// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import type { MouseEvent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { openRowOnClick } from "@/lib/client/open-row"

// Owner-approved mockup, 2026-11-01 («мелочи» from the MTM UX audit): a table
// row opens its card, buttons say what they do in words, nothing smaller than
// 12 px, and a figure still loading is a grey bar rather than a dash.

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

function click(target: Element, row: Element, init: MouseEventInit = {}) {
  const native = new window.MouseEvent("click", { bubbles: true, button: 0, ...init })
  return { ...native, button: native.button, metaKey: native.metaKey, ctrlKey: native.ctrlKey, defaultPrevented: false, target, currentTarget: row } as unknown as MouseEvent<HTMLElement>
}

describe("MTM tables: the row opens its card", () => {
  afterEach(() => { document.body.innerHTML = "" })

  it("opens from a plain cell and leaves controls, portals and selections alone", () => {
    document.body.innerHTML = `<table><tbody><tr id="row"><td id="cell">Clinic</td><td><button id="btn">Assign</button><a id="link" href="/x">x</a><label><input id="box" type="checkbox"></label></td></tr></tbody></table><div id="portal" role="menuitem">Edit</div>`
    const row = document.getElementById("row")!
    const push = vi.fn()
    for (const id of ["btn", "link", "box", "portal"]) openRowOnClick(click(document.getElementById(id)!, row), "/card", push)
    expect(push).not.toHaveBeenCalled()

    openRowOnClick(click(document.getElementById("cell")!, row), "/card", push)
    expect(push).toHaveBeenCalledWith("/card")

    const open = vi.spyOn(window, "open").mockReturnValue(null)
    openRowOnClick(click(document.getElementById("cell")!, row, { ctrlKey: true }), "/card", push)
    expect(open).toHaveBeenCalledWith("/card", "_blank", "noopener")
    expect(push).toHaveBeenCalledTimes(1)
  })

  it("is wired on the organisation and client tables", () => {
    for (const path of ["src/components/mtm/organization-explorer.tsx", "src/components/mtm/contact-explorer.tsx"]) {
      expect(readFileSync(resolve(path), "utf8"), path).toMatch(/<tr[^>]*cursor-pointer[^>]*onClick=\{\(event\) => openRowOnClick\(/)
    }
  })
})

describe("«Müştərilər»: every row two lines, nothing runs into the next column", () => {
  // Owner, 2026-11-01: «всё лезет друг на друга». «planlaşdırılmayıb» did not
  // fit a tenth of the table and ran into the employee's name; a second
  // employee made the row twice as tall.
  const source = readFileSync(resolve("src/components/mtm/contact-explorer.tsx"), "utf8")

  it("keeps the next visit under the last one, in the same cell", () => {
    expect(source).not.toContain('t("nextVisit")}</HintValue>')
    expect(source).toMatch(/data-testid=\{`mtm-contact-last-visit-\$\{contact\.id\}`\}[\s\S]{0,900}data-testid=\{`mtm-contact-next-visit-\$\{contact\.id\}`\}/)
    expect(source).not.toContain('className="whitespace-nowrap px-3 py-2" data-testid={`mtm-contact-next-visit')
  })

  it("shows two employees at most, the second one grey", () => {
    expect(source).toContain("owners.slice(0, 2).map((owner, index)")
  })

  it("does not paint «none yet» orange in every row", () => {
    expect(source).not.toMatch(/font-semibold text-orange-600[^"]*">\{t\("noVisitHistory"\)\}<\/span>\}\s*<\/div>/)
    expect(source).toContain('<span className="text-muted-foreground">{t("noVisitHistory")}</span>')
  })
})

describe("MTM: words, sizes and loading", () => {
  it("leaves no icon-only button anywhere in the module", () => {
    // Owner, 2026-11-01: «пофикси мелочи» — the words go on every MTM button,
    // not only on the two lists of the mockup. MtmWord carries them.
    const offenders = [...sources(resolve("src/components/mtm")), ...sources(resolve("src/app/(dashboard)/mtm"))]
      .filter((path) => readFileSync(path, "utf8").includes('size="icon"'))
    expect(offenders).toEqual([])
  })

  it("sets no text below 12 px anywhere in the module", () => {
    const offenders = [...sources(resolve("src/components/mtm")), ...sources(resolve("src/app/(dashboard)/mtm"))]
      .filter((path) => /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/.test(readFileSync(path, "utf8")))
    expect(offenders).toEqual([])
  })

  it("draws a grey bar, not a dash, for a figure still on its way", () => {
    const kpi = readFileSync(resolve("src/components/mtm/home-parts.tsx"), "utf8")
    expect(kpi).toContain("const pending = loading && value === null")
    expect(readFileSync(resolve("src/components/mtm/home-dashboard.tsx"), "utf8")).toContain("loading={teamPending}")
    expect(readFileSync(resolve("src/components/mtm/attendance-today.tsx"), "utf8")).toContain("loading={!data}")
  })
})
