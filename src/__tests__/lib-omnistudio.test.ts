/**
 * Tests for N16 OmniStudio slice 1 — 4 pure helpers + types. No DB.
 */
import { describe, expect, it } from "vitest"
import {
  artifactAllowedNext,
  canArtifactTransition,
  canSessionTransition,
  isArtifactStatus,
  isArtifactTerminal,
  isSessionStatus,
  isSessionTerminal,
  sessionAllowedNext,
} from "@/lib/omnistudio/state-machine"
import { validateFlexCardConfig } from "@/lib/omnistudio/flex-card-validator"
import { validateOmniScriptConfig } from "@/lib/omnistudio/omni-script-validator"
import { renderFlexCard } from "@/lib/omnistudio/flex-card-renderer"
import {
  ARTIFACT_STATUSES,
  ARTIFACT_TRANSITIONS,
  FIELD_VALUE_TYPES,
  SESSION_STATUSES,
  SESSION_TRANSITIONS,
  STEP_TYPES,
} from "@/lib/omnistudio/types"

/* ─── State machines ──────────────────────────────────────────────────── */

describe("N16 — artifact state-machine (FlexCard / OmniScript)", () => {
  it("accepts every canonical status", () => {
    for (const s of ARTIFACT_STATUSES) expect(isArtifactStatus(s)).toBe(true)
  })

  it("rejects unknown statuses", () => {
    for (const s of ["", "Draft", "frob", 42, null]) {
      expect(isArtifactStatus(s)).toBe(false)
    }
  })

  it("draft → published / archived allowed", () => {
    expect(canArtifactTransition("draft", "published").ok).toBe(true)
    expect(canArtifactTransition("draft", "archived").ok).toBe(true)
  })

  it("published → draft / archived allowed", () => {
    expect(canArtifactTransition("published", "draft").ok).toBe(true)
    expect(canArtifactTransition("published", "archived").ok).toBe(true)
  })

  it("archived is terminal", () => {
    expect(isArtifactTerminal("archived")).toBe(true)
    expect(canArtifactTransition("archived", "draft").ok).toBe(false)
  })

  it("rejects self-transition", () => {
    for (const s of ARTIFACT_STATUSES) {
      expect(canArtifactTransition(s, s).ok).toBe(false)
    }
  })

  it("artifactAllowedNext matches table", () => {
    for (const s of ARTIFACT_STATUSES) {
      expect(artifactAllowedNext(s)).toEqual(ARTIFACT_TRANSITIONS[s])
    }
  })
})

describe("N16 — session state-machine", () => {
  it("accepts every canonical status", () => {
    for (const s of SESSION_STATUSES) expect(isSessionStatus(s)).toBe(true)
  })

  it("in_progress → completed / abandoned / failed allowed", () => {
    for (const to of ["completed", "abandoned", "failed"] as const) {
      expect(canSessionTransition("in_progress", to).ok).toBe(true)
    }
  })

  it("completed / abandoned / failed are terminal", () => {
    for (const s of ["completed", "abandoned", "failed"] as const) {
      expect(isSessionTerminal(s)).toBe(true)
    }
  })

  it("sessionAllowedNext matches table", () => {
    for (const s of SESSION_STATUSES) {
      expect(sessionAllowedNext(s)).toEqual(SESSION_TRANSITIONS[s])
    }
  })
})

/* ─── FlexCard validator ──────────────────────────────────────────────── */

describe("N16 — flex-card-validator", () => {
  function basicConfig() {
    return {
      sections: [
        {
          id: "main",
          title: "Main",
          fields: [
            { path: "name", label: "Name", valueType: "string" },
            { path: "totalSpent", label: "Total Spent", valueType: "currency" },
          ],
        },
      ],
    }
  }

  it("accepts a well-formed config", () => {
    const r = validateFlexCardConfig({ config: basicConfig() })
    expect(r.ok).toBe(true)
  })

  it("accepts config with conditional section", () => {
    const r = validateFlexCardConfig({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [{ path: "name", label: "Name", valueType: "string" }],
          },
          {
            id: "vip",
            title: "VIP Info",
            fields: [{ path: "totalSpent", label: "Spent", valueType: "currency" }],
            conditional: { var: "totalSpent", equals: 5000 },
          },
        ],
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects non-object config", () => {
    const r = validateFlexCardConfig({ config: "not an object" as never })
    expect(r.ok).toBe(false)
  })

  it("rejects empty sections", () => {
    const r = validateFlexCardConfig({ config: { sections: [] } })
    expect(r.ok).toBe(false)
  })

  it("rejects oversize sections (default cap 16)", () => {
    const sections = Array.from({ length: 17 }, (_, i) => ({
      id: `s${i}`,
      title: `S${i}`,
      fields: [{ path: "f", label: "F", valueType: "string" }],
    }))
    const r = validateFlexCardConfig({ config: { sections } })
    expect(r.ok).toBe(false)
  })

  it("rejects duplicate section IDs", () => {
    const r = validateFlexCardConfig({
      config: {
        sections: [
          { id: "x", title: "A", fields: [{ path: "a", label: "A", valueType: "string" }] },
          { id: "x", title: "B", fields: [{ path: "b", label: "B", valueType: "string" }] },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects empty section fields", () => {
    const r = validateFlexCardConfig({
      config: { sections: [{ id: "main", title: "M", fields: [] }] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects section with too many fields (default cap 32)", () => {
    const fields = Array.from({ length: 33 }, (_, i) => ({
      path: `f${i}`,
      label: `L${i}`,
      valueType: "string" as const,
    }))
    const r = validateFlexCardConfig({
      config: { sections: [{ id: "main", title: "M", fields }] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects bad field path shape", () => {
    const r = validateFlexCardConfig({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [{ path: "..bad", label: "X", valueType: "string" }],
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown valueType", () => {
    const r = validateFlexCardConfig({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [{ path: "f", label: "F", valueType: "uuid" }],
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects conditional referencing undeclared var", () => {
    const r = validateFlexCardConfig({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [{ path: "name", label: "N", valueType: "string" }],
            conditional: { var: "nonexistent", equals: true },
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("accepts conditional referencing a field path", () => {
    const r = validateFlexCardConfig({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [
              { path: "isVip", label: "VIP", valueType: "boolean" },
            ],
          },
          {
            id: "vip_only",
            title: "VIP Only",
            fields: [{ path: "vipNote", label: "Note", valueType: "string" }],
            conditional: { var: "isVip", equals: true },
          },
        ],
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects __proto__ as variable name (defense-in-depth)", () => {
    const r = validateFlexCardConfig({
      config: {
        variables: [{ name: "__proto__", type: "string" }],
        sections: [
          { id: "main", title: "M", fields: [{ path: "n", label: "N", valueType: "string" }] },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects duplicate variable name", () => {
    const r = validateFlexCardConfig({
      config: {
        variables: [
          { name: "x", type: "string" },
          { name: "x", type: "number" },
        ],
        sections: [
          { id: "main", title: "M", fields: [{ path: "f", label: "F", valueType: "string" }] },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative limit", () => {
    const r = validateFlexCardConfig({
      config: basicConfig(),
      limits: { maxSections: 0 },
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── OmniScript validator ────────────────────────────────────────────── */

describe("N16 — omni-script-validator", () => {
  it("accepts a linear 3-step script", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "ask_name",
        steps: [
          {
            id: "ask_name",
            type: "input",
            config: { storeAs: "name", fieldType: "string", required: true },
            nextStepId: "fetch_record",
          },
          {
            id: "fetch_record",
            type: "api_call",
            config: {
              method: "GET",
              urlTemplate: "/api/v1/contacts/${name}",
              storeAs: "contact",
            },
            nextStepId: "do_action",
          },
          {
            id: "do_action",
            type: "action",
            config: { actionKey: "create_deal", args: { value: 1000 } },
          },
        ],
      },
    })
    expect(r.ok).toBe(true)
  })

  it("accepts a conditional branch", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "ask",
        steps: [
          {
            id: "ask",
            type: "input",
            config: { storeAs: "tier", fieldType: "string", required: true },
            nextStepId: "branch",
          },
          {
            id: "branch",
            type: "conditional",
            config: {
              branches: [
                { var: "tier", equals: "vip", nextStepId: "vip_action" },
              ],
              defaultNextStepId: "default_action",
            },
          },
          { id: "vip_action", type: "action", config: { actionKey: "give_perk" } },
          { id: "default_action", type: "action", config: { actionKey: "log" } },
        ],
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects missing startStepId", () => {
    const r = validateOmniScriptConfig({
      config: { steps: [{ id: "a", type: "action", config: { actionKey: "x" } }] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects empty steps", () => {
    const r = validateOmniScriptConfig({
      config: { startStepId: "a", steps: [] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects startStepId not in steps", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "missing",
        steps: [{ id: "a", type: "action", config: { actionKey: "x" } }],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects duplicate step ID", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [
          { id: "a", type: "action", config: { actionKey: "x" } },
          { id: "a", type: "action", config: { actionKey: "y" } },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects nextStepId that doesn't resolve", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [
          {
            id: "a",
            type: "action",
            config: { actionKey: "x" },
            nextStepId: "ghost",
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects conditional branch nextStepId that doesn't resolve", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [
          {
            id: "a",
            type: "conditional",
            config: {
              branches: [{ var: "x", equals: 1, nextStepId: "ghost" }],
              defaultNextStepId: "b",
            },
          },
          { id: "b", type: "action", config: { actionKey: "x" } },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects cycles", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [
          { id: "a", type: "action", config: { actionKey: "x" }, nextStepId: "b" },
          { id: "b", type: "action", config: { actionKey: "y" }, nextStepId: "a" },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unreachable steps", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [
          { id: "a", type: "action", config: { actionKey: "x" } },
          { id: "b", type: "action", config: { actionKey: "y" } },
          // b is never reached from a.
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/unreachable/)
  })

  it("rejects unknown step type", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [{ id: "a", type: "frob", config: {} } as never],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects api_call with bad HTTP method", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [
          {
            id: "a",
            type: "api_call",
            config: { method: "PATCH", urlTemplate: "/x", storeAs: "r" },
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects input with __proto__ storeAs", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [
          {
            id: "a",
            type: "input",
            config: { storeAs: "__proto__", fieldType: "string", required: true },
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects step count over limit", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "s0",
        steps: Array.from({ length: 65 }, (_, i) => ({
          id: `s${i}`,
          type: "action",
          config: { actionKey: "x" },
          nextStepId: i === 64 ? undefined : `s${i + 1}`,
        })),
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects conditional with too many branches", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [
          {
            id: "a",
            type: "conditional",
            config: {
              branches: Array.from({ length: 17 }, (_, i) => ({
                var: "x",
                equals: i,
                nextStepId: "b",
              })),
              defaultNextStepId: "b",
            },
          },
          { id: "b", type: "action", config: { actionKey: "x" } },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── FlexCard renderer ───────────────────────────────────────────────── */

describe("N16 — flex-card-renderer", () => {
  it("renders a simple section", () => {
    const r = renderFlexCard({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [{ path: "name", label: "Name", valueType: "string" }],
          },
        ],
      },
      values: { name: "Alice" },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.rendered.sections[0].fields[0].value).toBe("Alice")
      expect(r.rendered.sections[0].fields[0].hidden).toBe(false)
    }
  })

  it("hides section when conditional fails", () => {
    const r = renderFlexCard({
      config: {
        sections: [
          {
            id: "vip",
            title: "VIP",
            fields: [{ path: "vipNote", label: "Note", valueType: "string" }],
            conditional: { var: "isVip", equals: true },
          },
        ],
      },
      values: { isVip: false, vipNote: "secret" },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.rendered.sections[0].hidden).toBe(true)
      // Fields nullified when section hidden.
      expect(r.rendered.sections[0].fields[0].value).toBeNull()
    }
  })

  it("shows section when conditional passes", () => {
    const r = renderFlexCard({
      config: {
        sections: [
          {
            id: "vip",
            title: "VIP",
            fields: [{ path: "vipNote", label: "Note", valueType: "string" }],
            conditional: { var: "isVip", equals: true },
          },
        ],
      },
      values: { isVip: true, vipNote: "secret" },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.rendered.sections[0].hidden).toBe(false)
      expect(r.rendered.sections[0].fields[0].value).toBe("secret")
    }
  })

  it("hides field when its visibleIf fails", () => {
    const r = renderFlexCard({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [
              { path: "name", label: "Name", valueType: "string" },
              {
                path: "internalNote",
                label: "Internal",
                valueType: "string",
                visibleIf: { var: "showInternal", equals: true },
              },
            ],
          },
        ],
      },
      values: { name: "A", internalNote: "secret", showInternal: false },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.rendered.sections[0].fields[0].hidden).toBe(false)
      expect(r.rendered.sections[0].fields[1].hidden).toBe(true)
      expect(r.rendered.sections[0].fields[1].value).toBeNull()
    }
  })

  it("returns null for missing field values", () => {
    const r = renderFlexCard({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [{ path: "missingField", label: "M", valueType: "string" }],
          },
        ],
      },
      values: {},
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rendered.sections[0].fields[0].value).toBeNull()
  })

  it("does not leak prototype-chain values (defense-in-depth)", () => {
    const r = renderFlexCard({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [
              { path: "toString", label: "Native?", valueType: "string" },
            ],
          },
        ],
      },
      values: {},
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // hasOwnProperty.call guard means inherited `toString` is not returned.
      expect(r.rendered.sections[0].fields[0].value).toBeNull()
    }
  })

  it("rejects bad input shapes", () => {
    expect(renderFlexCard({ config: null as never, values: {} }).ok).toBe(false)
    expect(renderFlexCard({ config: { sections: "no" as never }, values: {} }).ok).toBe(false)
  })
})

/* ─── Drift guards ────────────────────────────────────────────────────── */

describe("N16 — registry drift guards", () => {
  it("ARTIFACT_STATUSES exactly 3", () => {
    expect(ARTIFACT_STATUSES).toEqual(["draft", "published", "archived"])
  })

  it("SESSION_STATUSES exactly 4", () => {
    expect(SESSION_STATUSES).toEqual(["in_progress", "completed", "abandoned", "failed"])
  })

  it("STEP_TYPES exactly 4", () => {
    expect(STEP_TYPES).toEqual(["input", "api_call", "conditional", "action"])
  })

  it("FIELD_VALUE_TYPES exactly 6", () => {
    expect(FIELD_VALUE_TYPES).toEqual([
      "string",
      "number",
      "boolean",
      "date",
      "currency",
      "url",
    ])
  })

  it("ARTIFACT_TRANSITIONS covers every status", () => {
    for (const s of ARTIFACT_STATUSES) {
      expect(ARTIFACT_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("SESSION_TRANSITIONS covers every status", () => {
    for (const s of SESSION_STATUSES) {
      expect(SESSION_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("Terminal session statuses are exactly 3 (completed/abandoned/failed)", () => {
    const terminals = SESSION_STATUSES.filter((s) => SESSION_TRANSITIONS[s].length === 0)
    expect(terminals.sort()).toEqual(["abandoned", "completed", "failed"])
  })

  it("STEP_TYPES validator branch coverage (architect-pass meta-test)", () => {
    // Iterate every STEP_TYPES entry and verify the validator has a
    // type-specific config branch (it should produce a type-specific
    // error when called with a config-less step of each type). Catches
    // future drift when adding a 5th step type without updating the
    // validator's switch.
    for (const stepType of STEP_TYPES) {
      const r = validateOmniScriptConfig({
        config: {
          startStepId: "s",
          steps: [{ id: "s", type: stepType, config: {} } as never],
        },
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        // Error message includes the type name, proving the type-specific
        // branch fired (not the "unknown step type" catch-all).
        expect(r.errors.join(" ")).toMatch(stepType)
      }
    }
  })
})

/* ─── Post-architect-pass-1 fixes ─────────────────────────────────────── */

describe("N16 — post-architect fixes", () => {
  it("rejects field.path containing __proto__ segment", () => {
    const r = validateFlexCardConfig({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [{ path: "__proto__", label: "X", valueType: "string" }],
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/forbidden segment/)
  })

  it("rejects field.path with __proto__ as dotted-path segment", () => {
    const r = validateFlexCardConfig({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [{ path: "company.__proto__", label: "X", valueType: "string" }],
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects conditional referencing a date-typed variable", () => {
    const r = validateFlexCardConfig({
      config: {
        variables: [{ name: "lastSeen", type: "date" }],
        sections: [
          {
            id: "main",
            title: "M",
            fields: [{ path: "name", label: "N", valueType: "string" }],
            conditional: { var: "lastSeen", equals: "2026-01-01" },
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/date-typed/)
  })

  it("rejects conditional referencing a date-typed field path", () => {
    const r = validateFlexCardConfig({
      config: {
        sections: [
          {
            id: "main",
            title: "M",
            fields: [
              { path: "lastSeenAt", label: "Last Seen", valueType: "date" },
            ],
          },
          {
            id: "recent",
            title: "Recent",
            fields: [{ path: "note", label: "Note", valueType: "string" }],
            conditional: { var: "lastSeenAt", equals: "2026-01-01" },
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/date-typed/)
  })

  it("rejects step.nextStepId that's not a valid identifier", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [
          {
            id: "a",
            type: "action",
            config: { actionKey: "x" },
            nextStepId: "x".repeat(200), // exceeds maxStepIdChars
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/nextStepId/)
  })

  it("rejects step.nextStepId with bad characters", () => {
    const r = validateOmniScriptConfig({
      config: {
        startStepId: "a",
        steps: [
          {
            id: "a",
            type: "action",
            config: { actionKey: "x" },
            nextStepId: "has spaces",
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })
})
