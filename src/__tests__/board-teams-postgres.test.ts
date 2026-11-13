/**
 * Teams of the boards — Bordio's «Teams & Users» (owner, 2026-11-13) against a
 * real Postgres, through the real route handlers:
 *
 *  - the admin makes, renames and removes teams; nobody else does;
 *  - a person is in ONE team: moving them is one row, and makes them a member
 *    of the new team; in the same team the role stays;
 *  - everyone on the boards reads the teams, the leader first; another
 *    organization reads none and cannot be put into one;
 *  - a team's page lists its people's OPEN BOARD tasks (assignee or
 *    co-assignee) — and only those the viewer may see anyway;
 *  - both tables ship under FORCE ROW LEVEL SECURITY with the tenant policy.
 *
 * Runs in the same database gate as the task import (TASK_EXTERNAL_IMPORT_*).
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.TASK_EXTERNAL_IMPORT_TEST_DATABASE_URL
if (!adminUrl && process.env.TASK_EXTERNAL_IMPORT_DB_GATE === "required") {
  throw new Error("TASK_EXTERNAL_IMPORT_TEST_DATABASE_URL is required by the task import database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  const admin = process.env.TASK_EXTERNAL_IMPORT_TEST_DATABASE_URL
  if (!admin) return null
  const name = `board_teams_${process.pid}`
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
const ORG = "org-teams"
const OTHER_ORG = "org-teams-other"
const BOARD_A = "div-teams-a"
const BOARD_B = "div-teams-b"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "board-teams-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const request = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const onTeam = (teamId: string) => ({ params: Promise.resolve({ teamId }) })

const FULL = { canView: true, canEdit: true, canCreateTask: true, canComment: true, canMoveToTodo: true, canMoveToInProgress: true, canMoveToTesting: true, canMoveToReview: true, canMoveBack: true }

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("board teams on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let teams!: typeof import("@/app/api/v1/tasks/teams/route")
  let oneTeam!: typeof import("@/app/api/v1/tasks/teams/[teamId]/route")
  let members!: typeof import("@/app/api/v1/tasks/teams/members/route")
  let tasks!: typeof import("@/app/api/v1/tasks/route")

  const as = (id: string, role: string, organizationId = ORG) => {
    session.current = { user: { id, organizationId, role, email: `${id}@teams.test`, name: id } }
  }
  const call = async (res: Response | Promise<Response>) => { const r = await res; return { status: r.status, body: await r.json() } }
  const readTeams = () => call(teams.GET(request("GET", "/api/v1/tasks/teams")))
  const makeTeam = (name: unknown) => call(teams.POST(request("POST", "/api/v1/tasks/teams", { name })))
  const place = (body: unknown) => call(members.PUT(request("PUT", "/api/v1/tasks/teams/members", body)))
  const teamTasks = async (teamId: string) => {
    const res = await call(tasks.GET(request("GET", `/api/v1/tasks?teamId=${teamId}&open=1&limit=1000`)))
    return (res.body.data?.tasks ?? []).map((t: { id: string }) => t.id).sort()
  }
  let traditional = ""
  let digital = ""

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    teams = await import("@/app/api/v1/tasks/teams/route")
    oneTeam = await import("@/app/api/v1/tasks/teams/[teamId]/route")
    members = await import("@/app/api/v1/tasks/teams/members/route")
    tasks = await import("@/app/api/v1/tasks/route")
    await bypass(async () => {
      for (const [id, slug] of [[ORG, "teams"], [OTHER_ORG, "teams-other"]]) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, tasks: true } } })
      }
      for (const [id, organizationId, role] of [
        ["admin", ORG, "admin"], ["nazrin", ORG, "manager"], ["elvira", ORG, "sales"], ["turkan", ORG, "sales"],
        ["xayala", ORG, "sales"], ["outsider", OTHER_ORG, "admin"],
      ]) {
        await prisma.user.create({ data: { id, organizationId, email: `${id}@teams.test`, name: id, passwordHash: "-", role, isActive: true } })
      }
      await prisma.division.create({ data: { id: BOARD_A, organizationId: ORG, key: "TA", name: "Zeytun" } })
      await prisma.division.create({ data: { id: BOARD_B, organizationId: ORG, key: "TB", name: "Pharmastore" } })
      await prisma.boardPermission.createMany({ data: [
        { organizationId: ORG, userId: "elvira", divisionId: BOARD_A, ...FULL },
        { organizationId: ORG, userId: "xayala", divisionId: BOARD_A, ...FULL },
        { organizationId: ORG, userId: "turkan", divisionId: BOARD_B, ...FULL },
      ] })
      const task = (id: string, extra: Record<string, unknown>) =>
        prisma.task.create({ data: { id, organizationId: ORG, taskKey: id.toUpperCase(), title: id, status: "todo", ...extra } })
      await task("t-elvira", { divisionId: BOARD_A, assignedTo: "elvira" })
      await task("t-xayala", { divisionId: BOARD_A, assignedTo: "xayala" })
      await task("t-turkan", { divisionId: BOARD_B, assignedTo: "turkan" })
      await task("t-shared", { divisionId: BOARD_A, assignedTo: "xayala" })
      await prisma.taskCollaborator.create({ data: { organizationId: ORG, taskId: "t-shared", userId: "elvira" } })
      await task("t-offboard", { assignedTo: "elvira" })
      await task("t-done", { divisionId: BOARD_A, assignedTo: "elvira", status: "done", completedAt: new Date() })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => as("admin", "admin"))

  it("the admin makes teams; a manager and a member do not; a name is taken once", async () => {
    for (const [id, role] of [["nazrin", "manager"], ["elvira", "sales"]]) {
      as(id, role)
      expect((await makeTeam("Gizli")).status, id).toBe(403)
    }
    as("admin", "admin")
    const first = await makeTeam("Traditional Marketing")
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    traditional = first.body.data.id
    digital = (await makeTeam("Digital Marketing")).body.data.id
    expect((await makeTeam("Traditional Marketing")).status).toBe(409)
    expect((await makeTeam("  ")).status).toBe(400)
    expect((await readTeams()).body.data.teams.map((t: { name: string }) => t.name)).toEqual(["Traditional Marketing", "Digital Marketing"])
  })

  it("a person is in one team: moved, they are a member there; in the same team the role stays", async () => {
    expect((await place({ userId: "elvira", teamId: traditional, role: "leader" })).status).toBe(200)
    expect((await place({ userId: "turkan", teamId: traditional })).status).toBe(200)
    expect((await place({ userId: "xayala", teamId: digital })).status).toBe(200)
    // The same team, no role named: still the leader.
    expect((await place({ userId: "elvira", teamId: traditional })).body.data.role).toBe("leader")
    // Moved and back: one row all along, a member each time.
    expect((await place({ userId: "elvira", teamId: digital })).body.data).toMatchObject({ teamId: digital, role: "member" })
    expect(await bypass(() => prisma.boardTeamMember.count({ where: { userId: "elvira" } }))).toBe(1)
    expect((await place({ userId: "elvira", teamId: traditional, role: "leader" })).status).toBe(200)

    as("elvira", "sales")
    expect((await place({ userId: "turkan", teamId: digital })).status).toBe(403)
    as("admin", "admin")
    expect((await place({ userId: "outsider", teamId: traditional })).status).toBe(404)
    expect((await place({ userId: "turkan", teamId: "no-such-team" })).status).toBe(404)
    expect((await place({ userId: "turkan", teamId: traditional, role: "boss" })).status).toBe(400)
  })

  it("everyone on the boards reads the teams, the leader first; another organization reads none", async () => {
    as("xayala", "sales")
    const read = await readTeams()
    expect(read.status).toBe(200)
    expect(read.body.data.canManage).toBe(false)
    const team = read.body.data.teams.find((t: { id: string }) => t.id === traditional)
    expect(team.members.map((m: { userId: string; role: string }) => [m.userId, m.role])).toEqual([["elvira", "leader"], ["turkan", "member"]])
    as("outsider", "admin", OTHER_ORG)
    expect((await readTeams()).body.data.teams).toEqual([])
    expect((await call(oneTeam.DELETE(request("DELETE", `/api/v1/tasks/teams/${traditional}`), onTeam(traditional)))).status).toBe(404)
  })

  it("a team's page lists its people's open board tasks — those the viewer may see", async () => {
    // Elvira (assignee, co-assignee) and Turkan; not Xayala's own, not a task off the boards, not a finished one.
    expect(await teamTasks(traditional)).toEqual(["t-elvira", "t-shared", "t-turkan"])
    expect(await teamTasks(digital)).toEqual(["t-shared", "t-xayala"])
    // Xayala does not see board B: Turkan's task stays hidden from her on the team page too.
    as("xayala", "sales")
    expect(await teamTasks(traditional)).toEqual(["t-elvira", "t-shared"])
  })

  it("a person switched off leaves the lists; out of a team — by null; a removed team takes only the grouping", async () => {
    await bypass(() => prisma.user.update({ where: { id: "turkan" }, data: { isActive: false } }))
    const members = (await readTeams()).body.data.teams.find((t: { id: string }) => t.id === traditional).members
    expect(members.map((m: { userId: string }) => m.userId)).toEqual(["elvira"])
    expect((await place({ userId: "xayala", teamId: null })).body.data).toEqual({ userId: "xayala", teamId: null, role: null })
    expect(await bypass(() => prisma.boardTeamMember.count({ where: { userId: "xayala" } }))).toBe(0)

    const renamed = await call(oneTeam.PATCH(request("PATCH", `/api/v1/tasks/teams/${digital}`, { name: "Traditional Marketing" }), onTeam(digital)))
    expect(renamed.status).toBe(409)
    expect((await call(oneTeam.PATCH(request("PATCH", `/api/v1/tasks/teams/${digital}`, { name: "Digital" }), onTeam(digital)))).status).toBe(200)
    as("nazrin", "manager")
    expect((await call(oneTeam.DELETE(request("DELETE", `/api/v1/tasks/teams/${traditional}`), onTeam(traditional)))).status).toBe(403)
    as("admin", "admin")
    expect((await call(oneTeam.DELETE(request("DELETE", `/api/v1/tasks/teams/${traditional}`), onTeam(traditional)))).status).toBe(200)
    expect(await bypass(() => prisma.boardTeamMember.count({ where: { teamId: traditional } }))).toBe(0)
    // The people and their tasks are as they were.
    expect(await bypass(() => prisma.user.count({ where: { id: { in: ["elvira", "turkan"] } } }))).toBe(2)
    expect(await bypass(() => prisma.task.count({ where: { id: "t-elvira", deletedAt: null } }))).toBe(1)
  })
})

describe("board teams migration", () => {
  it("ships both tables under FORCE ROW LEVEL SECURITY with the tenant policy, one team per person", () => {
    const sql = readFileSync(path.join(ROOT, "prisma/migrations/20261216100000_board_teams/migration.sql"), "utf8")
    for (const table of ["board_teams", "board_team_members"]) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
      expect(sql).toMatch(new RegExp(`CREATE POLICY tenant_isolation ON "${table}"\\s+USING \\("organizationId" = current_setting\\('app\\.org_id', true\\)`))
    }
    expect(sql).toContain('CREATE UNIQUE INDEX "board_team_members_userId_key" ON "board_team_members"("userId")')
  })
})
