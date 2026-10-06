// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const state = vi.hoisted(() => ({ org: "org-a", user: "user-a", role: "admin", t: (key: string) => key, success: vi.fn(), error: vi.fn() }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: { user: { id: state.user, organizationId: state.org, role: state.role } } }) }))
vi.mock("next-intl", () => ({ useTranslations: () => state.t }))
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }))
vi.mock("@/components/page-description", () => ({ PageDescription: ({ title }: { title: string }) => createElement("h1", null, title) }))
import { WorkforceConfigurationWorkbench } from "@/components/workforce/workforce-configuration-workbench"

const employees = ["a", "b"].map(id => ({ id, name: `Person ${id}`, status: "ACTIVE", team: null }))
const shifts = ["s1", "s2"].map(id => ({ id, name: `Shift ${id}`, code: id, teamId: null, status: "ACTIVE" }))
const sites = ["p1", "p2"].map(id => ({ id, name: `Site ${id}`, code: id, status: "ACTIVE", timezone: "Asia/Baku", type: "OFFICE" }))
const data = { policies: [], shifts: [], assignments: [], sites, defaultAssignments: [], teamDefaultAssignments: [], directoryEmployees: employees, roster: { employees, teams: [], shiftTemplates: shifts, query: "", limit: 200, hasMore: false } }
const preview = { summary: { READY: 1, NO_CHANGE: 0, CONFLICT: 0, EMPLOYEE_UNAVAILABLE: 0, TEMPLATE_TEAM_MISMATCH: 0 }, items: [{ agentId: "a", outcome: "READY" }] }
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => ({ success: status < 400, data: body }) })
function deferred() { let resolve!: (value: ReturnType<typeof response>) => void; let reject!: (error: Error) => void; const promise = new Promise<ReturnType<typeof response>>((a,b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
let container: HTMLDivElement; let root: Root
const transport = vi.fn()
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const render = () => act(async () => { root.render(createElement(WorkforceConfigurationWorkbench)) })
function field(id: string) { const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`); if (!el) throw new Error(`Missing field ${id}`); return el }
async function change(id: string, value: string) {
 const el = field(id); await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el,value); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input",{bubbles:true})) })
}
async function click(el: HTMLElement) { await act(async () => { el.click() }) }
function button(label: string) { const el = [...container.querySelectorAll("button")].find(b => b.textContent === label); if (!el) throw new Error(`Missing button ${label}`); return el }
function requests(suffix: string) { return transport.mock.calls.filter(([url]) => String(url).endsWith(suffix)) }
beforeEach(async () => { state.org="org-a"; state.user="user-a"; state.role="admin"; vi.clearAllMocks(); transport.mockImplementation(async (_url, options) => options.method === "GET" ? response(data) : response(preview)); vi.stubGlobal("fetch",transport); container=document.createElement("div"); document.body.append(container); root=createRoot(container); await render(); await flush() })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

for (const kind of ["shift", "site"] as const) {
 const site=kind==="site"; const prefix=site?"workforce-bulk-site-assignment":"workforce-bulk-assignment"; const review=site?"reviewBulkSiteAssignmentDraft":"reviewBulkAssignmentDraft"; const publish=site?"publishBulkSiteAssignment":"publishBulkAssignment";
 async function prepare() { await change(`${prefix}-${site?"site":"template"}`,site?"p1":"s1"); await change(`${prefix}-effective-from`,"2027-01-02"); await click(field(`${prefix}-employee-a`)) }
 async function showPreview() { await prepare(); await click(button(review)); await flush() }
 describe(`${kind} bulk reviewed intent`, () => {
  for (const edit of ["date","target","employee"] as const) it(`ignores a held preview after ${edit} changes`,async () => {
   await prepare(); const held=deferred(); transport.mockImplementationOnce(() => held.promise); await click(button(review));
   if(edit==="date") await change(`${prefix}-effective-from`,"2027-01-03")
   if(edit==="target") await change(`${prefix}-${site?"site":"template"}`,site?"p2":"s2")
   if(edit==="employee") await click(field(`${prefix}-employee-b`))
   held.resolve(response(preview)); await flush(); expect(container.querySelector(`#${prefix}-publish-confirm`)).toBeNull(); expect(requests("/bulk/publish")).toHaveLength(0)
  })
  it("discards the draft without sending a mutation",async()=>{await showPreview(); await click([...field(`${prefix}-effective-from`).closest("form")!.querySelectorAll("button")].find(b=>b.textContent==="discardBulkAssignmentDraft")!); expect(field(`${prefix}-effective-from`).value).toBe(""); expect(container.querySelector(`#${prefix}-publish-confirm`)).toBeNull(); expect(requests("/bulk/publish")).toHaveLength(0)})
  it("requires explicit confirmation, freezes publish inputs and retries unknown outcome with the same key/body",async()=>{
   await showPreview(); expect(button(publish).disabled).toBe(true); await click(field(`${prefix}-publish-confirm`)); const held=deferred(); transport.mockImplementationOnce(()=>held.promise); await click(button(publish));
   expect(field(`${prefix}-effective-from`).closest("form")!.querySelector("fieldset[disabled]")).not.toBeNull(); await click(button(publish)); expect(requests("/bulk/publish")).toHaveLength(1)
   held.reject(new TypeError("Network unavailable")); await flush(); expect(button(review).disabled).toBe(true); expect(container.textContent).toContain("bulkPublishOutcomeUnknown"); const first=requests("/bulk/publish")[0][1].body
   transport.mockImplementationOnce(()=>Promise.resolve(response({operation:{createdCount:1,unchangedCount:0,idempotent:true}}))); await click(button(publish)); await flush()
   expect(requests("/bulk/publish")).toHaveLength(2); expect(requests("/bulk/publish")[1][1].body).toBe(first); expect(JSON.parse(first).operationId).toMatch(/^[a-f0-9-]{36}$/); expect(field(`${prefix}-effective-from`).value).toBe("")
  })
  it("requires fresh review after an intentional edit following unknown publish",async()=>{
   await showPreview(); await click(field(`${prefix}-publish-confirm`)); transport.mockImplementationOnce(()=>Promise.reject(new TypeError("Network unavailable"))); await click(button(publish)); await flush(); await change(`${prefix}-effective-from`,"2027-01-03"); expect(container.querySelector(`#${prefix}-publish-confirm`)).toBeNull(); expect(button(review).disabled).toBe(false)
  })
  for(const context of ["tenant","principal","role"] as const) it(`clears a held preview after ${context} changes`,async()=>{
   await prepare(); const held=deferred(); transport.mockImplementationOnce(()=>held.promise); await click(button(review)); if(context==="tenant")state.org="org-b";if(context==="principal")state.user="user-b";if(context==="role")state.role="superadmin";await render();await flush();held.resolve(response(preview));await flush();expect(field(`${prefix}-effective-from`).value).toBe("");expect(container.querySelector(`#${prefix}-publish-confirm`)).toBeNull()
  })
  it("does not clear or announce an old principal's late successful publish",async()=>{
   await showPreview();await click(field(`${prefix}-publish-confirm`));const held=deferred();transport.mockImplementationOnce(()=>held.promise);await click(button(publish));state.user="user-b";await render();await flush();await prepare();held.resolve(response({operation:{createdCount:1,unchangedCount:0}}));await flush();expect(field(`${prefix}-effective-from`).value).toBe("2027-01-02");expect(state.success).not.toHaveBeenCalled()
  })
  it("keeps conflict results non-publishable",async()=>{await prepare();transport.mockImplementationOnce(()=>Promise.resolve(response({...preview,summary:{...preview.summary,READY:0,CONFLICT:1},items:[{agentId:"a",outcome:"CONFLICT"}]})));await click(button(review));await flush();expect(container.querySelector(`#${prefix}-publish-confirm`)).toBeNull();expect(requests("/bulk/publish")).toHaveLength(0)})
 })
}
