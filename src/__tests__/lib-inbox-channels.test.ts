import { describe, it, expect } from "vitest"
import { extractQuickReplies, appendTag, dropTag, convStatusTab, convMatchesView, extractAttachments, type MacroLike } from "@/lib/inbox-channels"

// Phase 4 — quick replies reuse the org's TicketMacro library: a macro's
// `add_comment` action text becomes a canned reply the agent can insert.
describe("extractQuickReplies", () => {
  it("pulls the add_comment text from each macro as the quick-reply", () => {
    const macros: MacroLike[] = [
      { id: "1", name: "Greeting", actions: [{ type: "add_comment", value: "Hi, how can I help?" }] },
      { id: "2", name: "Closing", actions: [{ type: "add_comment", value: "Thanks for reaching out!" }] },
    ]
    expect(extractQuickReplies(macros)).toEqual([
      { id: "1", name: "Greeting", text: "Hi, how can I help?" },
      { id: "2", name: "Closing", text: "Thanks for reaching out!" },
    ])
  })

  it("drops macros with no add_comment action (pure status/tag automations)", () => {
    const macros: MacroLike[] = [
      { id: "1", name: "Escalate", actions: [{ type: "set_priority", value: "high" }, { type: "add_tag", value: "vip" }] },
      { id: "2", name: "Reply", actions: [{ type: "add_comment", value: "On it." }] },
    ]
    const res = extractQuickReplies(macros)
    expect(res).toHaveLength(1)
    expect(res[0]).toEqual({ id: "2", name: "Reply", text: "On it." })
  })

  it("uses the FIRST add_comment when a macro has several", () => {
    const macros: MacroLike[] = [
      { id: "1", name: "Multi", actions: [{ type: "add_comment", value: "first" }, { type: "add_comment", value: "second" }] },
    ]
    expect(extractQuickReplies(macros)[0].text).toBe("first")
  })

  it("handles missing / empty / blank-text actions safely (drops them)", () => {
    const macros: MacroLike[] = [
      { id: "1", name: "NoActions" },
      { id: "2", name: "Empty", actions: [] },
      { id: "3", name: "BlankText", actions: [{ type: "add_comment", value: "" }] },
    ]
    expect(extractQuickReplies(macros)).toEqual([])
  })
})

// Phase 3 — contact tag mutations (the inbox context panel edits Contact.tags).
describe("appendTag / dropTag", () => {
  it("appends a trimmed tag", () => {
    expect(appendTag(["a"], "  b  ")).toEqual(["a", "b"])
  })

  it("is a no-op returning the SAME array on blank or duplicate (so callers can skip the save)", () => {
    const tags = ["vip"]
    expect(appendTag(tags, "   ")).toBe(tags)
    expect(appendTag(tags, "vip")).toBe(tags)
  })

  it("drops a tag by exact value", () => {
    expect(dropTag(["a", "b", "c"], "b")).toEqual(["a", "c"])
  })

  it("dropTag leaves the list unchanged when the tag is absent", () => {
    expect(dropTag(["a"], "z")).toEqual(["a"])
  })
})

// Phase 2 — status tab classification from surfaced SocialConversation state.
describe("convStatusTab", () => {
  const NOW = 1_000_000

  it("an active snooze (future snoozedUntil) wins over status → snoozed", () => {
    const future = new Date(NOW + 10_000).toISOString()
    expect(convStatusTab({ status: "open", snoozedUntil: future }, NOW)).toBe("snoozed")
    expect(convStatusTab({ status: "resolved", snoozedUntil: future }, NOW)).toBe("snoozed")
  })

  it("a past snooze does not count", () => {
    const past = new Date(NOW - 10_000).toISOString()
    expect(convStatusTab({ status: "open", snoozedUntil: past }, NOW)).toBe("opened")
  })

  it("resolved / archived → closed", () => {
    expect(convStatusTab({ status: "resolved" }, NOW)).toBe("closed")
    expect(convStatusTab({ status: "archived" }, NOW)).toBe("closed")
  })

  it("open or undefined/no-state → opened", () => {
    expect(convStatusTab({ status: "open" }, NOW)).toBe("opened")
    expect(convStatusTab({}, NOW)).toBe("opened")
    expect(convStatusTab({ snoozedUntil: null }, NOW)).toBe("opened")
  })
})

// Phase 2c — folder views by assignment.
describe("convMatchesView", () => {
  const ME = "user-me"

  it("all matches everything", () => {
    expect(convMatchesView({ assignedTo: "x" }, "all", ME)).toBe(true)
    expect(convMatchesView({ assignedTo: null }, "all", ME)).toBe(true)
  })

  it("me matches only my assignments (and needs a current user)", () => {
    expect(convMatchesView({ assignedTo: ME }, "me", ME)).toBe(true)
    expect(convMatchesView({ assignedTo: "other" }, "me", ME)).toBe(false)
    expect(convMatchesView({ assignedTo: null }, "me", ME)).toBe(false)
    expect(convMatchesView({ assignedTo: ME }, "me", null)).toBe(false)
  })

  it("unassigned matches null/undefined assignedTo", () => {
    expect(convMatchesView({ assignedTo: null }, "unassigned", ME)).toBe(true)
    expect(convMatchesView({}, "unassigned", ME)).toBe(true)
    expect(convMatchesView({ assignedTo: "x" }, "unassigned", ME)).toBe(false)
  })

  it("others matches assignments to someone else", () => {
    expect(convMatchesView({ assignedTo: "other" }, "others", ME)).toBe(true)
    expect(convMatchesView({ assignedTo: ME }, "others", ME)).toBe(false)
    expect(convMatchesView({ assignedTo: null }, "others", ME)).toBe(false)
  })

  it("chatbot matches threads the auto-reply bot answered (botHandled)", () => {
    expect(convMatchesView({ botHandled: true }, "chatbot", ME)).toBe(true)
    expect(convMatchesView({ botHandled: false }, "chatbot", ME)).toBe(false)
    expect(convMatchesView({ assignedTo: "x" }, "chatbot", ME)).toBe(false) // no flag → not bot-handled
  })

  it("participating matches threads where I'm a collaborator (participants)", () => {
    expect(convMatchesView({ participants: [ME, "x"] }, "participating", ME)).toBe(true)
    expect(convMatchesView({ participants: ["x", "y"] }, "participating", ME)).toBe(false) // not me
    expect(convMatchesView({ participants: [] }, "participating", ME)).toBe(false) // none
    expect(convMatchesView({}, "participating", ME)).toBe(false) // no participants field
    expect(convMatchesView({ participants: [ME] }, "participating", null)).toBe(false) // no current user
  })

  it("spam matches nothing (later phase)", () => {
    expect(convMatchesView({ assignedTo: null }, "spam", ME)).toBe(false)
  })
})

// Phase 4b — received attachments. mediaUrl / messageType are TOP-LEVEL
// ChannelMessage columns (set by the webhooks), NOT inside metadata — the
// fixtures must mirror that, or green tests would certify a phantom display.
describe("extractAttachments", () => {
  it("pulls messages with a top-level mediaUrl, typed by messageType", () => {
    const msgs = [
      { id: "1", body: "", createdAt: "2025-01-01", mediaUrl: "http://img", messageType: "image" },
      { id: "2", body: "doc", createdAt: "2025-01-02", mediaUrl: "http://doc", messageType: "document" },
      { id: "3", body: "hi", createdAt: "2025-01-03", messageType: "text" },
    ] as any
    const atts = extractAttachments(msgs)
    expect(atts).toHaveLength(2)
    expect(atts[0]).toMatchObject({ id: "1", url: "http://img", type: "image" })
    expect(atts[1]).toMatchObject({ id: "2", url: "http://doc", type: "document" })
  })

  it("returns empty when no message carries a mediaUrl", () => {
    const msgs = [{ id: "1", body: "hi", createdAt: "x", messageType: "text" }] as any
    expect(extractAttachments(msgs)).toEqual([])
  })

  it("defaults type to 'file' when messageType is missing", () => {
    const msgs = [{ id: "1", body: "", createdAt: "x", mediaUrl: "http://f" }] as any
    expect(extractAttachments(msgs)[0].type).toBe("file")
  })
})
