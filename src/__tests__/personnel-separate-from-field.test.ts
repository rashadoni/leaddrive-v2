// @vitest-environment jsdom
/**
 * Personnel («Kadr uçotu») and Route & Field are two ticks (owner, 2026-11-21:
 * «они не агенты… отдельно нужно, сейчас они объединены»). What matters is what
 * one person then gets: the menu, the first page after login, and the switch
 * the menu reads, for someone the MTM settings route refuses.
 */
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { accessibleNavItems } from "@/lib/nav-items"
import { resolveTenantLandingPath } from "@/lib/tenant-landing"
import { applyUserModuleMask, USER_HIDEABLE_MODULE_IDS } from "@/lib/user-module-access"
import { useMtmOrgSettings, type MtmNavOrgSettings } from "@/hooks/use-mtm-org-settings"

const tenant = { plan: "enterprise", addons: [] as string[], modules: { crm: true, mtm: true, settings: true } }
const onlyTick = (id: string) => USER_HIDEABLE_MODULE_IDS.filter((entry) => entry !== id)
const person = (hiddenModules: string[]) => ({
  ...tenant, role: "manager", hiddenModules, modules: applyUserModuleMask(tenant, hiddenModules),
})
const workGroups = (hiddenModules: string[]) => [...new Set(
  accessibleNavItems({ ...person(hiddenModules), orgSettings: { attendanceEnabled: true } })
    .map((item) => item.group).filter((group) => group !== "Settings"),
)]

describe("two ticks, two sections", () => {
  it("HR sees Personnel and no Route & Field", () => {
    expect(workGroups(onlyTick("personnel"))).toEqual(["Personnel"])
  })

  it("a field person sees Route & Field and no Personnel", () => {
    expect(workGroups(onlyTick("mtm"))).toEqual(["Route & Field"])
  })

  it("HR lands in Personnel after login, a person with more modules does not", () => {
    expect(resolveTenantLandingPath(person(onlyTick("personnel")))).toBe("/mtm/attendance")
    expect(resolveTenantLandingPath(person([]))).toBe("/dashboard")
  })
})

describe("the menu switch for someone without Route & Field", () => {
  afterEach(() => vi.unstubAllGlobals())

  async function read(orgId: string, status: number) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => ({}) }))
    vi.stubGlobal("fetch", fetchMock)
    let seen: MtmNavOrgSettings = {}
    const Probe = () => {
      seen = useMtmOrgSettings({ ...person(onlyTick("personnel")), organizationId: orgId })
      return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => { root.render(createElement(Probe)) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    await act(async () => { root.unmount() })
    return { seen, urls: fetchMock.mock.calls.map((call) => (call as unknown[])[0]) }
  }

  it("asks the attendance entry point, not the field settings", async () => {
    expect(await read("org-hr-on", 200)).toEqual({ seen: { attendanceEnabled: true }, urls: ["/api/v1/mtm/attendance"] })
  })

  it("reads 404 as the section being off", async () => {
    expect((await read("org-hr-off", 404)).seen).toEqual({ attendanceEnabled: false })
  })

  it("leaves a refusal unknown, so the menu stays hidden", async () => {
    expect((await read("org-hr-refused", 403)).seen).toEqual({})
  })
})
