// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkforcePolicyComparisonTable, WorkforcePolicyVersionComparisonPage } from "@/components/workforce/workforce-policy-version-comparison"
import type { WorkforcePolicyVersionComparison } from "@/lib/workforce/policy-version-comparison"

const auth = vi.hoisted(() => ({ status: "authenticated", user: { id: "reader-a", organizationId: "org-a" } }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: auth.user }, status: auth.status }) }))
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children?: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const IntlProvider = NextIntlClientProvider as FunctionComponent<Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }>
const en = JSON.parse(readFileSync("messages/en.json", "utf8")).workforcePolicyVersionComparison
const choice = (id: string, version: number, teamId: string | null = null) => ({ id, name: "Policy " + version, version, status: "ACTIVE", teamId, team: teamId ? { name: "Operations" } : null })
const choices = [choice("opaque-before-id", 1), choice("opaque-after-id", 2)]
const metadata = (id: string, version: number) => ({ id, version, name: "Policy " + version, status: "ACTIVE" as const, effectiveFrom: "2026-11-01", effectiveTo: null, definitionHash: "a".repeat(64) })
function comparison(): WorkforcePolicyVersionComparison {
  return {
    basis: "RECORDED_DEFINITIONS_ONLY_NO_EFFECTIVE_IMPACT_OR_APPROVAL", scope: { kind: "ORGANIZATION", teamId: null },
    from: metadata(choices[0].id, 1), to: metadata(choices[1].id, 2),
    fields: [
      { field: "expectedWorkSeconds", before: 28_800, after: 25_200, changed: true, deltaSeconds: -3_600 },
      { field: "lateGraceSeconds", before: 0, after: 0, changed: false, deltaSeconds: 0 },
      { field: "undertimeToleranceSeconds", before: 300, after: 600, changed: true, deltaSeconds: 300 },
      { field: "overtimeThresholdSeconds", before: 0, after: null, changed: true, deltaSeconds: null },
      { field: "longPauseThresholdSeconds", before: null, after: 0, changed: true, deltaSeconds: null },
    ],
    changedCalculationFields: 4, opaqueDefinitionChanged: true,
    opaqueDefinitionInterpretation: "ADDITIONAL_HASH_VERIFIED_KEYS_NOT_DISPLAYED_OR_INTERPRETED",
  }
}
let container: HTMLDivElement, root: Root
let pending: Array<{ url: string; resolve: (response: Response) => void; signal: AbortSignal }>
function render(locale = "en", table = false) {
  const messages = JSON.parse(readFileSync("messages/" + locale + ".json", "utf8"))
  root.render(createElement(IntlProvider, { locale, messages, timeZone: "UTC" }, table ? createElement(WorkforcePolicyComparisonTable, { comparison: comparison() }) : createElement(WorkforcePolicyVersionComparisonPage)))
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status === 200, data, error: "PRIVATE_ERROR_PAYLOAD" }), { status })
async function find(query = "Policy") {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>("input")!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
}
async function answerSearch(index = pending.length - 1, rows = choices, hasMore = false, query = "Policy") {
  await act(async () => pending[index].resolve(response({ policies: rows, query, limit: 20, hasMore })))
}
async function select(side: "from" | "to", id: string) {
  await act(async () => {
    const picker = container.querySelector<HTMLSelectElement>("#workforce-policy-version-" + side)!
    picker.value = id; picker.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
const compareButton = () => container.querySelector<HTMLButtonElement>('button[type="button"]')!
async function startComparison() {
  await select("from", choices[0].id); await select("to", choices[1].id)
  await act(async () => compareButton().click())
}
async function loadedComparison() {
  await act(async () => render()); await find(); await answerSearch(); await startComparison()
  await act(async () => pending[1].resolve(response({ comparison: comparison() })))
}
beforeEach(() => {
  auth.status = "authenticated"; auth.user = { id: "reader-a", organizationId: "org-a" }
  pending = []
  vi.stubGlobal("fetch", vi.fn((url: string, options: { signal: AbortSignal }) => new Promise<Response>(resolve => pending.push({ url: String(url), resolve, signal: options.signal }))))
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("policy version comparison display", () => {
  it.each(["en", "ru", "az"])("renders five semantic rows and distinct null/zero/deltas in %s", async locale => {
    await act(async () => render(locale, true))
    const t = JSON.parse(readFileSync("messages/" + locale + ".json", "utf8")).workforcePolicyVersionComparison
    const rows = container.querySelectorAll("tbody tr")
    expect(rows).toHaveLength(5)
    expect(rows[1].textContent).not.toContain(t.notSet)
    expect(rows[3].querySelectorAll("td")[1].textContent).toBe(t.notSet)
    expect(rows[4].querySelectorAll("td")[0].textContent).toBe(t.notSet)
    expect(rows[4].querySelectorAll("td")[1].textContent).not.toBe(t.notSet)
    expect(rows[4].querySelectorAll("td")[2].textContent).toBe(t.notComparable)
    expect(rows[0].querySelectorAll("td")[2].textContent).toMatch(/[-−]/)
    expect(container.querySelectorAll('th[scope="row"]')).toHaveLength(5)
    expect(container.querySelector('[role="region"]')?.getAttribute("tabindex")).toBe("0")
    expect(container.textContent).toContain(t.opaqueChanged)
    expect(container.textContent).toContain(t.integrityHint)
    expect(container.textContent).not.toContain(choices[0].id)
    expect(container.textContent).not.toContain("a".repeat(64))
  })
  it("does not request a catalog before a named search or expose opaque identifiers as labels", async () => {
    await act(async () => render()); expect(pending).toHaveLength(0)
    await find(); expect(pending[0].url).toBe("/api/v1/workforce/configuration/policies/search?q=Policy")
    await answerSearch()
    expect(container.textContent).toContain(en.statuses.ACTIVE)
    expect(container.textContent).not.toContain(choices[0].id)
    expect(compareButton().disabled).toBe(true)
  })
  it("requires two different versions in one scope", async () => {
    await act(async () => render()); await find()
    await answerSearch(0, [...choices, choice("team-version", 3, "team-id")])
    await select("from", choices[0].id); await select("to", choices[0].id); expect(compareButton().disabled).toBe(true)
    await select("to", "team-version"); expect(compareButton().disabled).toBe(true)
    await select("to", choices[1].id); expect(compareButton().disabled).toBe(false)
  })
  it("shows the truthful cap hint and retains named selections across a second search", async () => {
    await act(async () => render()); await find(); await answerSearch(0, choices, true)
    expect(container.textContent).toContain(en.refine)
    await select("from", choices[0].id); await select("to", choices[1].id)
    await find("Other"); await answerSearch(1, [], false, "Other")
    expect(container.querySelector<HTMLSelectElement>("#workforce-policy-version-from")!.value).toBe(choices[0].id)
    expect(compareButton().disabled).toBe(false)
    expect(container.textContent).not.toContain(en.refine)
  })
  it("discards an aborted older named search response", async () => {
    await act(async () => render()); await find(); await find("Newest")
    expect(pending[0].signal.aborted).toBe(true)
    await answerSearch(1, [choice("newest", 3)], false, "Newest"); await answerSearch(0)
    expect(container.textContent).toContain("Policy 3"); expect(container.textContent).not.toContain("Policy 1")
  })
  it("clears a rendered result immediately when either selection changes", async () => {
    await loadedComparison(); expect(container.querySelector("table")).not.toBeNull()
    await select("to", ""); expect(container.querySelector("table")).toBeNull(); expect(compareButton().disabled).toBe(true)
  })
  it("discards a comparison response after a selection change", async () => {
    await act(async () => render()); await find(); await answerSearch(); await startComparison()
    expect(pending[1].url).toContain("from=opaque-before-id&to=opaque-after-id")
    await select("to", ""); expect(pending[1].signal.aborted).toBe(true)
    await act(async () => pending[1].resolve(response({ comparison: comparison() })))
    expect(container.querySelector("table")).toBeNull()
  })
  it("rejects a result for a different selected pair without exposing server errors", async () => {
    await act(async () => render()); await find(); await answerSearch(); await startComparison()
    const wrong = comparison(); wrong.to.id = "other-id"
    await act(async () => pending[1].resolve(response({ comparison: wrong })))
    expect(container.querySelector("table")).toBeNull(); expect(container.textContent).toContain(en.compareFailed)
    expect(container.textContent).not.toContain("PRIVATE_ERROR_PAYLOAD")
  })
  it.each(["organization", "reader", "loading", "unauthenticated"])("clears every selected version and result on a %s transition", async transition => {
    await loadedComparison()
    if (transition === "organization") auth.user.organizationId = "org-b"
    else if (transition === "reader") auth.user.id = "reader-b"
    else auth.status = transition
    await act(async () => render())
    expect(container.querySelector("table")).toBeNull(); expect(container.textContent).not.toContain("Policy 1")
    expect(pending).toHaveLength(2)
    if (transition === "organization" || transition === "reader") expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("")
  })
  it.each(["loading", "unauthenticated"])("requires a new search after same-reader reauthentication through %s", async transition => {
    await loadedComparison(); auth.status = transition; await act(async () => render())
    auth.status = "authenticated"; await act(async () => render())
    expect(container.querySelector("table")).toBeNull(); expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("")
    expect(pending).toHaveLength(2)
    await find(); await act(async () => pending[2].resolve(response({}, 403)))
    expect(container.textContent).toContain(en.denied); expect(container.querySelector("select")).toBeNull()
  })
  it("aborts an in-flight comparison on a session change and ignores its eventual success", async () => {
    await act(async () => render()); await find(); await answerSearch(); await startComparison()
    auth.user.organizationId = "org-b"; await act(async () => render())
    expect(pending[1].signal.aborted).toBe(true)
    await act(async () => pending[1].resolve(response({ comparison: comparison() })))
    expect(container.querySelector("table")).toBeNull(); expect(container.textContent).not.toContain("Policy 1")
  })
  it("clears selections and results if fresh search authorization is denied", async () => {
    await loadedComparison(); await find("Other")
    await act(async () => pending[2].resolve(response({}, 403)))
    expect(container.textContent).toContain(en.denied); expect(container.querySelector("table")).toBeNull()
    expect(container.textContent).not.toContain("Policy 1"); expect(container.textContent).not.toContain("PRIVATE_ERROR_PAYLOAD")
  })
})
