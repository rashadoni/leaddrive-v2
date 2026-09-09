/**
 * Dashboard widget contracts for the drag-drop builder.
 *
 * A `DashboardLayout.layout` is a JSON array of `WidgetInstance`s. Each
 * instance binds to one of the catalogued widget types and carries a
 * config payload that the renderer (slice 2 UI) and the data fetcher
 * (slice 3 metrics resolver) consume.
 *
 * Adding a new widget type:
 *   1. Add a key to `WidgetType`
 *   2. Add a `WidgetTypeSpec` entry to `WIDGET_CATALOG`
 *   3. Add a `validateConfig` branch for the new type
 *
 * Part of I2 No-code Dashboard Builder (Phase 2 roadmap, slice 1).
 */

export type WidgetType =
  | "kpi_card"
  | "kpi_trend"
  | "line_chart"
  | "bar_chart"
  | "pie_chart"
  | "area_chart"
  | "table"
  | "list_recent"
  | "list_top_n"
  | "gauge"
  | "leaderboard"
  | "funnel"
  | "heatmap"
  | "single_value"
  | "saved_report"

export interface GridPosition {
  /** Column index (0-based). */
  x: number
  /** Row index (0-based). */
  y: number
  /** Width in grid columns (1-12, typically). */
  w: number
  /** Height in grid rows. */
  h: number
}

export interface WidgetInstance {
  /** Client-generated stable id (cuid or uuid). */
  id: string
  type: WidgetType
  /** Display title shown on the widget header. */
  title: string
  position: GridPosition
  /** Type-specific configuration — validated by `validateWidgetConfig`. */
  config: Record<string, unknown>
}

export interface DashboardLayoutPayload {
  /** Schema version — bump when widget contracts break. */
  version: 1
  /** Grid column count (12 is the default; tablets may use 6). */
  cols: number
  widgets: WidgetInstance[]
}

export interface WidgetTypeSpec {
  type: WidgetType
  label: string
  category: "metric" | "chart" | "list" | "table" | "report"
  description: string
  /** Recommended min/max grid size for this widget. */
  minSize: { w: number; h: number }
  maxSize: { w: number; h: number }
  /** JSON-schema-style description of `config`. Slice 2 UI renders forms. */
  configFields: { name: string; type: "string" | "number" | "boolean" | "select" | "ref"; required: boolean; ref?: string; options?: string[]; label?: string }[]
}

export const WIDGET_CATALOG: WidgetTypeSpec[] = [
  {
    type: "kpi_card",
    label: "KPI Card",
    category: "metric",
    description: "Single headline metric with optional comparison and trend arrow.",
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 3 },
    configFields: [
      { name: "metric", type: "string", required: true, label: "Metric key" },
      { name: "compareTo", type: "select", required: false, options: ["previous_period", "previous_year", "none"], label: "Compare to" },
      { name: "currency", type: "string", required: false, label: "Currency code" },
    ],
  },
  {
    type: "kpi_trend",
    label: "KPI Trend",
    category: "metric",
    description: "Sparkline + headline value showing recent direction.",
    minSize: { w: 3, h: 2 },
    maxSize: { w: 6, h: 3 },
    configFields: [
      { name: "metric", type: "string", required: true, label: "Metric key" },
      { name: "lookbackDays", type: "number", required: true, label: "Lookback days" },
    ],
  },
  {
    type: "line_chart",
    label: "Line Chart",
    category: "chart",
    description: "Time-series line chart for one or more metrics.",
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    configFields: [
      { name: "savedReportId", type: "ref", required: true, ref: "SavedReport", label: "Report" },
      { name: "xField", type: "string", required: true, label: "X axis field" },
      { name: "yField", type: "string", required: true, label: "Y axis field" },
    ],
  },
  {
    type: "bar_chart",
    label: "Bar Chart",
    category: "chart",
    description: "Comparison of values across categories.",
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    configFields: [
      { name: "savedReportId", type: "ref", required: true, ref: "SavedReport", label: "Report" },
      { name: "groupByField", type: "string", required: true, label: "Group-by field" },
      { name: "valueField", type: "string", required: true, label: "Value field" },
      { name: "orientation", type: "select", required: false, options: ["vertical", "horizontal"], label: "Orientation" },
    ],
  },
  {
    type: "pie_chart",
    label: "Pie Chart",
    category: "chart",
    description: "Proportional breakdown of a single metric across categories.",
    minSize: { w: 3, h: 3 },
    maxSize: { w: 6, h: 6 },
    configFields: [
      { name: "savedReportId", type: "ref", required: true, ref: "SavedReport", label: "Report" },
      { name: "labelField", type: "string", required: true, label: "Label field" },
      { name: "valueField", type: "string", required: true, label: "Value field" },
    ],
  },
  {
    type: "area_chart",
    label: "Area Chart",
    category: "chart",
    description: "Time-series area chart with optional stacking.",
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    configFields: [
      { name: "savedReportId", type: "ref", required: true, ref: "SavedReport", label: "Report" },
      { name: "xField", type: "string", required: true, label: "X axis field" },
      { name: "yField", type: "string", required: true, label: "Y axis field" },
      { name: "stacked", type: "boolean", required: false, label: "Stacked" },
    ],
  },
  {
    type: "table",
    label: "Table",
    category: "table",
    description: "Tabular view of a saved-report result set with column control.",
    minSize: { w: 4, h: 4 },
    maxSize: { w: 12, h: 12 },
    configFields: [
      { name: "savedReportId", type: "ref", required: true, ref: "SavedReport", label: "Report" },
      { name: "pageSize", type: "number", required: false, label: "Rows per page" },
    ],
  },
  {
    type: "list_recent",
    label: "Recent Records",
    category: "list",
    description: "Last N records of an entity in chronological order.",
    minSize: { w: 3, h: 4 },
    maxSize: { w: 6, h: 8 },
    configFields: [
      { name: "entityType", type: "select", required: true, options: ["deals", "leads", "contacts", "tickets", "tasks"], label: "Entity" },
      { name: "limit", type: "number", required: false, label: "Rows" },
    ],
  },
  {
    type: "list_top_n",
    label: "Top N",
    category: "list",
    description: "Top N records sorted by a chosen metric (e.g. top 5 deals by value).",
    minSize: { w: 3, h: 4 },
    maxSize: { w: 6, h: 8 },
    configFields: [
      { name: "entityType", type: "select", required: true, options: ["deals", "leads", "contacts", "tickets"], label: "Entity" },
      { name: "sortBy", type: "string", required: true, label: "Sort by field" },
      { name: "limit", type: "number", required: false, label: "Top N" },
    ],
  },
  {
    type: "gauge",
    label: "Gauge",
    category: "metric",
    description: "Speedometer-style gauge of a metric against a target.",
    minSize: { w: 3, h: 3 },
    maxSize: { w: 6, h: 6 },
    configFields: [
      { name: "metric", type: "string", required: true, label: "Metric key" },
      { name: "target", type: "number", required: true, label: "Target value" },
    ],
  },
  {
    type: "leaderboard",
    label: "Sales Leaderboard",
    category: "list",
    description: "Reps ranked by quota attainment for a period (A4 integration).",
    minSize: { w: 3, h: 4 },
    maxSize: { w: 6, h: 8 },
    configFields: [
      { name: "period", type: "select", required: false, options: ["current_quarter", "last_quarter", "current_year"], label: "Period" },
      { name: "limit", type: "number", required: false, label: "Top N" },
    ],
  },
  {
    type: "funnel",
    label: "Funnel",
    category: "chart",
    description: "Conversion funnel across pipeline stages or journey steps.",
    minSize: { w: 4, h: 4 },
    maxSize: { w: 8, h: 8 },
    configFields: [
      { name: "pipelineId", type: "ref", required: false, ref: "Pipeline", label: "Pipeline" },
      { name: "stagesField", type: "string", required: false, label: "Stages field" },
    ],
  },
  {
    type: "heatmap",
    label: "Heatmap",
    category: "chart",
    description: "2D matrix coloured by a metric value.",
    minSize: { w: 4, h: 4 },
    maxSize: { w: 12, h: 8 },
    configFields: [
      { name: "savedReportId", type: "ref", required: true, ref: "SavedReport", label: "Report" },
      { name: "rowField", type: "string", required: true, label: "Row field" },
      { name: "colField", type: "string", required: true, label: "Column field" },
      { name: "valueField", type: "string", required: true, label: "Value field" },
    ],
  },
  {
    type: "single_value",
    label: "Single Value",
    category: "metric",
    description: "One number, no chrome — for tickers and badges.",
    minSize: { w: 1, h: 1 },
    maxSize: { w: 4, h: 2 },
    configFields: [
      { name: "metric", type: "string", required: true, label: "Metric key" },
    ],
  },
  {
    type: "saved_report",
    label: "Saved Report",
    category: "report",
    description: "Embed a saved report rendered with its own chart type.",
    minSize: { w: 4, h: 4 },
    maxSize: { w: 12, h: 12 },
    configFields: [
      { name: "savedReportId", type: "ref", required: true, ref: "SavedReport", label: "Report" },
    ],
  },
]

export const WIDGET_SPECS_BY_TYPE: Map<WidgetType, WidgetTypeSpec> = new Map(
  WIDGET_CATALOG.map(s => [s.type, s])
)

/* ─── Validation ──────────────────────────────────────────────────────── */

export interface ValidationIssue {
  widgetId?: string
  field?: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}

const GRID_MAX_COLS = 12
const GRID_MAX_ROWS = 64

/**
 * Validate a single widget config against its type spec. Pure — no I/O,
 * no DB. Returns a list of issues; empty list means valid.
 */
export function validateWidgetConfig(widget: WidgetInstance): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const spec = WIDGET_SPECS_BY_TYPE.get(widget.type)
  if (!spec) {
    issues.push({ widgetId: widget.id, message: `Unknown widget type: ${widget.type}` })
    return issues
  }
  if (!widget.id || typeof widget.id !== "string") {
    issues.push({ widgetId: widget.id, message: "Widget id is required" })
  }
  if (!widget.title || typeof widget.title !== "string") {
    issues.push({ widgetId: widget.id, message: "Widget title is required" })
  }

  // Position check — defensive against undefined and non-numeric fields.
  // Malformed clients send `position: undefined` or `position: { x: "5" }`;
  // both must be rejected before any numeric comparison.
  const p = widget.position
  if (!p || typeof p !== "object") {
    issues.push({ widgetId: widget.id, message: "Position is required" })
  } else if (
    typeof p.x !== "number" || typeof p.y !== "number" ||
    typeof p.w !== "number" || typeof p.h !== "number" ||
    !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
    !Number.isFinite(p.w) || !Number.isFinite(p.h)
  ) {
    issues.push({ widgetId: widget.id, field: "position", message: "Position fields x/y/w/h must all be finite numbers" })
  } else {
    if (p.x < 0 || p.x >= GRID_MAX_COLS) issues.push({ widgetId: widget.id, field: "position.x", message: `x must be in [0, ${GRID_MAX_COLS})` })
    if (p.y < 0 || p.y >= GRID_MAX_ROWS) issues.push({ widgetId: widget.id, field: "position.y", message: `y must be in [0, ${GRID_MAX_ROWS})` })
    if (p.w < spec.minSize.w || p.w > spec.maxSize.w) issues.push({ widgetId: widget.id, field: "position.w", message: `width must be in [${spec.minSize.w}, ${spec.maxSize.w}] for ${spec.type}` })
    if (p.h < spec.minSize.h || p.h > spec.maxSize.h) issues.push({ widgetId: widget.id, field: "position.h", message: `height must be in [${spec.minSize.h}, ${spec.maxSize.h}] for ${spec.type}` })
    if (p.x + p.w > GRID_MAX_COLS) issues.push({ widgetId: widget.id, field: "position", message: `widget overflows grid columns (x+w > ${GRID_MAX_COLS})` })
  }

  // Config field check
  const config = widget.config ?? {}
  for (const field of spec.configFields) {
    const value = config[field.name]
    const present = value !== undefined && value !== null && value !== ""
    if (field.required && !present) {
      issues.push({ widgetId: widget.id, field: field.name, message: `${field.name} is required for ${spec.type}` })
      continue
    }
    if (!present) continue
    // Type check
    switch (field.type) {
      case "string":
      case "ref":
        if (typeof value !== "string") issues.push({ widgetId: widget.id, field: field.name, message: `${field.name} must be a string` })
        break
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) issues.push({ widgetId: widget.id, field: field.name, message: `${field.name} must be a number` })
        break
      case "boolean":
        if (typeof value !== "boolean") issues.push({ widgetId: widget.id, field: field.name, message: `${field.name} must be a boolean` })
        break
      case "select":
        if (typeof value !== "string" || (field.options && !field.options.includes(value))) {
          issues.push({ widgetId: widget.id, field: field.name, message: `${field.name} must be one of: ${field.options?.join(", ")}` })
        }
        break
    }
  }
  return issues
}

/**
 * Validate an entire layout payload. Checks (1) version & cols, (2) each
 * widget individually, (3) duplicate ids, (4) widget overlap on the grid.
 * Layout-level checks aggregated with per-widget issues.
 */
export function validateLayout(payload: DashboardLayoutPayload): ValidationResult {
  const issues: ValidationIssue[] = []

  if (payload.version !== 1) {
    issues.push({ message: `Unsupported layout version: ${payload.version}` })
  }
  if (!Number.isInteger(payload.cols) || payload.cols < 1 || payload.cols > GRID_MAX_COLS) {
    issues.push({ message: `cols must be an integer in [1, ${GRID_MAX_COLS}]` })
  }
  if (!Array.isArray(payload.widgets)) {
    issues.push({ message: "widgets must be an array" })
    return { valid: false, issues }
  }

  // Duplicate id check
  const seenIds = new Set<string>()
  for (const w of payload.widgets) {
    if (seenIds.has(w.id)) {
      issues.push({ widgetId: w.id, message: `Duplicate widget id: ${w.id}` })
    }
    seenIds.add(w.id)
    issues.push(...validateWidgetConfig(w))
  }

  // Overlap check — only when no other issues (position validity already
  // checked per-widget; running overlap on invalid positions would noise up)
  if (issues.length === 0) {
    for (let i = 0; i < payload.widgets.length; i++) {
      for (let j = i + 1; j < payload.widgets.length; j++) {
        if (rectsOverlap(payload.widgets[i].position, payload.widgets[j].position)) {
          issues.push({
            widgetId: payload.widgets[i].id,
            field: "position",
            message: `Widget ${payload.widgets[i].id} overlaps ${payload.widgets[j].id}`,
          })
        }
      }
    }
  }

  return { valid: issues.length === 0, issues }
}

function rectsOverlap(a: GridPosition, b: GridPosition): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}
