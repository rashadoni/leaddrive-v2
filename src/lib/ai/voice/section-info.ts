import { VOICE_SECTIONS, voiceSectionNavItem } from "./sections"
import { SECTION_DESCRIPTORS, NO_DATA_SECTIONS } from "./section-registry"
import { RECORD_TYPES } from "./record-types"

/**
 * What a section IS, in words the assistant can say.
 *
 * The owner asked for two things the assistant could not do: know which screen
 * he was looking at, and explain what a section is for. This covers the second.
 *
 * HONEST LIMIT, stated here so nobody mistakes this for documentation: the app
 * has no written description of its sections. What exists is the one-line
 * subtitle printed on the launcher card (`navDesc`) and the menu group. Those
 * are real and were written for users, so they are used — but they are a
 * subtitle, not a manual. Anything richer has to be authored, and inventing it
 * here would produce confident sentences about features that may not exist.
 *
 * What IS reliable and worth saying is the second half: what the assistant can
 * actually do with that section — read which figures, open which records. That
 * is derived from the registries, so it cannot drift from the truth.
 */

export type SectionInfo = {
  section: string
  path: string
  group: string
  /** One-line subtitle from the launcher, in the user's language. */
  summary: string | null
  /** Figures the assistant can report here, empty when it has none. */
  canReport: string[]
  /** True when a named record of this kind can be found and opened. */
  canOpenRecords: boolean
  /** Why nothing can be reported, when that is the case. */
  noDataReason: string | null
}

const RECORD_ROUTE_TO_TYPE = new Map(
  Object.entries(RECORD_TYPES).map(([type, d]) => [d.route, type]),
)

export function buildSectionInfo(
  section: string,
  labels: { summary?: string; label?: string },
): SectionInfo | null {
  const path = VOICE_SECTIONS[section]
  if (!path) return null

  const item = voiceSectionNavItem(section)
  const desc = SECTION_DESCRIPTORS[section]

  const canReport: string[] = []
  if (desc) {
    canReport.push("total")
    if (desc.statusField) canReport.push("by status")
    if (desc.assigneeField) canReport.push("by person")
    if (desc.dueField) canReport.push("overdue")
    if (desc.amountField) canReport.push("money")
    if (desc.createdField) canReport.push("by period")
  }

  return {
    section,
    path,
    group: item?.group ?? "",
    summary: labels.summary ?? null,
    canReport,
    canOpenRecords: RECORD_ROUTE_TO_TYPE.has(path),
    // Spoken as the reason, so "I have no figures for this" comes with why.
    noDataReason: desc ? null : (NO_DATA_SECTIONS[section] ?? "unknown"),
  }
}
