import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: { fieldPermission: { findMany: mocks.findMany } },
}))

import {
  FieldPermissionsUnavailableError,
  getFieldPermissions,
  requireFieldPermissions,
} from "@/lib/field-filter"
import { AI_VOICE_ACTION_REGISTRY, AI_VOICE_ACTION_TYPES } from "@/lib/ai/voice/action-registry"

/**
 * Roadmap C1.9/C1.10/C1.14 — REST and voice must be the same write, not two
 * writes that resemble each other.
 *
 * The command layer already routes both callers through one function per
 * action. What was missing is the check that the guarantees around it hold,
 * and the sharpest of those is the one this file opens with: a permission set
 * that could not be READ is not a permission set that allows everything.
 */

let uniqueOrg = 0
function org(): string {
  uniqueOrg += 1
  return `org-parity-${uniqueOrg}`
}

beforeEach(() => {
  mocks.findMany.mockReset()
})

describe("field permissions on a write path fail closed", () => {
  it("returns the configured restrictions when the table reads", async () => {
    mocks.findMany.mockResolvedValue([{ fieldName: "estimatedValue", access: "visible" }])
    await expect(requireFieldPermissions(org(), "manager", "lead"))
      .resolves.toEqual({ estimatedValue: "visible" })
  })

  // The bug this exists for: the lenient loader answers an unreadable table
  // with `{}`, and every caller correctly reads that as "nothing is
  // restricted". On a write, a database blip would therefore make every
  // restricted field editable.
  it("refuses rather than reporting that nothing is restricted", async () => {
    mocks.findMany.mockRejectedValue(new Error("connection reset"))
    await expect(requireFieldPermissions(org(), "manager", "lead"))
      .rejects.toBeInstanceOf(FieldPermissionsUnavailableError)
  })

  it("names the entity in the refusal, so the caller can say which write failed", async () => {
    mocks.findMany.mockRejectedValue(new Error("connection reset"))
    await expect(requireFieldPermissions(org(), "manager", "deal"))
      .rejects.toMatchObject({ code: "FIELD_PERMISSIONS_UNAVAILABLE", entityType: "deal" })
  })

  // A cached failure turns one bad second into a whole TTL of open fields, and
  // both loaders share the cache.
  it("never caches a failure", async () => {
    const orgId = org()
    mocks.findMany.mockRejectedValueOnce(new Error("connection reset"))
    await expect(requireFieldPermissions(orgId, "manager", "lead")).rejects.toThrow()

    mocks.findMany.mockResolvedValueOnce([{ fieldName: "notes", access: "hidden" }])
    await expect(requireFieldPermissions(orgId, "manager", "lead"))
      .resolves.toEqual({ notes: "hidden" })
    expect(mocks.findMany).toHaveBeenCalledTimes(2)
  })

  it("does not let the read path poison the write path's cache", async () => {
    const orgId = org()
    mocks.findMany.mockRejectedValueOnce(new Error("connection reset"))
    await expect(getFieldPermissions(orgId, "manager", "lead")).resolves.toEqual({})

    mocks.findMany.mockRejectedValueOnce(new Error("connection reset"))
    await expect(requireFieldPermissions(orgId, "manager", "lead")).rejects.toThrow()
  })

  it("keeps the read path lenient, because a list is not a write", async () => {
    mocks.findMany.mockRejectedValue(new Error("connection reset"))
    await expect(getFieldPermissions(org(), "manager", "lead")).resolves.toEqual({})
  })
})

describe("every command loads permissions the strict way", () => {
  const COMMANDS = [
    "src/lib/crm-commands/task/create-task.ts",
    "src/lib/crm-commands/lead/create-lead.ts",
    "src/lib/crm-commands/lead/update-lead.ts",
    "src/lib/crm-commands/deal/create-deal.ts",
    "src/lib/crm-commands/lead/convert-lead-to-deal.ts",
  ]

  it("uses requireFieldPermissions and never the lenient loader", () => {
    for (const path of COMMANDS) {
      const source = readFileSync(path, "utf8")
      expect(source, path).toContain("requireFieldPermissions(")
      expect(source, path).not.toContain("getFieldPermissions(")
    }
  })

  // Both callers reach the same function, so a tenant check written once
  // protects both. These are the values an adapter could otherwise pass
  // straight through from a request body.
  it("scopes the assignee to the caller's organization", () => {
    for (const path of COMMANDS) {
      const source = readFileSync(path, "utf8")
      if (!source.includes("input.assignedTo") && !source.includes("lead.assignedTo")) continue
      expect(source, path).toMatch(/assignedTo[\s\S]{0,200}organizationId: orgId/)
    }
  })
})

describe("the voice contract is narrower than REST, never wider", () => {
  it("allows no voice field the command schema does not accept", () => {
    for (const actionType of AI_VOICE_ACTION_TYPES) {
      const entry = AI_VOICE_ACTION_REGISTRY[actionType]
      const payload = Object.fromEntries(entry.allowedFields.map((field) => [field, undefined]))
      const parsed = entry.commandSchema.safeParse(payload)
      // Every allowed field is optional-or-known: an unknown key would be
      // rejected by the strict command schema, which is the point.
      if (!parsed.success) {
        const unknownKeys = parsed.error.issues
          .filter((issue) => issue.code === "unrecognized_keys")
          .flatMap((issue) => (issue as unknown as { keys: string[] }).keys ?? [])
        expect(unknownKeys, `${actionType} allows fields the command rejects`).toEqual([])
      }
    }
  })

  it("keeps the lead conversion shortcut closed on the voice side", () => {
    // `status: "converted"` promises a deal that only the conversion command
    // creates, so the update path must refuse it however it is reached.
    const updateLead = readFileSync("src/lib/crm-commands/lead/update-lead.ts", "utf8")
    expect(updateLead).toContain("CONVERSION_REQUIRES_COMMAND")
    expect(updateLead).toMatch(/VOICE_UPDATE_FIELDS[\s\S]{0,400}"status"/)
  })

  it("requires a version token for every voice update", () => {
    const updateLead = readFileSync("src/lib/crm-commands/lead/update-lead.ts", "utf8")
    expect(updateLead).toContain("expectedUpdatedAt is required for voice updates")
  })
})
