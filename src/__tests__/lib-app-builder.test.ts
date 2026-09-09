/**
 * Tests for N2 Lightning App Builder slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  canPageTransition,
  isPageStatus,
  isPageTerminal,
  pageAllowedNext,
} from "@/lib/app-builder/state-machine"
import { validateWidgetConfig } from "@/lib/app-builder/widget-validator"
import {
  lintAssignmentSet,
  resolveAssignment,
} from "@/lib/app-builder/assignment-resolver"
import {
  isLayoutPage,
  isLayoutRegion,
  isLayoutWidget,
  serializeLayout,
} from "@/lib/app-builder/layout-serializer"
import {
  ASSIGNMENT_SCOPE_TYPES,
  PAGE_STATUSES,
  PAGE_TRANSITIONS,
  REGION_TYPES,
  SCOPE_PRECEDENCE,
  WIDGET_TYPES,
  type AssignmentRow,
  type LayoutPage,
  type LayoutRegion,
  type LayoutWidget,
} from "@/lib/app-builder/types"

/* ─── State machine ───────────────────────────────────────────────────── */

describe("N2 — page state-machine", () => {
  it("accepts every canonical status", () => {
    for (const s of PAGE_STATUSES) expect(isPageStatus(s)).toBe(true)
  })

  it("rejects unknown statuses", () => {
    for (const s of ["", "Draft", "ARCHIVED", "frob", 42, null]) {
      expect(isPageStatus(s)).toBe(false)
    }
  })

  it("draft → published / archived allowed", () => {
    expect(canPageTransition("draft", "published").ok).toBe(true)
    expect(canPageTransition("draft", "archived").ok).toBe(true)
  })

  it("published → draft / archived allowed", () => {
    expect(canPageTransition("published", "draft").ok).toBe(true)
    expect(canPageTransition("published", "archived").ok).toBe(true)
  })

  it("archived is terminal", () => {
    expect(isPageTerminal("archived")).toBe(true)
    expect(canPageTransition("archived", "draft").ok).toBe(false)
    expect(canPageTransition("archived", "published").ok).toBe(false)
  })

  it("rejects self-transition", () => {
    for (const s of PAGE_STATUSES) {
      expect(canPageTransition(s, s).ok).toBe(false)
    }
  })

  it("pageAllowedNext matches table", () => {
    for (const s of PAGE_STATUSES) {
      expect(pageAllowedNext(s)).toEqual(PAGE_TRANSITIONS[s])
    }
  })
})

/* ─── Widget validator ────────────────────────────────────────────────── */

describe("N2 — widget-validator: record_details", () => {
  it("accepts a well-formed config", () => {
    const r = validateWidgetConfig({
      widgetType: "record_details",
      config: { fields: ["name", "email", "phone"] },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects empty fields", () => {
    const r = validateWidgetConfig({
      widgetType: "record_details",
      config: { fields: [] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects oversized fields list", () => {
    const r = validateWidgetConfig({
      widgetType: "record_details",
      config: { fields: Array.from({ length: 50 }, (_, i) => `f${i}`) },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-string field entry", () => {
    const r = validateWidgetConfig({
      widgetType: "record_details",
      config: { fields: ["name", 42, "email"] as never },
    })
    expect(r.ok).toBe(false)
  })

  it("accepts optional groupLabel", () => {
    const r = validateWidgetConfig({
      widgetType: "record_details",
      config: { fields: ["name"], groupLabel: "Identity" },
    })
    expect(r.ok).toBe(true)
  })
})

describe("N2 — widget-validator: related_list", () => {
  it("accepts well-formed", () => {
    const r = validateWidgetConfig({
      widgetType: "related_list",
      config: { relatedModel: "tickets", limit: 10, columns: ["id", "status"] },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects missing relatedModel", () => {
    const r = validateWidgetConfig({
      widgetType: "related_list",
      config: { limit: 10, columns: ["id"] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects limit > MAX (200)", () => {
    const r = validateWidgetConfig({
      widgetType: "related_list",
      config: { relatedModel: "x", limit: 500, columns: ["id"] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects zero / negative limit", () => {
    const r = validateWidgetConfig({
      widgetType: "related_list",
      config: { relatedModel: "x", limit: 0, columns: ["id"] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects empty columns", () => {
    const r = validateWidgetConfig({
      widgetType: "related_list",
      config: { relatedModel: "x", limit: 10, columns: [] },
    })
    expect(r.ok).toBe(false)
  })
})

describe("N2 — widget-validator: chart", () => {
  it("accepts well-formed bar chart", () => {
    const r = validateWidgetConfig({
      widgetType: "chart",
      config: { chartType: "bar", dataSource: "deals_by_stage" },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects unknown chart type", () => {
    const r = validateWidgetConfig({
      widgetType: "chart",
      config: { chartType: "3d-pie", dataSource: "x" },
    })
    expect(r.ok).toBe(false)
  })

  it("accepts optional title", () => {
    const r = validateWidgetConfig({
      widgetType: "chart",
      config: { chartType: "line", dataSource: "x", title: "Revenue Trend" },
    })
    expect(r.ok).toBe(true)
  })
})

describe("N2 — widget-validator: quick_actions", () => {
  it("accepts well-formed", () => {
    const r = validateWidgetConfig({
      widgetType: "quick_actions",
      config: { actions: ["create_task", "send_email"] },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects oversize action list", () => {
    const r = validateWidgetConfig({
      widgetType: "quick_actions",
      config: { actions: Array.from({ length: 20 }, (_, i) => `a${i}`) },
    })
    expect(r.ok).toBe(false)
  })
})

describe("N2 — widget-validator: activity_timeline", () => {
  it("accepts well-formed", () => {
    const r = validateWidgetConfig({
      widgetType: "activity_timeline",
      config: { include: ["calls", "emails"], limit: 20 },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects unknown activity kind", () => {
    const r = validateWidgetConfig({
      widgetType: "activity_timeline",
      config: { include: ["calls", "frob"], limit: 20 },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects bad limit", () => {
    const r = validateWidgetConfig({
      widgetType: "activity_timeline",
      config: { include: ["calls"], limit: 999 },
    })
    expect(r.ok).toBe(false)
  })
})

describe("N2 — widget-validator: html", () => {
  it("accepts well-formed", () => {
    const r = validateWidgetConfig({
      widgetType: "html",
      config: { html: "<p>Hello</p>" },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects oversize html", () => {
    const r = validateWidgetConfig({
      widgetType: "html",
      config: { html: "x".repeat(200_000) },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-string html", () => {
    const r = validateWidgetConfig({
      widgetType: "html",
      config: { html: 42 as never },
    })
    expect(r.ok).toBe(false)
  })
})

describe("N2 — widget-validator: embed_external", () => {
  it("accepts well-formed https URL", () => {
    const r = validateWidgetConfig({
      widgetType: "embed_external",
      config: { url: "https://example.com/embed", heightPx: 600, allowCookies: false },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects http (non-https)", () => {
    const r = validateWidgetConfig({
      widgetType: "embed_external",
      config: { url: "http://example.com", heightPx: 600, allowCookies: false },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects bad height", () => {
    const r = validateWidgetConfig({
      widgetType: "embed_external",
      config: { url: "https://example.com", heightPx: 99_999, allowCookies: false },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects missing allowCookies", () => {
    const r = validateWidgetConfig({
      widgetType: "embed_external",
      config: { url: "https://example.com", heightPx: 400 },
    })
    expect(r.ok).toBe(false)
  })
})

describe("N2 — widget-validator: cross-cutting", () => {
  it("rejects unknown widgetType", () => {
    const r = validateWidgetConfig({
      widgetType: "iframe-spy" as never,
      config: {},
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-object config", () => {
    const r = validateWidgetConfig({
      widgetType: "html",
      config: "not an object" as never,
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Assignment resolver ─────────────────────────────────────────────── */

describe("N2 — assignment-resolver", () => {
  function mk(scopeType: AssignmentRow["scopeType"], scopeId: string | null, pageId: string, isActive = true): AssignmentRow {
    return {
      id: `${scopeType}:${scopeId ?? "default"}`,
      pageId,
      scopeType,
      scopeId,
      isActive,
    }
  }

  it("returns user-tier match (highest precedence)", () => {
    const r = resolveAssignment({
      assignments: [
        mk("default", null, "page-default"),
        mk("role", "sales", "page-role"),
        mk("user", "user-1", "page-user"),
      ],
      user: { id: "user-1", role: "sales", profileId: null },
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.matchedAssignment) {
      expect(r.matchedAssignment.pageId).toBe("page-user")
      expect(r.matchedScope).toBe("user")
    }
  })

  it("falls back to profile when no user match", () => {
    const r = resolveAssignment({
      assignments: [
        mk("default", null, "page-default"),
        mk("profile", "prof-1", "page-profile"),
      ],
      user: { id: "user-1", role: "sales", profileId: "prof-1" },
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.matchedAssignment) {
      expect(r.matchedAssignment.pageId).toBe("page-profile")
      expect(r.matchedScope).toBe("profile")
    }
  })

  it("falls back to role when no user / profile match", () => {
    const r = resolveAssignment({
      assignments: [
        mk("default", null, "page-default"),
        mk("role", "sales", "page-role"),
      ],
      user: { id: "user-1", role: "sales", profileId: null },
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.matchedAssignment) {
      expect(r.matchedScope).toBe("role")
    }
  })

  it("falls back to default when no other match", () => {
    const r = resolveAssignment({
      assignments: [mk("default", null, "page-default")],
      user: { id: "user-1", role: "manager", profileId: null },
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.matchedAssignment) {
      expect(r.matchedScope).toBe("default")
    }
  })

  it("returns null match when no default + no other tier", () => {
    const r = resolveAssignment({
      assignments: [mk("role", "manager", "page-mgr")],
      user: { id: "user-1", role: "sales", profileId: null },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.matchedAssignment).toBeNull()
      expect(r.matchedScope).toBeNull()
    }
  })

  it("skips user tier if user has no role / profileId set (gracefully)", () => {
    const r = resolveAssignment({
      assignments: [mk("default", null, "page-default")],
      user: { id: "user-1", role: null, profileId: null },
    })
    expect(r.ok).toBe(true)
  })

  it("ignores inactive assignments", () => {
    const r = resolveAssignment({
      assignments: [
        mk("user", "user-1", "page-user", /* isActive= */ false),
        mk("default", null, "page-default"),
      ],
      user: { id: "user-1", role: null, profileId: null },
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.matchedAssignment) {
      expect(r.matchedScope).toBe("default")
    }
  })

  it("rejects multiple active assignments at same scope (caller bug)", () => {
    const r = resolveAssignment({
      assignments: [
        mk("user", "user-1", "page-a"),
        { ...mk("user", "user-1", "page-b"), id: "dup" },
      ],
      user: { id: "user-1", role: null, profileId: null },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/multiple active/)
  })

  it("rejects missing user.id", () => {
    const r = resolveAssignment({
      assignments: [],
      user: { id: "", role: null, profileId: null },
    })
    expect(r.ok).toBe(false)
  })
})

describe("N2 — lintAssignmentSet", () => {
  function mk(scopeType: AssignmentRow["scopeType"], scopeId: string | null, pageId: string, isActive = true): AssignmentRow {
    return {
      id: `lint-${scopeType}:${scopeId ?? "default"}-${Math.random()}`,
      pageId,
      scopeType,
      scopeId,
      isActive,
    }
  }

  it("returns empty for clean set", () => {
    const issues = lintAssignmentSet([
      mk("default", null, "p1"),
      mk("role", "sales", "p2"),
      mk("user", "u1", "p3"),
    ])
    expect(issues).toEqual([])
  })

  it("flags multiple active defaults", () => {
    const issues = lintAssignmentSet([
      mk("default", null, "p1"),
      mk("default", null, "p2"),
    ])
    expect(issues.some((i) => /active default/.test(i))).toBe(true)
  })

  it("flags multiple active assignments per scope", () => {
    const issues = lintAssignmentSet([
      mk("user", "u1", "p1"),
      mk("user", "u1", "p2"),
    ])
    expect(issues.some((i) => /user:u1/.test(i))).toBe(true)
  })

  it("flags default with non-null scopeId", () => {
    const issues = lintAssignmentSet([
      { id: "bad", pageId: "p", scopeType: "default", scopeId: "should-be-null", isActive: true },
    ])
    expect(issues.some((i) => /default but scopeId is not null/.test(i))).toBe(true)
  })

  it("flags non-default with null scopeId", () => {
    const issues = lintAssignmentSet([
      { id: "bad", pageId: "p", scopeType: "user", scopeId: null, isActive: true },
    ])
    expect(issues.length).toBeGreaterThan(0)
  })

  it("ignores inactive when checking duplicates", () => {
    const issues = lintAssignmentSet([
      mk("default", null, "p1"),
      mk("default", null, "p2", false),
    ])
    expect(issues).toEqual([])
  })
})

/* ─── Layout serializer ───────────────────────────────────────────────── */

describe("N2 — layout-serializer", () => {
  const page: LayoutPage = {
    id: "page-1",
    slug: "deal-default",
    name: "Deal Default Layout",
    objectType: "deal",
    status: "published",
    version: 1,
  }

  function mkRegion(id: string, displayOrder: number, regionType: LayoutRegion["regionType"] = "main"): LayoutRegion {
    return {
      id,
      pageId: "page-1",
      regionType,
      displayOrder,
      widthCols: 12,
      label: null,
    }
  }

  function mkWidget(
    id: string,
    regionId: string,
    displayOrder: number,
    isVisible = true
  ): LayoutWidget {
    return {
      id,
      regionId,
      widgetType: "record_details",
      displayOrder,
      config: { fields: ["name"] },
      label: null,
      isVisible,
    }
  }

  it("serializes a simple 2-region 3-widget layout", () => {
    const r = serializeLayout({
      page,
      regions: [mkRegion("r1", 1, "header"), mkRegion("r2", 2, "main")],
      widgets: [
        mkWidget("w1", "r1", 1),
        mkWidget("w2", "r2", 1),
        mkWidget("w3", "r2", 2),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.layout.regions).toHaveLength(2)
      expect(r.layout.regions[0].widgets).toHaveLength(1)
      expect(r.layout.regions[1].widgets).toHaveLength(2)
    }
  })

  it("filters invisible widgets", () => {
    const r = serializeLayout({
      page,
      regions: [mkRegion("r1", 1)],
      widgets: [
        mkWidget("w1", "r1", 1, true),
        mkWidget("w2", "r1", 2, false),
        mkWidget("w3", "r1", 3, true),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.layout.regions[0].widgets).toHaveLength(2)
      expect(r.layout.regions[0].widgets.map((w) => w.id)).toEqual(["w1", "w3"])
    }
  })

  it("sorts regions by displayOrder", () => {
    const r = serializeLayout({
      page,
      regions: [mkRegion("r-b", 2), mkRegion("r-a", 1)],
      widgets: [],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.layout.regions.map((reg) => reg.id)).toEqual(["r-a", "r-b"])
    }
  })

  it("sorts widgets within a region by displayOrder", () => {
    const r = serializeLayout({
      page,
      regions: [mkRegion("r1", 1)],
      widgets: [mkWidget("w-b", "r1", 2), mkWidget("w-a", "r1", 1)],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.layout.regions[0].widgets.map((w) => w.id)).toEqual(["w-a", "w-b"])
    }
  })

  it("rejects duplicate region displayOrder", () => {
    const r = serializeLayout({
      page,
      regions: [mkRegion("r1", 1), mkRegion("r2", 1)],
      widgets: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/duplicate region/)
  })

  it("rejects duplicate widget displayOrder in same region", () => {
    const r = serializeLayout({
      page,
      regions: [mkRegion("r1", 1)],
      widgets: [mkWidget("w1", "r1", 1), mkWidget("w2", "r1", 1)],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects widget pointing at unknown region", () => {
    const r = serializeLayout({
      page,
      regions: [mkRegion("r1", 1)],
      widgets: [mkWidget("w1", "r-ghost", 1)],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects region pointing at wrong pageId", () => {
    const badRegion: LayoutRegion = { ...mkRegion("r1", 1), pageId: "other-page" }
    const r = serializeLayout({
      page,
      regions: [badRegion],
      widgets: [],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects bad input shapes", () => {
    expect(serializeLayout({ page: null as never, regions: [], widgets: [] }).ok).toBe(false)
    expect(serializeLayout({ page, regions: "not array" as never, widgets: [] }).ok).toBe(false)
  })

  it("isLayoutPage / isLayoutRegion / isLayoutWidget type guards", () => {
    expect(isLayoutPage(page)).toBe(true)
    expect(isLayoutRegion(mkRegion("r1", 1))).toBe(true)
    expect(isLayoutWidget(mkWidget("w1", "r1", 1))).toBe(true)
    expect(isLayoutPage(null)).toBe(false)
    expect(isLayoutRegion({})).toBe(false)
    expect(isLayoutWidget({})).toBe(false)
  })
})

/* ─── Drift guards ────────────────────────────────────────────────────── */

describe("N2 — registry drift guards", () => {
  it("PAGE_STATUSES exactly 3", () => {
    expect(PAGE_STATUSES).toEqual(["draft", "published", "archived"])
  })

  it("REGION_TYPES exactly 4", () => {
    expect(REGION_TYPES).toEqual(["header", "main", "sidebar", "footer"])
  })

  it("WIDGET_TYPES exactly 7 (DB CHECK + helper switch + this test must move together)", () => {
    expect(WIDGET_TYPES).toEqual([
      "record_details",
      "related_list",
      "chart",
      "quick_actions",
      "activity_timeline",
      "html",
      "embed_external",
    ])
  })

  it("ASSIGNMENT_SCOPE_TYPES exactly 4", () => {
    expect(ASSIGNMENT_SCOPE_TYPES).toEqual(["default", "role", "profile", "user"])
  })

  it("SCOPE_PRECEDENCE is user > profile > role > default", () => {
    expect(SCOPE_PRECEDENCE).toEqual(["user", "profile", "role", "default"])
  })

  it("PAGE_TRANSITIONS covers every status", () => {
    for (const s of PAGE_STATUSES) {
      expect(PAGE_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("Terminal pages are exactly [archived]", () => {
    const terminals = PAGE_STATUSES.filter((s) => PAGE_TRANSITIONS[s].length === 0)
    expect(terminals).toEqual(["archived"])
  })
})
