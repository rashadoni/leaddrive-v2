/**
 * Tests for N9 Schema Builder slice 1 — entity registry + graph derivation.
 * Pure-functional; no Prisma, no I/O.
 */
import { describe, it, expect } from "vitest"
import {
  ENTITY_REGISTRY,
  ENTITY_BY_KEY,
  buildSchemaGraph,
  type EntityKey,
  type EntityGroup,
} from "@/lib/schema-builder/registry"

describe("N9 schema — registry integrity", () => {
  it("contains at least 25 curated entities (matches roadmap)", () => {
    expect(ENTITY_REGISTRY.length).toBeGreaterThanOrEqual(25)
  })

  it("every entity has a unique key", () => {
    const keys = ENTITY_REGISTRY.map(e => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("ENTITY_BY_KEY matches registry array", () => {
    expect(ENTITY_BY_KEY.size).toBe(ENTITY_REGISTRY.length)
    for (const e of ENTITY_REGISTRY) {
      expect(ENTITY_BY_KEY.get(e.key)).toBe(e)
    }
  })

  it("every entity has non-empty label, labelPlural, description", () => {
    for (const e of ENTITY_REGISTRY) {
      expect(e.label.length).toBeGreaterThan(0)
      expect(e.labelPlural.length).toBeGreaterThan(0)
      expect(e.description.length).toBeGreaterThan(0)
    }
  })

  it("every entity has an id field at field index 0 (canonical convention)", () => {
    for (const e of ENTITY_REGISTRY) {
      // Currency uses `code` as its natural identifier — explicit exception
      if (e.key === "currency") continue
      expect(e.fields[0].name).toBe("id")
      expect(e.fields[0].type).toBe("id")
      expect(e.fields[0].required).toBe(true)
    }
  })

  it("every entity has at least 3 fields", () => {
    for (const e of ENTITY_REGISTRY) {
      expect(e.fields.length).toBeGreaterThanOrEqual(3)
    }
  })

  it("no entity has duplicate field names", () => {
    for (const e of ENTITY_REGISTRY) {
      const names = e.fields.map(f => f.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it("every group is one of the 7 canonical buckets", () => {
    const valid: EntityGroup[] = ["sales", "people", "service", "marketing", "finance", "operations", "platform"]
    for (const e of ENTITY_REGISTRY) {
      expect(valid).toContain(e.group)
    }
  })
})

describe("N9 schema — security: credential fields excluded", () => {
  // Registry must NEVER expose any field that carries a credential, OAuth
  // refresh/access token, signed session token, verification code, or
  // tenant-onboarding bearer. This list is a regression lock — when a new
  // model lands in `prisma/schema.prisma` with a sensitive field, both
  // the registry (when curated) AND this list need updating.
  const FORBIDDEN_FIELDS = [
    // User credentials & 2FA
    "passwordHash", "totpSecret", "backupCodes", "twoFactorNonce",
    "resetToken", "resetTokenExp", "calendarToken",
    // Contact portal credentials
    "portalPasswordHash", "portalVerificationToken", "portalVerificationExpires",
    // API key secrets
    "keyHash", "apiKey",
    // Channel + integration credentials
    "secret", // webhook + journey secrets
    "appSecret", "accessToken", "refreshToken", "botToken", "verifyToken",
    "firebaseToken", "viewToken",
    // OTP / verification
    "codeHash",
    // MTM mobile auth
    // (MtmAgent.passwordHash already covered above)
  ]

  it.each(FORBIDDEN_FIELDS)("forbidden field '%s' is not exposed anywhere", (forbidden) => {
    for (const e of ENTITY_REGISTRY) {
      const found = e.fields.find(f => f.name === forbidden)
      expect(found, `${forbidden} leaked in ${e.key}`).toBeUndefined()
    }
  })
})

describe("N9 schema — enum values declared", () => {
  it("every enum-typed field has non-empty enumValues", () => {
    for (const e of ENTITY_REGISTRY) {
      for (const f of e.fields) {
        if (f.type === "enum") {
          expect(f.enumValues, `${e.key}.${f.name} declares type=enum but no enumValues`).toBeDefined()
          expect(f.enumValues!.length).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe("N9 schema — relation references valid", () => {
  it("every relation_one / relation_many field references an existing key", () => {
    for (const e of ENTITY_REGISTRY) {
      for (const f of e.fields) {
        if (f.type === "relation_one" || f.type === "relation_many") {
          expect(f.relatesTo, `${e.key}.${f.name} relation missing relatesTo`).toBeDefined()
          expect(ENTITY_BY_KEY.has(f.relatesTo as EntityKey), `${e.key}.${f.name} → ${f.relatesTo} not in registry`).toBe(true)
        }
      }
    }
  })
})

describe("N9 schema — buildSchemaGraph", () => {
  it("unfiltered graph contains all registry entities", () => {
    const g = buildSchemaGraph()
    expect(g.nodes.length).toBe(ENTITY_REGISTRY.length)
  })

  it("group filter restricts to that group only", () => {
    const g = buildSchemaGraph("sales")
    for (const n of g.nodes) {
      expect(n.group).toBe("sales")
    }
    expect(g.nodes.length).toBeGreaterThan(0)
  })

  it("edges include only entities currently visible (cross-group filter drops edges)", () => {
    // Sales group filter — Deal has companyId/contactId/assignedTo to People-group
    // entities. Those edges should be dropped because target isn't in visible set.
    const g = buildSchemaGraph("sales")
    const dealNode = g.nodes.find(n => n.id === "deal")
    expect(dealNode).toBeDefined()
    // Deal.pipelineId → pipeline (same group, sales) → edge kept
    expect(g.edges.some(e => e.id === "deal.pipelineId" && e.to === "pipeline")).toBe(true)
    // Deal.companyId → company (people group) → edge dropped
    expect(g.edges.some(e => e.id === "deal.companyId")).toBe(false)
  })

  it("edge ids are unique", () => {
    const g = buildSchemaGraph()
    const ids = g.edges.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("edge from/to are valid entity keys", () => {
    const g = buildSchemaGraph()
    const keys = new Set(g.nodes.map(n => n.id))
    for (const edge of g.edges) {
      expect(keys.has(edge.from)).toBe(true)
      expect(keys.has(edge.to)).toBe(true)
    }
  })

  it("cardinality matches field type", () => {
    const g = buildSchemaGraph()
    for (const edge of g.edges) {
      const sourceEntity = ENTITY_BY_KEY.get(edge.from)!
      const field = sourceEntity.fields.find(f => f.name === edge.field)!
      const expected = field.type === "relation_one" ? "one" : "many"
      expect(edge.cardinality).toBe(expected)
    }
  })

  it("groups summary reflects visible nodes", () => {
    const g = buildSchemaGraph()
    const totalFromGroups = g.groups.reduce((s, gr) => s + gr.count, 0)
    expect(totalFromGroups).toBe(g.nodes.length)
  })

  it("filtered graph groups summary has exactly one group entry", () => {
    const g = buildSchemaGraph("finance")
    expect(g.groups.length).toBe(1)
    expect(g.groups[0].key).toBe("finance")
    expect(g.groups[0].count).toBe(g.nodes.length)
  })

  it("Deal has expected outgoing relations (companyId, contactId, pipelineId, assignedTo)", () => {
    const g = buildSchemaGraph()
    const dealEdges = g.edges.filter(e => e.from === "deal")
    const targets = new Set(dealEdges.map(e => e.to))
    expect(targets.has("company")).toBe(true)
    expect(targets.has("contact")).toBe(true)
    expect(targets.has("pipeline")).toBe(true)
    expect(targets.has("user")).toBe(true)
  })

  it("Company has reverse 'contacts' relation_many", () => {
    const g = buildSchemaGraph()
    const e = g.edges.find(x => x.id === "company.contacts")
    expect(e).toBeDefined()
    expect(e!.cardinality).toBe("many")
    expect(e!.to).toBe("contact")
  })

  it("node fields preserve order from registry", () => {
    const g = buildSchemaGraph()
    const dealRegistry = ENTITY_BY_KEY.get("deal")!
    const dealNode = g.nodes.find(n => n.id === "deal")!
    expect(dealNode.fields.map(f => f.name)).toEqual(dealRegistry.fields.map(f => f.name))
  })
})
