/**
 * Lightning App Builder types — N2 Phase 6 Block D slice 1.
 *
 * Salesforce Lightning App Builder analogue. Shared shape between
 * 5 pure helpers:
 *   1. state-machine         — page status lifecycle
 *   2. widget-validator      — per-type config shape checks
 *   3. assignment-resolver   — pick page for (user, role, profile, default)
 *   4. layout-serializer     — render-ready JSON tree
 *   5. (re-exported)         — typed I/O for slice-2 caller code
 *
 * Pure — no Prisma imports.
 */

/* ─── Page status ─────────────────────────────────────────────────────── */

export const PAGE_STATUSES = ["draft", "published", "archived"] as const
export type PageStatus = (typeof PAGE_STATUSES)[number]

/**
 *   draft → published   (admin publishes)
 *         → archived    (admin discards draft)
 *   published → draft   (admin un-publishes for edit) — copies to new draft
 *             → archived
 *   archived → []       (terminal; clone-to-draft via new row)
 *
 * Slice-1 helper allows republish via `archived → published` ONLY via
 * a "clone-to-new-page" path (caller creates a new draft from archived
 * source, then publishes). DB enforces enum membership; helper enforces
 * transition allow-list.
 */
export const PAGE_TRANSITIONS: Readonly<Record<PageStatus, readonly PageStatus[]>> = {
  draft: ["published", "archived"],
  published: ["draft", "archived"],
  archived: [],
}

/* ─── Region types ────────────────────────────────────────────────────── */

export const REGION_TYPES = ["header", "main", "sidebar", "footer"] as const
export type RegionType = (typeof REGION_TYPES)[number]

/* ─── Widget types ────────────────────────────────────────────────────── */

/**
 * Slice-1 widget allowlist. Adding a new type requires:
 *   1. Extend this constant (and the DB CHECK in the migration).
 *   2. Extend the per-type validator branch.
 *   3. Update the drift-guard test.
 */
export const WIDGET_TYPES = [
  "record_details",
  "related_list",
  "chart",
  "quick_actions",
  "activity_timeline",
  "html",
  "embed_external",
] as const

export type WidgetType = (typeof WIDGET_TYPES)[number]

/* ─── Assignment scope ────────────────────────────────────────────────── */

export const ASSIGNMENT_SCOPE_TYPES = ["default", "role", "profile", "user"] as const
export type AssignmentScopeType = (typeof ASSIGNMENT_SCOPE_TYPES)[number]

/**
 * Precedence order for resolution — highest priority first.
 *   user > profile > role > default
 *
 * The resolver walks this array and returns the first matching active
 * assignment. Drift-guard test pins this order.
 */
export const SCOPE_PRECEDENCE: Readonly<AssignmentScopeType[]> = [
  "user",
  "profile",
  "role",
  "default",
]

/* ─── Widget config shapes (per type) ─────────────────────────────────── */

export interface RecordDetailsConfig {
  /** Field paths to display in order. */
  fields: readonly string[]
  /** Optional grouping label. */
  groupLabel?: string
}

export interface RelatedListConfig {
  /** Related model name (e.g. "tickets", "contacts"). */
  relatedModel: string
  /** Max rows to show inline. Slice-2 may paginate. */
  limit: number
  /** Columns to display. */
  columns: readonly string[]
}

export interface ChartConfig {
  /** Chart kind: "bar" | "line" | "pie" | "donut". */
  chartType: string
  /** Data source query name — caller-known query alias. */
  dataSource: string
  /** Optional title. */
  title?: string
}

export interface QuickActionsConfig {
  /** Action keys: "create_task", "send_email", etc. */
  actions: readonly string[]
}

export interface ActivityTimelineConfig {
  /** Activity kinds to include: "calls" | "emails" | "tasks" | "notes". */
  include: readonly string[]
  /** Max rows. */
  limit: number
}

export interface HtmlConfig {
  /** Raw HTML body — slice-2 sanitises before render. */
  html: string
}

export interface EmbedExternalConfig {
  /** URL to iframe. */
  url: string
  heightPx: number
  /** Whether the URL is allowed to set cookies — slice-2 honours. */
  allowCookies: boolean
}

/* ─── Widget-validator I/O ────────────────────────────────────────────── */

export interface ValidateWidgetInput {
  widgetType: WidgetType
  config: unknown
}

export type ValidateWidgetResult =
  | { ok: true; widgetType: WidgetType; config: unknown }
  | { ok: false; errors: string[] }

/* ─── Assignment-resolver I/O ─────────────────────────────────────────── */

/**
 * One assignment row as helper input. `scopeId` is null for default.
 * The resolver does NOT consult the DB — caller pre-fetches all
 * active assignments for the (org, objectType) and passes them as
 * a candidate set.
 */
export interface AssignmentRow {
  id: string
  pageId: string
  scopeType: AssignmentScopeType
  scopeId: string | null
  isActive: boolean
}

export interface ResolveAssignmentInput {
  /** Active assignments for (org, objectType). Order irrelevant — resolver sorts internally. */
  assignments: readonly AssignmentRow[]
  /** Acting user identity for resolution. */
  user: {
    id: string
    role: string | null
    profileId: string | null
  }
}

export type ResolveAssignmentResult =
  | { ok: true; matchedAssignment: AssignmentRow; matchedScope: AssignmentScopeType }
  | { ok: true; matchedAssignment: null; matchedScope: null }
  | { ok: false; error: string }

/* ─── Layout serializer I/O ───────────────────────────────────────────── */

export interface LayoutPage {
  id: string
  slug: string
  name: string
  objectType: string
  status: PageStatus
  version: number
}

export interface LayoutRegion {
  id: string
  pageId: string
  regionType: RegionType
  displayOrder: number
  widthCols: number | null
  label: string | null
}

export interface LayoutWidget {
  id: string
  regionId: string
  widgetType: WidgetType
  displayOrder: number
  config: unknown
  label: string | null
  isVisible: boolean
}

export interface SerializeLayoutInput {
  page: LayoutPage
  regions: readonly LayoutRegion[]
  widgets: readonly LayoutWidget[]
}

export interface SerializedRegion {
  id: string
  regionType: RegionType
  displayOrder: number
  widthCols: number | null
  label: string | null
  widgets: SerializedWidget[]
}

export interface SerializedWidget {
  id: string
  widgetType: WidgetType
  displayOrder: number
  config: unknown
  label: string | null
}

export interface SerializedLayout {
  pageId: string
  pageSlug: string
  pageName: string
  pageStatus: PageStatus
  objectType: string
  version: number
  regions: SerializedRegion[]
}

export type SerializeLayoutResult =
  | { ok: true; layout: SerializedLayout }
  | { ok: false; error: string }
