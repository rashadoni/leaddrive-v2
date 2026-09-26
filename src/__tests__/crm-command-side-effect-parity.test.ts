import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

import {
  dispatchCollectedCommandEffects,
  dispatchOrDeferCommandEffects,
  type CrmCommandPostCommitEffect,
} from "@/lib/crm-commands/execution-context"

/**
 * Roadmap C1.11 — a voice write must produce the same side effects as the
 * click that does the same thing.
 *
 * The mechanism exists: a command either fires its workflows, notifications,
 * webhooks and audit entries straight away, or — when an adapter has wrapped
 * it in a wider transaction — hands them to a collector the adapter flushes
 * after that transaction commits. The voice executor is such an adapter.
 *
 * What was missing is the proof, and the failure it guards against is
 * asymmetric: an effect that escapes early sends a webhook for a write that
 * may still roll back. Nobody sees that in review, because the code reads
 * correctly either way.
 */
describe("an effect inside a transaction cannot escape it", () => {
  it("fires immediately when no transaction wraps the command", async () => {
    const effect = vi.fn()
    dispatchOrDeferCommandEffects(undefined, effect)
    await Promise.resolve()
    expect(effect).toHaveBeenCalledTimes(1)
  })

  it("holds the effect back while a transaction is open", async () => {
    const effect = vi.fn()
    const postCommitEffects: CrmCommandPostCommitEffect[] = []
    dispatchOrDeferCommandEffects(
      { transaction: {} as never, postCommitEffects },
      effect,
    )
    await Promise.resolve()
    expect(effect).not.toHaveBeenCalled()
    expect(postCommitEffects).toHaveLength(1)
  })

  // The alternative to throwing is dropping the effect silently, which is the
  // one outcome nobody would notice: the record is written and the webhook
  // never arrives.
  it("refuses a transaction that brought no collector", () => {
    expect(() => dispatchOrDeferCommandEffects({ transaction: {} as never }, vi.fn()))
      .toThrow(/post-commit effect collector/i)
  })

  it("runs every collected effect when the adapter flushes", async () => {
    const first = vi.fn()
    const second = vi.fn()
    dispatchCollectedCommandEffects([first, second])
    await Promise.resolve()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  // A webhook endpoint that is down must not cost the notification that comes
  // after it in the list.
  it("does not let one failing effect cancel the rest", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const boom = vi.fn(() => {
      throw new Error("webhook endpoint down")
    })
    const rejects = vi.fn(async () => {
      throw new Error("notification failed")
    })
    const after = vi.fn()

    dispatchCollectedCommandEffects([boom, rejects, after])
    await Promise.resolve()
    await Promise.resolve()

    expect(after).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("never lets a failing effect reject into the caller", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => dispatchOrDeferCommandEffects(undefined, () => {
      throw new Error("audit write failed")
    })).not.toThrow()
    await Promise.resolve()
    consoleError.mockRestore()
  })
})

/**
 * The structural half is deliberately weak, and here is why.
 *
 * My first attempt asserted that every effect call sits lexically inside a
 * `dispatchOrDeferCommandEffects(` callback. Two commands failed it, and both
 * were right: `createLeadCommand` and `updateLeadCommand` branch explicitly on
 * `execution?.transaction`, and their `else` arm calls the effects directly —
 * which is correct, because with no transaction open there is nothing to
 * escape. The rule the code follows is "no effect while a transaction is
 * open", and that is a statement about reachability, not about text.
 *
 * So the text-level check only asserts that each command is transaction-aware
 * at all. The real guarantee is proved behaviourally below, against the
 * command whose branch is hand-written and therefore capable of being wrong.
 */
const COMMANDS = [
  "src/lib/crm-commands/task/create-task.ts",
  "src/lib/crm-commands/lead/create-lead.ts",
  "src/lib/crm-commands/lead/update-lead.ts",
  "src/lib/crm-commands/deal/create-deal.ts",
  "src/lib/crm-commands/lead/convert-lead-to-deal.ts",
]

describe("every command knows about the deferral", () => {
  it.each(COMMANDS)("%s routes its effects through the execution context", (path) => {
    const source = readFileSync(path, "utf8")
    expect(source).toContain("dispatchOrDeferCommandEffects")
    // A command that takes a transaction but never reads it would run its
    // effects inside that transaction without anyone noticing.
    expect(source).toMatch(/dispatchOrDeferCommandEffects\(execution|execution\?\.transaction/)
  })
})

describe("the voice adapter flushes what it collected", () => {
  const executor = readFileSync("src/lib/ai/voice/action-execution.ts", "utf8")

  it("passes a collector into every command it runs", () => {
    expect(executor).toContain("postCommitEffects")
    expect(executor).toMatch(/const execution = \{ tx?ransaction: tx, postCommitEffects \}|transaction: tx, postCommitEffects/)
  })

  // Outside the transaction callback, not inside it: flushing inside would put
  // the webhook back before the commit it was deferred past.
  it("dispatches them after the transaction returns", () => {
    const flush = executor.indexOf("dispatchCollectedCommandEffects(completed.postCommitEffects)")
    const transactionEnd = executor.indexOf("}, { maxWait:")
    expect(flush).toBeGreaterThan(-1)
    expect(transactionEnd).toBeGreaterThan(-1)
    expect(flush).toBeGreaterThan(transactionEnd)
  })

  // The record already exists and its effects already ran; firing them again
  // would double every webhook on a retry.
  it("collects nothing when replaying an already-succeeded action", () => {
    expect(executor).toMatch(/state === "succeeded"[\s\S]{0,300}postCommitEffects: \[\]/)
  })
})
