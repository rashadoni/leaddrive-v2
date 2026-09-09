/**
 * E1 — sequence email threading: Message-ID minting, thread planning
 * (headers/subject/state), reply-anchored threading, tolerant parsing.
 */
import { describe, it, expect, vi } from "vitest"
import {
  parseThreading,
  planThreadedSend,
  generateSequenceMessageId,
  reSubject,
  resolveReplyTarget,
  isSafeRfcMessageId,
  firstRfcMessageId,
  MAX_THREAD_IDS,
} from "@/lib/sequence-threading"

describe("generateSequenceMessageId", () => {
  it("mints RFC-shaped ids on the reply domain, unique across calls", () => {
    const a = generateSequenceMessageId("mail.test")
    const b = generateSequenceMessageId("mail.test")
    expect(a).toMatch(/^<seq\.[a-z0-9]+\.[A-Za-z0-9_-]+@mail\.test>$/)
    expect(a).not.toBe(b)
  })
})

describe("parseThreading", () => {
  it("round-trips a valid state and drops garbage", () => {
    expect(parseThreading({ rootSubject: "Intro", messageIds: ["<a@x>", 42, "<b@x>"] }))
      .toEqual({ rootSubject: "Intro", messageIds: ["<a@x>", "<b@x>"] })
    for (const bad of [null, undefined, "x", 5, []]) expect(parseThreading(bad)).toBeNull()
    expect(parseThreading({})).toBeNull()
  })
})

describe("planThreadedSend", () => {
  const NEW_ID = "<seq.new@x>"

  it("first email (no state) starts the thread regardless of mode", () => {
    const plan = planThreadedSend({ threading: null, mode: "continue", subject: "Intro offer", newMessageId: NEW_ID })
    expect(plan.headers).toEqual({ "Message-ID": NEW_ID })
    expect(plan.subject).toBe("Intro offer")
    expect(plan.nextThreading).toEqual({ rootSubject: "Intro offer", messageIds: [NEW_ID] })
  })

  it("continue: In-Reply-To anchors on our last send, subject becomes «Re: root»", () => {
    const plan = planThreadedSend({
      threading: { rootSubject: "Intro offer", messageIds: ["<a@x>", "<b@x>"] },
      mode: "continue",
      subject: "whatever the composer had",
      newMessageId: NEW_ID,
    })
    expect(plan.headers["In-Reply-To"]).toBe("<b@x>")
    expect(plan.headers["References"]).toBe("<a@x> <b@x>")
    expect(plan.headers["Message-ID"]).toBe(NEW_ID)
    expect(plan.subject).toBe("Re: Intro offer")
    expect(plan.nextThreading.messageIds).toEqual(["<a@x>", "<b@x>", NEW_ID])
  })

  it("continue with a recipient reply: anchors on THEIR message id", () => {
    const plan = planThreadedSend({
      threading: { rootSubject: "Intro", messageIds: ["<a@x>"] },
      mode: "continue",
      subject: "s",
      newMessageId: NEW_ID,
      replyTargetId: "<their-reply@gmail>",
    })
    expect(plan.headers["In-Reply-To"]).toBe("<their-reply@gmail>")
    expect(plan.headers["References"]).toBe("<a@x> <their-reply@gmail>")
  })

  it("mode=new starts a fresh thread and resets the root subject", () => {
    const plan = planThreadedSend({
      threading: { rootSubject: "Old", messageIds: ["<a@x>"] },
      mode: "new",
      subject: "Brand new topic",
      newMessageId: NEW_ID,
    })
    expect(plan.headers).toEqual({ "Message-ID": NEW_ID })
    expect(plan.subject).toBe("Brand new topic")
    expect(plan.nextThreading).toEqual({ rootSubject: "Brand new topic", messageIds: [NEW_ID] })
  })

  it("caps the stored chain and the References header", () => {
    const many = Array.from({ length: 30 }, (_, i) => `<m${i}@x>`)
    const plan = planThreadedSend({
      threading: { rootSubject: "R", messageIds: many.slice(0, MAX_THREAD_IDS) },
      mode: "continue",
      subject: "s",
      newMessageId: NEW_ID,
    })
    expect(plan.nextThreading.messageIds.length).toBe(MAX_THREAD_IDS)
    expect(plan.headers["References"].split(" ").length).toBeLessThanOrEqual(MAX_THREAD_IDS)
    // the newest id is always kept
    expect(plan.nextThreading.messageIds.at(-1)).toBe(NEW_ID)
  })
})

describe("reSubject", () => {
  it("prefixes once, tolerating existing Re:/Отв:", () => {
    expect(reSubject("Hello")).toBe("Re: Hello")
    expect(reSubject("Re: Hello")).toBe("Re: Hello")
    expect(reSubject("re: Hello")).toBe("re: Hello")
    expect(reSubject("Отв: Привет")).toBe("Отв: Привет")
  })
})

describe("id safety (recipient-controlled values)", () => {
  it("isSafeRfcMessageId rejects CRLF/control/whitespace and oversized ids", () => {
    expect(isSafeRfcMessageId("<ok-id_123@gmail.com>")).toBe(true)
    expect(isSafeRfcMessageId("<evil\r\nBcc: x@y>")).toBe(false)
    expect(isSafeRfcMessageId("<has space@x>")).toBe(false)
    expect(isSafeRfcMessageId("<" + "a".repeat(600) + "@x>")).toBe(false)
    expect(isSafeRfcMessageId(null)).toBe(false)
  })

  it("firstRfcMessageId extracts the first <id> from multi-id/whitespace headers", () => {
    expect(firstRfcMessageId("<a@x> <b@y>")).toBe("<a@x>")
    expect(firstRfcMessageId("  <only@x>  ")).toBe("<only@x>")
    expect(firstRfcMessageId("junk without brackets")).toBeNull()
    expect(firstRfcMessageId(null)).toBeNull()
  })

  it("resolveReplyTarget ignores an unsafe stored reply id (no bricked follow-ups)", async () => {
    const client = {
      emailLog: { findFirst: vi.fn().mockResolvedValue({ messageId: "<evil\r\nX-Inject: 1@x>" }) },
    }
    const got = await resolveReplyTarget(client as never, {
      organizationId: "org-1",
      contactId: "ct-1",
      threading: { rootSubject: "R", messageIds: ["<a@x>"] },
    })
    expect(got).toBeNull() // falls back to our own last id downstream
  })
})

describe("resolveReplyTarget", () => {
  it("finds the newest inbound reply pointing at one of our ids, org+contact scoped", async () => {
    const client = {
      emailLog: { findFirst: vi.fn().mockResolvedValue({ messageId: "<their@gmail>" }) },
    }
    const got = await resolveReplyTarget(client as never, {
      organizationId: "org-1",
      contactId: "ct-1",
      threading: { rootSubject: "R", messageIds: ["<a@x>"] },
    })
    expect(got).toBe("<their@gmail>")
    const q = client.emailLog.findFirst.mock.calls[0][0]
    expect(q.where).toMatchObject({
      organizationId: "org-1",
      contactId: "ct-1",
      direction: "inbound",
      inReplyTo: { in: ["<a@x>"] },
    })
    expect(q.orderBy).toEqual({ createdAt: "desc" })
  })

  it("skips the lookup entirely without a contact or thread state", async () => {
    const client = { emailLog: { findFirst: vi.fn() } }
    expect(await resolveReplyTarget(client as never, { organizationId: "o", contactId: null, threading: { rootSubject: "R", messageIds: ["<a@x>"] } })).toBeNull()
    expect(await resolveReplyTarget(client as never, { organizationId: "o", contactId: "c", threading: null })).toBeNull()
    expect(client.emailLog.findFirst).not.toHaveBeenCalled()
  })
})
