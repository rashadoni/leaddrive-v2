import { describe, expect, it, vi } from "vitest"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import {
  HISTORICAL_LAYOUT_BEFORE_SHA, HISTORICAL_LAYOUT_CONTROLS, HISTORICAL_LAYOUT_ROUTES,
  assertHistoricalCaptureEnvironment, assertHistoricalSeedEnvironment, assertHistoricalSemanticData,
  chooseHistoricalAnchor, compareHistoricalLayouts, historicalFailureCode, historicalFixture, historicalFixtureDigest,
  historicalMedian, historicalTicketIdentity, validateHistoricalEvidence,
} from "../../scripts/support-ux-historical-layout-contract.mjs"
import { authenticateHistorical, finalizeHistoricalLayoutReport, historicalConsoleDiagnostic, historicalDataPath, historicalNetworkDiagnostic, historicalRequestDisposition, initializeHistoricalBrowserState } from "../../scripts/support-ux-historical-layout-capture.mjs"
import { seedHistoricalLayout } from "../../scripts/support-ux-historical-layout-fixture.mjs"

vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("synthetic-test-hash") } }))

const afterSha = "a".repeat(40)
const mainSha = "b".repeat(40)
const anchor = "2026-10-02T08:00:00.000Z"
const fixture = historicalFixture(anchor)
const workflow = readFileSync(".github/workflows/support-ux-historical-layout.yml", "utf8")

function evidence(stage: "before" | "after", top = stage === "before" ? 600 : 360) {
  return {
    schemaVersion: 1, comparisonKind: "exact-source-runtime", stage,
    sourceSha: stage === "before" ? HISTORICAL_LAYOUT_BEFORE_SHA : afterSha,
    controlSha: afterSha, mainSha, anchor, fixtureDigest: historicalFixtureDigest(fixture),
    controls: { ...HISTORICAL_LAYOUT_CONTROLS }, status: "captured",
    serverClockProof: { schemaVersion: 1, clockPolicy: HISTORICAL_LAYOUT_CONTROLS.clockPolicy, anchor, dateNow: Date.parse(anchor) },
    results: HISTORICAL_LAYOUT_ROUTES.map((route: { id: string; path: string; beforeBlob: string; beforeRepresentation: string; afterRepresentation: string }) => ({
      id: route.id, path: route.path, sourcePageBlob: stage === "before" ? route.beforeBlob : "c".repeat(40),
      representation: stage === "before" ? route.beforeRepresentation : route.afterRepresentation,
      failures: { external: 0, write: 0, page: 0, console: 0, response: 0 },
      status: "captured", semanticFixture: true, viewportWidth: 1366, viewportHeight: 768,
      maxTouchPoints: 0, serviceWorkerAvailable: false, serviceWorkerCount: 0, documentLang: "en", darkTheme: false, reducedMotion: true,
      scrollTop: 0, documentScrollTop: 0, primaryWorkTop: top, primaryWorkTopSamples: [top, top, top],
      primaryLabelTop: top + 12, primaryLabelTopSamples: [top + 12, top + 12, top + 12],
      borderedRoundedBlocks: stage === "before" ? 30 : 20, majorChildren: 1, screenshot: route.id + ".png",
    })),
  }
}

function ticketBody() {
  return { success: true, data: { tickets: Array.from({ length: 50 }, (_, index) => ({ ...historicalTicketIdentity(fixture, index), assignedTo: fixture.admin.id })) } }
}

function calendarBody() {
  return { success: true, data: {
    sources: { tickets: "ok", tasks: "ok", events: "ok", activities: "ok" },
    items: Array.from({ length: 50 }, (_, index) => {
      const ticket = historicalTicketIdentity(fixture, index)
      return { id: ticket.id, type: "ticket", title: ticket.subject, date: ticket.dueAt, allDay: false }
    }),
  } }
}

describe("Matched historical Support layout admission", () => {
  it("retains an incomplete artifact after a late screenshot/close error or invalid final environment", () => {
    const late = evidence("after")
    late.results[0].failures.console = 1
    const report = finalizeHistoricalLayoutReport(late, "after", afterSha)
    expect(report.status).toBe("incomplete")
    expect(report.results[0].code).toBe("RUNTIME_FAILURE")
    const invalid = evidence("after")
    invalid.results[0].documentLang = "ru"
    expect(finalizeHistoricalLayoutReport(invalid, "after", afterSha)).toMatchObject({ status: "incomplete", validationFailureCode: "CAPTURE_ENVIRONMENT_INVALID" })
  })

  it("records only allowlisted network metadata and fixed error classes, never query, identity, body or message", () => {
    expect(historicalNetworkDiagnostic("http://localhost:3000/api/v1/public/csp-report?token=SECRET", "POST", 403, "http://localhost:3000")).toBe("/api/v1/public/csp-report|POST|403")
    expect(historicalNetworkDiagnostic("http://localhost:3000/private/SECRET?token=SECRET", "GET", 500, "http://localhost:3000")).toBe("OTHER_SAME_ORIGIN|GET|500")
    expect(historicalNetworkDiagnostic("https://SECRET.invalid/token/SECRET", "SECRET", 900, "http://localhost:3000")).toBe("EXTERNAL|OTHER_METHOD|0")
    expect(historicalConsoleDiagnostic("password=SECRET cookie=SECRET")).toBe("OTHER_CONSOLE_ERROR")
    expect(historicalConsoleDiagnostic("Evaluating a string as JavaScript violates unsafe-eval SECRET")).toBe("CSP_EVAL")
  })

  it("removes the capability gate before either runtime can register a worker and fails closed when immutable", () => {
    const configure = Function("Navigator", "navigator", "localStorage", "return (" + initializeHistoricalBrowserState.toString() + ")")
    const writes = { setItem: vi.fn() }
    class SyntheticNavigator {}
    Object.defineProperty(SyntheticNavigator.prototype, "serviceWorker", { configurable: true, value: {} })
    const navigator = new SyntheticNavigator()
    configure(SyntheticNavigator, navigator, writes)({ adminId: fixture.admin.id })
    expect("serviceWorker" in navigator).toBe(false)
    expect(writes.setItem).toHaveBeenCalledWith("theme", "light")
    Object.defineProperty(SyntheticNavigator.prototype, "serviceWorker", { configurable: false, value: {} })
    expect(() => configure(SyntheticNavigator, navigator, writes)({ adminId: fixture.admin.id })).toThrow("CAPTURE_ENVIRONMENT_INVALID")
  })

  it("rejects a worker-capable document even with valid matched geometry", () => {
    const after = evidence("after")
    after.results[0].serviceWorkerAvailable = true
    expect(() => compareHistoricalLayouts(evidence("before"), after, afterSha)).toThrow("CAPTURE_ENVIRONMENT_INVALID")
  })

  it("rejects a successful geometry label that conceals an application or blocked-write failure", () => {
    const after = evidence("after")
    after.results[0].failures.write = 1
    expect(() => compareHistoricalLayouts(evidence("before"), after, afterSha)).toThrow("RUNTIME_FAILURE")
  })

  it("rejects a different item representation even with attractive geometry", () => {
    const after = evidence("after")
    after.results[0].representation = "enclosing-page-wrapper"
    expect(() => compareHistoricalLayouts(evidence("before"), after, afterSha)).toThrow("GEOMETRY_INVALID")
  })

  it("establishes the exact tenant/admin session using the Secure-cookie-compatible loopback hostname", async () => {
    const responses = [
      { ok: () => true, json: async () => ({ csrfToken: "synthetic-csrf" }) },
      { ok: () => true, json: async () => ({ user: { id: fixture.admin.id, organizationId: fixture.organization.id, role: "admin" } }) },
    ]
    const context = { request: { get: vi.fn().mockImplementation(async () => responses.shift()), post: vi.fn().mockResolvedValue({ ok: () => true }) } }
    await expect(authenticateHistorical(context, "http://localhost:3000", fixture, "synthetic-test-password-".repeat(3))).resolves.toBeUndefined()
    expect(context.request.get.mock.calls.map((call) => call[0])).toEqual(["http://localhost:3000/api/auth/csrf", "http://localhost:3000/api/auth/session"])
    responses.push({ ok: () => true, json: async () => ({ csrfToken: "synthetic-csrf" }) }, { ok: () => true, json: async () => ({ user: { id: "other-actor", organizationId: "other-tenant", role: "admin" } }) })
    await expect(authenticateHistorical(context, "http://localhost:3000", fixture, "synthetic-test-password-".repeat(3))).rejects.toThrow("AUTH_SESSION_MISMATCH")
  })

  it("passes four independent reductions with matched immutable sources and controls", () => {
    const result = compareHistoricalLayouts(evidence("before"), evidence("after"), afterSha)
    expect(result.status).toBe("passed")
    expect(result.results.map((item: { reductionPercent: number }) => item.reductionPercent)).toEqual([40, 40, 40, 40])
  })

  it("does not average away a single surface below the literal 35 percent requirement", () => {
    const after = evidence("after")
    after.results[2].primaryWorkTop = 400
    after.results[2].primaryWorkTopSamples = [400, 400, 400]
    const result = compareHistoricalLayouts(evidence("before"), after, afterSha)
    expect(result.status).toBe("failed")
    expect(result.results[2].status).toBe("failed")
    expect(result.results[2].requiredReductionPercent).toBe(35)
  })

  it("rejects a mismatched candidate, modified historical page or derivative runtime", () => {
    for (const change of [{ sourceSha: mainSha }, { controlSha: mainSha }, { comparisonKind: "derivative-page-overlay" }]) {
      expect(() => compareHistoricalLayouts({ ...evidence("before"), ...change }, evidence("after"), afterSha)).toThrow("SOURCE_IDENTITY_INVALID")
    }
    const before = evidence("before")
    before.results[0].sourcePageBlob = "c".repeat(40)
    expect(() => validateHistoricalEvidence(before, "before", afterSha)).toThrow("SOURCE_IDENTITY_INVALID")
  })

  it("rejects differing clocks, fixtures, viewports, input modality and role", () => {
    const before = evidence("before")
    for (const change of [{ fixtureDigest: "wrong" }, { anchor: "2026-10-03T08:00:00.000Z" }, { controls: { ...HISTORICAL_LAYOUT_CONTROLS, viewportHeight: 900 } }, { controls: { ...HISTORICAL_LAYOUT_CONTROLS, role: "agent" } }]) {
      expect(() => compareHistoricalLayouts(before, { ...evidence("after"), ...change }, afterSha)).toThrow()
    }
    const after = evidence("after")
    after.results[0].maxTouchPoints = 1
    expect(() => compareHistoricalLayouts(before, after, afterSha)).toThrow("CAPTURE_ENVIRONMENT_INVALID")
  })

  it("rejects empty, duplicated or failed route evidence", () => {
    const after = evidence("after")
    expect(() => compareHistoricalLayouts(evidence("before"), { ...after, results: [] }, afterSha)).toThrow("ROUTE_COVERAGE_INVALID")
    expect(() => compareHistoricalLayouts(evidence("before"), { ...after, results: Array(4).fill(after.results[0]) }, afterSha)).toThrow("ROUTE_COVERAGE_INVALID")
    after.results[0].status = "failed"
    expect(() => compareHistoricalLayouts(evidence("before"), after, afterSha)).toThrow("ROUTE_COVERAGE_INVALID")
  })

  it.each([[0, 0, 0], [-1, 1, 2], [1, Number.NaN, 2], [1, Number.POSITIVE_INFINITY, 2], [1, 2]].map((values) => ({ values })))("rejects invalid historical geometry $values", ({ values }) => {
    expect(() => historicalMedian(values)).toThrow("GEOMETRY_INVALID")
  })

  it("rejects fabricated median and captures scrolled to the work item", () => {
    const after = evidence("after")
    after.results[0].primaryWorkTopSamples = [100, 100, 100]
    expect(() => compareHistoricalLayouts(evidence("before"), after, afterSha)).toThrow("GEOMETRY_INVALID")
    const scrolled = evidence("after")
    scrolled.results[0].scrollTop = 50
    expect(() => compareHistoricalLayouts(evidence("before"), scrolled, afterSha)).toThrow("CAPTURE_ENVIRONMENT_INVALID")
  })

  it("requires actual work content in the first 768 pixels even with sufficient reduction", () => {
    const after = evidence("after")
    after.results[0].primaryLabelTop = 800
    after.results[0].primaryLabelTopSamples = [800, 800, 800]
    expect(compareHistoricalLayouts(evidence("before"), after, afterSha).results[0].status).toBe("failed")
  })

  it("admits only the pinned public before source and exact controller after source on hosted localhost", () => {
    const env = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", SUPPORT_HISTORICAL_BASE_URL: "http://localhost:3000", SUPPORT_HISTORICAL_STAGE: "after", SUPPORT_HISTORICAL_SOURCE_SHA: afterSha, SUPPORT_HISTORICAL_CONTROL_SHA: afterSha, SUPPORT_HISTORICAL_MAIN_SHA: mainSha }
    expect(assertHistoricalCaptureEnvironment(env).sourceSha).toBe(afterSha)
    for (const change of [{ SUPPORT_HISTORICAL_BASE_URL: "https://app.leaddrivecrm.org" }, { SUPPORT_HISTORICAL_BASE_URL: "http://127.0.0.1:3000" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { CI: "false" }, { SUPPORT_HISTORICAL_SOURCE_SHA: mainSha }]) {
      expect(() => assertHistoricalCaptureEnvironment({ ...env, ...change })).toThrow()
    }
    expect(() => assertHistoricalCaptureEnvironment({ ...env, SUPPORT_HISTORICAL_STAGE: "before" })).toThrow("SOURCE_IDENTITY_INVALID")
  })

  it("refuses nonempty or non-ephemeral seed targets without deleting data", async () => {
    const env = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", NODE_ENV: "test", SUPPORT_HISTORICAL_SEED_CONFIRM: "ephemeral-support-historical-layout-v1", DATABASE_URL: "postgresql://postgres:ephemeral-only@127.0.0.1:5432/support_ux_historical_layout" }
    expect(() => assertHistoricalSeedEnvironment(env)).not.toThrow()
    for (const change of [{ DATABASE_URL: "postgresql://postgres:password@production.example.invalid:5432/support_ux_historical_layout" }, { DATABASE_URL: "postgresql://postgres:password@127.0.0.1:5432/leaddrive" }, { NODE_ENV: "production" }, { CI: "false" }]) {
      expect(() => assertHistoricalSeedEnvironment({ ...env, ...change })).toThrow()
    }
    const transaction = vi.fn()
    await expect(seedHistoricalLayout({ organization: { count: async () => 1 }, $transaction: transaction }, fixture, "x".repeat(32))).rejects.toThrow("EMPTY_DATABASE_REQUIRED")
    expect(transaction).not.toHaveBeenCalled()
  })

  it("keeps every one of 50 unique ticket deadlines on the common anchor day, including Friday and Sunday", () => {
    for (const clock of ["2026-10-02T08:00:00.000Z", "2026-10-04T08:00:00.000Z"]) {
      const data = historicalFixture(clock)
      const tickets = Array.from({ length: 50 }, (_, index) => historicalTicketIdentity(data, index))
      expect(new Set(tickets.map((ticket) => ticket.id)).size).toBe(50)
      expect(tickets.every((ticket) => ticket.dueAt.startsWith(clock.slice(0, 10)))).toBe(true)
      expect(tickets[0].dueAt).toBe(clock.slice(0, 10) + "T09:00:00.000Z")
      expect(tickets[49].dueAt).toBe(clock.slice(0, 10) + "T10:49:00.000Z")
    }
  })

  it("seeds matched ownership and explicit UI timestamps through one transaction in an empty database", async () => {
    const tx = {
      organization: { create: vi.fn() }, user: { create: vi.fn() }, slaPolicy: { create: vi.fn() },
      company: { create: vi.fn() }, ticket: { createMany: vi.fn() }, entitlement: { create: vi.fn() },
      entitlementMilestoneDefinition: { createMany: vi.fn() },
    }
    const prisma = {
      organization: { count: async () => 0 }, user: { count: async () => 0 },
      ticket: { count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(50) },
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
    }
    await seedHistoricalLayout(prisma, fixture, "x".repeat(32))
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    const rows = tx.ticket.createMany.mock.calls[0][0].data
    expect(rows).toHaveLength(50)
    expect(rows.every((row: { assignedTo: string; organizationId: string }) => row.assignedTo === fixture.admin.id && row.organizationId === fixture.organization.id)).toBe(true)
    expect(rows[0].subject).toBe(fixture.ticket.subject)
    for (const model of [tx.organization, tx.user, tx.slaPolicy, tx.company, tx.entitlement]) {
      expect(model.create.mock.calls[0][0].data.createdAt.toISOString()).toBe(anchor)
    }
    expect(tx.entitlement.create.mock.calls[0][0].data.updatedAt.toISOString()).toBe(anchor)
    expect(tx.organization.create.mock.calls[0][0].data.features).toEqual(fixture.enabledModules)
    expect(tx.organization.create.mock.calls[0][0].data.modules).toEqual({ crm: true, support: true, settings: true, analytics: true, voip: true, omnichannel: true, mtm: true })
    expect(tx.entitlementMilestoneDefinition.createMany.mock.calls[0][0].data.every((row: { createdAt: Date; updatedAt: Date }) => row.createdAt.toISOString() === anchor && row.updatedAt.toISOString() === anchor)).toBe(true)
  })

  it("requires matched actual ticket data, not an empty state or a substituted cohort", () => {
    expect(() => assertHistoricalSemanticData("service-desk", "before", ticketBody(), fixture)).not.toThrow()
    expect(() => assertHistoricalSemanticData("agent-desktop", "before", ticketBody(), fixture)).not.toThrow()
    expect(() => assertHistoricalSemanticData("service-desk", "before", { success: true, data: { tickets: [] } }, fixture)).toThrow("TICKET_FIXTURE_MISSING")
    const changed = ticketBody()
    changed.data.tickets[1].assignedTo = "another-actor"
    expect(() => assertHistoricalSemanticData("service-desk", "after", changed, fixture)).toThrow("TICKET_COHORT_MISMATCH")
    const duplicates = ticketBody()
    duplicates.data.tickets[1] = duplicates.data.tickets[0]
    expect(() => assertHistoricalSemanticData("service-desk", "after", duplicates, fixture)).toThrow("TICKET_COHORT_MISMATCH")
  })

  it("requires the same next actionable ticket from the current personal-queue contract", () => {
    const data = { success: true, data: { generatedAt: anchor, scope: "assigned_to_current_user", queue: { total: 50, nextTicket: { id: fixture.ticket.id, subject: fixture.ticket.subject } } } }
    expect(() => assertHistoricalSemanticData("agent-desktop", "after", data, fixture)).not.toThrow()
    expect(() => assertHistoricalSemanticData("agent-desktop", "after", { ...data, data: { ...data.data, scope: "organization" } }, fixture)).toThrow("AGENT_FIXTURE_MISMATCH")
    expect(() => assertHistoricalSemanticData("agent-desktop", "after", { ...data, data: { ...data.data, generatedAt: "2026-10-03T08:00:00.000Z" } }, fixture)).toThrow("AGENT_FIXTURE_MISMATCH")
  })

  it("normalizes the isolated server clock without changing explicit Date values or monotonic time", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "support-historical-clock-test-"))
    const clock = chooseHistoricalAnchor()
    try {
      const output = execFileSync(process.execPath, ["-e", 'const started = performance.now(); const nativeTimeout = setTimeout; require("./scripts/support-ux-historical-layout-clock.cjs"); setTimeout(() => console.log(JSON.stringify({ now: Date.now(), iso: new Date().toISOString(), explicit: new Date("2000-01-01T00:00:00Z").toISOString(), multi: new Date(2000, 0, 1).getFullYear(), utc: Date.UTC(2000,0,1), parsed: Date.parse("2000-01-01T00:00:00Z"), callable: typeof Date(), instance: new Date() instanceof Date, nativeTimeout: nativeTimeout === setTimeout, elapsed: performance.now() - started })), 20)'], {
        env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", SUPPORT_HISTORICAL_BASE_URL: "http://localhost:3000", SUPPORT_HISTORICAL_ANCHOR: clock, RUNNER_TEMP: directory, SUPPORT_HISTORICAL_CLOCK_PROOF: path.join(directory, "support-historical-clock-before.json") }, encoding: "utf8",
      })
      const value = JSON.parse(output)
      expect(value.now).toBeGreaterThanOrEqual(Date.parse(clock))
      expect(value.now).toBeLessThan(Date.parse(clock) + 1000)
      expect(value.iso).toContain(clock.slice(0, -4))
      expect(value.explicit).toBe("2000-01-01T00:00:00.000Z")
      expect(value.multi).toBe(2000)
      expect(value.utc).toBe(946684800000)
      expect(value.parsed).toBe(946684800000)
      expect(value.callable).toBe("string")
      expect(value.instance).toBe(true)
      expect(value.nativeTimeout).toBe(true)
      expect(value.elapsed).toBeGreaterThanOrEqual(15)
      const proof = JSON.parse(readFileSync(path.join(directory, "support-historical-clock-before.json"), "utf8"))
      expect(proof.clockPolicy).toBe(HISTORICAL_LAYOUT_CONTROLS.clockPolicy)
      expect(proof.anchor).toBe(clock)
    } finally { rmSync(directory, { recursive: true }) }
  })

  it("chooses one future UTC day for transport cookie expiry and rejects malformed anchors", () => {
    for (const now of ["2026-10-02T00:01:00.000Z", "2026-10-02T20:00:00.000Z", "2026-12-31T23:59:00.000Z"]) {
      const real = new Date(now)
      const clock = chooseHistoricalAnchor(real)
      expect(Date.parse(clock) + 8 * 3600000 - real.getTime()).toBeGreaterThan(3 * 3600000)
    }
    expect(chooseHistoricalAnchor(new Date("2026-12-31T23:59:00.000Z"))).toBe("2027-01-01T08:00:00.000Z")
    expect(() => historicalFixture("not-a-clock")).toThrow("FIXTURE_CLOCK_INVALID")
    expect(() => historicalFixture("2026-02-30T08:00:00.000Z")).toThrow("FIXTURE_CLOCK_INVALID")
    expect(() => chooseHistoricalAnchor(new Date("invalid"))).toThrow("FIXTURE_CLOCK_INVALID")
  })

  it("refuses a malformed or expired server-clock anchor before bootstrap", () => {
    for (const clock of ["not-an-anchor", "2026-02-30T08:00:00.000Z", "2000-01-01T08:00:00.000Z"]) {
      const result = spawnSync(process.execPath, ["-e", 'require("./scripts/support-ux-historical-layout-clock.cjs")'], {
        env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", SUPPORT_HISTORICAL_BASE_URL: "http://localhost:3000", SUPPORT_HISTORICAL_ANCHOR: clock }, encoding: "utf8",
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/EPHEMERAL_(CLOCK_REQUIRED|COOKIE_CLOCK_EXPIRED)/)
      expect(result.stdout).toBe("")
    }
  })

  it("requires real entitlement and matched complete calendar data on both source versions", () => {
    const entitlement = { entitlements: [{ id: fixture.entitlement.id, companyName: fixture.company.name, status: "active", definitionCount: 2, definitions: [{}, {}] }] }
    expect(() => assertHistoricalSemanticData("support-entitlements", "before", entitlement, fixture)).not.toThrow()
    expect(() => assertHistoricalSemanticData("support-entitlements", "after", { entitlements: [] }, fixture)).toThrow("ENTITLEMENT_FIXTURE_MISMATCH")
    expect(() => assertHistoricalSemanticData("agent-calendar", "before", calendarBody(), fixture)).not.toThrow()
    expect(() => assertHistoricalSemanticData("agent-calendar", "after", calendarBody(), fixture)).not.toThrow()
    const changed = calendarBody()
    changed.data.items[0].date = "2026-10-09T09:00:00.000Z"
    expect(() => assertHistoricalSemanticData("agent-calendar", "after", changed, fixture)).toThrow("CALENDAR_FIXTURE_MISMATCH")
    const partial = calendarBody()
    partial.data.sources.tasks = "failed"
    expect(() => assertHistoricalSemanticData("agent-calendar", "after", partial, fixture)).toThrow("CALENDAR_FIXTURE_MISMATCH")
  })

  it("blocks production/external routing and writes after synthetic authentication", () => {
    expect(historicalRequestDisposition("http://localhost:3000/api/v1/tickets", "GET", "http://localhost:3000")).toBe("read")
    expect(historicalRequestDisposition("https://app.leaddrivecrm.org/api/v1/tickets", "GET", "http://localhost:3000")).toBe("external")
    expect(historicalRequestDisposition("http://localhost:3000/api/v1/tickets", "POST", "http://localhost:3000")).toBe("write")
    expect(historicalDataPath("agent-desktop", "before")).toBe("/api/v1/tickets")
    expect(historicalDataPath("agent-desktop", "after")).toBe("/api/v1/support/agent-desktop")
  })

  it("never emits raw errors, credentials or configuration as public failure codes", () => {
    expect(historicalFailureCode(new Error("password=secret cookie=secret"))).toBe("CAPTURE_FAILED")
    expect(historicalFailureCode(new Error("UPPERCASE_PRIVATE_SECRET"))).toBe("CAPTURE_FAILED")
    expect(historicalFailureCode(new Error("TICKET_COHORT_MISMATCH"))).toBe("TICKET_COHORT_MISMATCH")
  })

  it("retains a manually dispatched reusable no-production controller with exact public ancestry admission", () => {
    expect(workflow).toContain("workflow_dispatch:")
    expect(workflow).toContain("workflow_call:")
    expect(workflow).not.toContain("pull_request:")
    expect(workflow).not.toContain("push:")
    expect(workflow).not.toContain("secrets.")
    expect(workflow).toContain('git merge-base --is-ancestor "$BEFORE_SHA" "$MAIN_SHA"')
    expect(workflow).toContain('git merge-base --is-ancestor "$MAIN_SHA" "$AFTER_SHA"')
    expect(workflow).toContain("SUPPORT_HISTORICAL_ANCHOR: ${{ needs.prepare.outputs.anchor }}")
    expect(workflow).toContain("max-parallel: 1")
    expect(workflow).toContain("if-no-files-found: warn")
    expect(workflow).not.toContain("app.log\n")
  })
})
