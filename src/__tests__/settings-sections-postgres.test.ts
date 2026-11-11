/**
 * Sections of Settings handed to one person without the admin role (owner,
 * 2026-11-11: «чтоб видел конкретные разделы и конкретные разделы параметров»;
 * catalog and rule in src/lib/settings-sections.ts) — against a real Postgres,
 * through the real route handlers and the real role checks (`requireAuth` and
 * `withRls`). Only `auth()` is replaced: it hands each request the session the
 * JWT callback would build from the user row, read back from the database with
 * the same `effectiveSettingsSections` the callback uses.
 *
 *  - an admin ticks «Automations» on a sales person's card; the tick is stored;
 *  - that person then lists, creates, edits and deletes workflows and opens the
 *    templates — and is refused (403) every section nobody ticked: custom
 *    fields, call tasks, SMTP, the organization page, the users roster, and
 *    their own user card (no ticking oneself more sections, no promotion);
 *  - an unknown section is a 400, nothing stored; a promotion to admin clears
 *    the list; unticking closes the section on the next request.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.SETTINGS_SECTIONS_TEST_DATABASE_URL
if (!adminUrl && process.env.SETTINGS_SECTIONS_DB_GATE === "required") {
  throw new Error("SETTINGS_SECTIONS_TEST_DATABASE_URL is required by the settings sections database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  const admin = process.env.SETTINGS_SECTIONS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `settings_sections_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

const ROOT = process.cwd()
const ORG = "org-sections"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "settings-sections-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const request = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const withId = (id: string) => ({ params: Promise.resolve({ id }) })

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("sections of Settings ticked on a user card, on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let sections!: typeof import("@/lib/settings-sections")
  let userOne!: typeof import("@/app/api/v1/users/[id]/route")
  let users!: typeof import("@/app/api/v1/users/route")
  let workflows!: typeof import("@/app/api/v1/workflows/route")
  let workflowOne!: typeof import("@/app/api/v1/workflows/[id]/route")
  let templates!: typeof import("@/app/api/v1/workflows/templates/route")
  let customFields!: typeof import("@/app/api/v1/custom-fields/route")
  let callTasks!: typeof import("@/app/api/v1/settings/call-tasks/route")
  let smtp!: typeof import("@/app/api/v1/settings/smtp/route")
  let organization!: typeof import("@/app/api/v1/settings/organization/route")

  /** The session auth() would hand this person: role and ticks from their row, as the JWT callback reads them. */
  const as = async (id: string) => {
    const row = await bypass(() => prisma.user.findUniqueOrThrow({ where: { id } }))
    session.current = {
      user: {
        id, organizationId: row.organizationId, role: row.role, email: row.email, name: row.name,
        settingsSections: sections.effectiveSettingsSections(row.role, row.settingsSections),
      },
    }
  }
  const call = async (res: Response | Promise<Response>) => {
    const r = await res
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  const storedSections = async (id: string) =>
    (await bypass(() => prisma.user.findUniqueOrThrow({ where: { id }, select: { settingsSections: true } }))).settingsSections
  const tick = (id: string, body: Record<string, unknown>) => call(userOne.PUT(request("PUT", `/api/v1/users/${id}`, body), withId(id)))

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    sections = await import("@/lib/settings-sections")
    userOne = await import("@/app/api/v1/users/[id]/route")
    users = await import("@/app/api/v1/users/route")
    workflows = await import("@/app/api/v1/workflows/route")
    workflowOne = await import("@/app/api/v1/workflows/[id]/route")
    templates = await import("@/app/api/v1/workflows/templates/route")
    customFields = await import("@/app/api/v1/custom-fields/route")
    callTasks = await import("@/app/api/v1/settings/call-tasks/route")
    smtp = await import("@/app/api/v1/settings/smtp/route")
    organization = await import("@/app/api/v1/settings/organization/route")
    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: "Sections", slug: "sections", plan: "enterprise" } })
      for (const [id, role] of [["boss", "admin"], ["nazrin", "sales"], ["sabina", "sales"]]) {
        await prisma.user.create({ data: { id, organizationId: ORG, email: `${id}@sections.test`, name: id, passwordHash: "-", role, isActive: true } })
      }
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  it("refuses a sales person every organization section before anyone ticks one", async () => {
    await as("nazrin")
    expect((await call(workflows.GET(request("GET", "/api/v1/workflows"), undefined))).status).toBe(403)
    expect((await call(workflows.POST(request("POST", "/api/v1/workflows", { name: "x", entityType: "deal", triggerEvent: "created" }), undefined))).status).toBe(403)
  })

  it("stores the ticked section from the admin's save, and nothing that is not a section", async () => {
    await as("boss")
    const unknown = await tick("nazrin", { settingsSections: ["workflows", "users"] })
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(400)
    expect(await storedSections("nazrin")).toEqual([])

    const saved = await tick("nazrin", { settingsSections: ["workflows"] })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(await storedSections("nazrin")).toEqual(["workflows"])
  })

  it("lets the ticked person work the whole section: list, create, edit, delete, templates", async () => {
    await as("nazrin")
    const created = await call(workflows.POST(request("POST", "/api/v1/workflows", { name: "Yeni lid", entityType: "lead", triggerEvent: "created" }), undefined))
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const id = created.body.data.id as string

    const listed = await call(workflows.GET(request("GET", "/api/v1/workflows"), undefined))
    expect(listed.status).toBe(200)
    expect(listed.body.data.map((w: { id: string }) => w.id)).toContain(id)

    const edited = await call(workflowOne.PUT(request("PUT", `/api/v1/workflows/${id}`, { name: "Yeni lid 2" }), withId(id)))
    expect(edited.status, JSON.stringify(edited.body)).toBe(200)
    expect((await bypass(() => prisma.workflowRule.findUniqueOrThrow({ where: { id } }))).name).toBe("Yeni lid 2")

    expect((await call(templates.GET(request("GET", "/api/v1/workflows/templates"), undefined))).status).toBe(200)

    const dropped = await call(workflowOne.DELETE(request("DELETE", `/api/v1/workflows/${id}`), withId(id)))
    expect(dropped.status, JSON.stringify(dropped.body)).toBe(200)
    expect(await bypass(() => prisma.workflowRule.count({ where: { id } }))).toBe(0)
  })

  it("refuses the same person every section nobody ticked, and writes nothing there", async () => {
    await as("nazrin")
    const field = await call(customFields.POST(request("POST", "/api/v1/custom-fields", { entityType: "deal", fieldName: "x", fieldLabel: "X", fieldType: "text" }), undefined))
    expect(field.status).toBe(403)
    expect(await bypass(() => prisma.customField.count({ where: { organizationId: ORG } }))).toBe(0)

    expect((await call(callTasks.PUT(request("PUT", "/api/v1/settings/call-tasks", { boardId: null, dueDays: 3 }), undefined))).status).toBe(403)
    expect((await call(smtp.GET(request("GET", "/api/v1/settings/smtp"), undefined))).status).toBe(403)
    expect((await call(smtp.PUT(request("PUT", "/api/v1/settings/smtp", { smtpHost: "evil.test" }), undefined))).status).toBe(403)
    expect((await call(organization.PUT(request("PUT", "/api/v1/settings/organization", { name: "Hijacked" }), undefined))).status).toBe(403)
    expect((await bypass(() => prisma.organization.findUniqueOrThrow({ where: { id: ORG } }))).name).toBe("Sections")
  })

  it("does not let the ticked person hand out sections or roles — not to others, not to themselves", async () => {
    await as("nazrin")
    expect((await tick("nazrin", { settingsSections: ["workflows", "custom-fields", "call-tasks"] })).status).toBe(403)
    expect((await tick("nazrin", { role: "admin" })).status).toBe(403)
    expect((await tick("sabina", { settingsSections: ["workflows"] })).status).toBe(403)
    const created = await call(users.POST(request("POST", "/api/v1/users", {
      name: "x", email: "x@sections.test", password: "Correct-horse-9-battery", role: "admin",
    }), undefined))
    expect(created.status).toBe(403)
    expect(await storedSections("nazrin")).toEqual(["workflows"])
    expect(await storedSections("sabina")).toEqual([])
    const row = await bypass(() => prisma.user.findUniqueOrThrow({ where: { id: "nazrin" } }))
    expect(row.role).toBe("sales")
  })

  it("opens a section that checks the admin role itself once it is ticked (call tasks)", async () => {
    await as("boss")
    expect((await tick("nazrin", { settingsSections: ["workflows", "call-tasks"] })).status).toBe(200)
    await as("nazrin")
    const saved = await call(callTasks.PUT(request("PUT", "/api/v1/settings/call-tasks", { boardId: null, dueDays: 3 }), undefined))
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
  })

  it("closes the section on the next request once unticked, and a promotion to admin clears the list", async () => {
    await as("boss")
    expect((await tick("nazrin", { settingsSections: [] })).status).toBe(200)
    await as("nazrin")
    expect((await call(workflows.GET(request("GET", "/api/v1/workflows"), undefined))).status).toBe(403)

    await as("boss")
    expect((await tick("sabina", { settingsSections: ["workflows"] })).status).toBe(200)
    expect(await storedSections("sabina")).toEqual(["workflows"])
    expect((await tick("sabina", { role: "admin" })).status).toBe(200)
    expect(await storedSections("sabina")).toEqual([])
  })
})
