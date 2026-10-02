import { describe, it, expect } from "vitest"
import {
  ACCESS_NONE, accessChoiceOf, accessWrites, buildAccessRoster, type AccessCard, type AccessUser,
} from "@/lib/mtm/access-roster"

// The roster behind Route & Field → "Access & permissions". Field scope is the
// employee card linked to a login, so the rows and the writes below are the
// whole meaning of "give", "change" and "take away" on that page.

const user = (id: string, role: string, extra: Partial<AccessUser> = {}): AccessUser =>
  ({ id, name: id, email: `${id}@example.az`, role, isActive: true, hiddenModules: [], ...extra })
const card = (id: string, extra: Partial<AccessCard> = {}): AccessCard =>
  ({ id, name: id, email: null, role: "AGENT", status: "ACTIVE", userId: null, createdAt: "2026-09-01T00:00:00Z", ...extra })

describe("buildAccessRoster", () => {
  it("gives each login the scope the field resolver would give it", () => {
    const { rows } = buildAccessRoster(
      [user("admin", "admin"), user("boss", "manager"), user("rep", "sales"), user("nobody", "manager")],
      [card("c-boss", { userId: "boss", role: "MANAGER" }), card("c-rep", { userId: "rep" })],
    )

    expect(rows.map((row) => [row.user.id, row.kind, accessChoiceOf(row)])).toEqual([
      ["admin", "organization", null],
      ["boss", "card", "MANAGER"],
      ["nobody", "none", ACCESS_NONE],
      ["rep", "card", "AGENT"],
    ])
  })

  it("acts as the oldest active card and ignores inactive ones, like the resolver", () => {
    const { rows } = buildAccessRoster([user("boss", "manager")], [
      card("c-new", { userId: "boss", role: "ADMIN", createdAt: "2026-09-20T00:00:00Z" }),
      card("c-old", { userId: "boss", role: "SUPERVISOR", createdAt: "2026-09-01T00:00:00Z" }),
      card("c-off", { userId: "boss", role: "MANAGER", createdAt: "2026-08-01T00:00:00Z", status: "INACTIVE" }),
    ])

    expect(rows[0]).toMatchObject({ kind: "card", role: "SUPERVISOR", card: { id: "c-old" } })
  })

  it("says the module is hidden rather than offering access the person could not use", () => {
    const { rows } = buildAccessRoster([user("office", "support", { hiddenModules: ["mtm"] })], [])
    expect(rows[0].kind).toBe("hidden")
  })

  it("leaves out people who can no longer sign in", () => {
    expect(buildAccessRoster([user("gone", "sales", { isActive: false })], []).rows).toEqual([])
  })

  it("counts the cards that have no login, minus the ones it is about to reuse", () => {
    const { rows, mobileOnly } = buildAccessRoster([user("rep", "sales")], [
      card("c-same-person", { email: " REP@example.az" }),
      card("c-mobile-1", { email: "someone@example.az" }),
      card("c-mobile-2"),
      card("c-linked", { userId: "elsewhere" }),
    ])

    expect(rows[0]).toMatchObject({ kind: "none", reusable: { id: "c-same-person" } })
    expect(mobileOnly).toBe(2)
  })
})

describe("accessWrites", () => {
  const [none] = buildAccessRoster([user("saida", "manager")], []).rows
  const [reuse] = buildAccessRoster([user("rep", "sales")], [card("c-rep", { email: "rep@example.az" })]).rows
  const [held] = buildAccessRoster([user("boss", "manager")], [card("c-boss", { userId: "boss", role: "MANAGER" })]).rows
  const [admin] = buildAccessRoster([user("admin", "admin")], []).rows
  const [hidden] = buildAccessRoster([user("office", "support", { hiddenModules: ["mtm"] })], []).rows

  it("creates a card for a person who has none", () => {
    expect(accessWrites(none, "ADMIN")).toEqual([
      { url: "/api/v1/mtm/agents", method: "POST", body: { name: "saida", role: "ADMIN", userId: "saida" } },
    ])
  })

  it("links the card that is plainly the same person", () => {
    expect(accessWrites(reuse, "AGENT")).toEqual([
      { url: "/api/v1/mtm/agents/c-rep", method: "PUT", body: { userId: "rep", role: "AGENT" } },
    ])
  })

  it("changes the role of the card a person already has, and unlinks it to take access away", () => {
    expect(accessWrites(held, "ADMIN")).toEqual([
      { url: "/api/v1/mtm/agents/c-boss", method: "PUT", body: { role: "ADMIN" } },
    ])
    expect(accessWrites(held, ACCESS_NONE)).toEqual([
      { url: "/api/v1/mtm/agents/c-boss", method: "PUT", body: { userId: null } },
    ])
  })

  it("writes nothing when nothing changes, for an administrator, or while the module is hidden", () => {
    expect(accessWrites(held, "MANAGER")).toEqual([])
    expect(accessWrites(none, ACCESS_NONE)).toEqual([])
    expect(accessWrites(admin, "AGENT")).toEqual([])
    expect(accessWrites(hidden, "AGENT")).toEqual([])
  })

  it("refuses a level the field engine does not know", () => {
    expect(accessWrites(none, "OWNER" as never)).toEqual([])
  })
})
