import { describe, expect, it } from "vitest"
import { convMatchesAssignee, inboxAssigneeOptions, inboxTransferTargets } from "@/lib/inbox/assignee-filter"

/**
 * The rules the inbox's «Ответственный» filter shares between the screen and the server
 * (lib/inbox/assignee-filter). What the server adds to the list for one person, and that her
 * conversations reach a new owner, is proved on a real Postgres in
 * `user-handover-inbox-postgres.test.ts`.
 */
describe("inbox «Ответственный» filter", () => {
  it("without a person chosen every conversation stays", () => {
    expect(convMatchesAssignee({ assignedTo: null }, null)).toBe(true)
    expect(convMatchesAssignee({ assignedTo: "leyla" }, null)).toBe(true)
  })

  it("keeps the conversations of the person and nobody else's", () => {
    expect(convMatchesAssignee({ assignedTo: "leyla" }, "leyla")).toBe(true)
    expect(convMatchesAssignee({ assignedTo: "aysel" }, "leyla")).toBe(false)
    // An unassigned conversation is nobody's — also not hers.
    expect(convMatchesAssignee({ assignedTo: null }, "leyla")).toBe(false)
    expect(convMatchesAssignee({}, "leyla")).toBe(false)
  })

  it("finds a customer's thread by any of his channels — not only by the one the row shows", () => {
    // The row shows the owner of the channel the customer wrote in last (Instagram, Aysel);
    // his WhatsApp conversation is still Leyla's, and that is the one to hand over.
    const thread = {
      assignedTo: "aysel",
      threadConversations: [{ assignedTo: "aysel" }, { assignedTo: "leyla" }],
    }
    expect(convMatchesAssignee(thread, "leyla")).toBe(true)
    expect(convMatchesAssignee(thread, "aysel")).toBe(true)
    expect(convMatchesAssignee(thread, "kamran")).toBe(false)
  })

  it("lists who can take conversations first, then who cannot any more but still holds some", () => {
    const options = inboxAssigneeOptions(
      [{ id: "u-zaur", name: "Zaur" }, { id: "u-aysel", name: "Aysel" }],
      [
        { id: "u-aysel", name: "Aysel", active: true, removed: false },
        { id: "u-leyla", name: "Leyla", active: false, removed: false },
        { id: "u-gone", name: null, active: false, removed: true },
      ],
    )
    expect(options).toEqual([
      { id: "u-aysel", name: "Aysel", state: "active" },
      { id: "u-zaur", name: "Zaur", state: "active" },
      { id: "u-leyla", name: "Leyla", state: "inactive" },
      { id: "u-gone", name: null, state: "removed" },
    ])
  })

  it("names a person once, even when the assign list and the holders both know her", () => {
    const options = inboxAssigneeOptions(
      [{ id: "u-aysel", name: "Aysel" }],
      [{ id: "u-aysel", name: "Aysel", active: true, removed: false }],
    )
    expect(options.map((option) => option.id)).toEqual(["u-aysel"])
  })

  it("does not print a deleted account's placeholder as if it were a name", () => {
    // The row of a deleted user holds «Удалённый пользователь» in whatever language it was written;
    // the screen says it in its own words, so the option carries no name at all.
    const [option] = inboxAssigneeOptions([], [{ id: "u-gone", name: "Удалённый пользователь", active: false, removed: true }])
    expect(option).toEqual({ id: "u-gone", name: null, state: "removed" })
  })

  it("keeps an id that is nobody's as a removed holder rather than dropping its conversations from reach", () => {
    // `assignedTo` is a bare string: a conversation can point at an id that is no user at all.
    const [option] = inboxAssigneeOptions([], [{ id: "dangling", name: null, active: false, removed: true }])
    expect(option.state).toBe("removed")
  })

  it("offers everything a person holds to anyone who can take it — except the person herself", () => {
    const agents = [{ id: "u-aysel", name: "Aysel" }, { id: "u-zaur", name: "Zaur" }]
    // Aysel's conversations cannot be handed to Aysel.
    expect(inboxTransferTargets(agents, "u-aysel")).toEqual([{ id: "u-zaur", name: "Zaur" }])
    // Someone who left is not in the assign list: everybody in it can take hers.
    expect(inboxTransferTargets(agents, "u-leyla")).toEqual(agents)
    // Nobody chosen — nothing to hand over, and so nobody to hand it to.
    expect(inboxTransferTargets(agents, null)).toEqual([])
  })
})
