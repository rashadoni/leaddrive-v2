import { createHash } from "node:crypto"
import { z } from "zod"
import {
  CoveragePolicyDefinitionSchema,
  CoverageSnapshotImportSchema,
  CoverageSnapshotTotalsSchema,
  canonicalCoveragePolicyJson,
  coverageSnapshotTotalsReconcile,
} from "@/lib/mtm/coverage-policy"

const METRICS = [
  "requiredCoverage",
  "actualMoi",
  "target",
  "actualCoverage",
  "uncoveredMoi",
] as const

type CoverageDefinition = z.infer<typeof CoveragePolicyDefinitionSchema>
type CoverageImport = z.infer<typeof CoverageSnapshotImportSchema>
type CoverageImportRow = CoverageImport["rows"][number]

export interface PreparedCoverageSnapshotRow extends CoverageImportRow {
  rowHash: string
  ownerAgentId: string
  ownerAgentName: string
  groupLabel: string
  groupOrder: number
}

export interface PreparedCoverageSnapshot {
  populationHash: string
  totals: z.infer<typeof CoverageSnapshotTotalsSchema>
  rows: PreparedCoverageSnapshotRow[]
}

export type PrepareCoverageSnapshotResult =
  | { ok: true; value: PreparedCoverageSnapshot }
  | { ok: false; issues: string[] }

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalCoveragePolicyJson(value)).digest("hex")
}

function decimalScale4(value: string): bigint {
  const negative = value.startsWith("-")
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".")
  const scaled = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"))
  return negative ? -scaled : scaled
}

function decimalText(value: bigint, scale: number): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / 10_000n
  const fraction = (absolute % 10_000n).toString().padStart(4, "0").slice(0, scale)
  const trimmed = fraction.replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole}${trimmed ? `.${trimmed}` : ""}`
}

function conformsToScale(value: string, scale: number): boolean {
  const fraction = value.split(".")[1]?.replace(/0+$/, "") ?? ""
  return fraction.length <= scale
}

function zeroMetrics() {
  return Object.fromEntries(METRICS.map((metric) => [metric, 0n])) as Record<typeof METRICS[number], bigint>
}

export function prepareCoverageSnapshot(
  definitionInput: unknown,
  input: CoverageImport,
  agent: { id: string; name: string },
): PrepareCoverageSnapshotResult {
  const parsedDefinition = CoveragePolicyDefinitionSchema.safeParse(definitionInput)
  if (!parsedDefinition.success) return { ok: false, issues: ["POLICY_DEFINITION_INVALID"] }
  const definition: CoverageDefinition = parsedDefinition.data
  const groups = new Map(definition.groups.map((group) => [group.key, group]))
  const issues: string[] = []

  const rows = input.rows.map((row, index): PreparedCoverageSnapshotRow | null => {
    const group = groups.get(row.groupKey)
    if (!group) {
      issues.push(`rows.${index}.groupKey:UNKNOWN_GROUP`)
      return null
    }
    if (group.subjectType !== row.subjectType) {
      issues.push(`rows.${index}.subjectType:GROUP_SUBJECT_MISMATCH`)
      return null
    }
    for (const metric of METRICS) {
      if (!conformsToScale(row[metric], definition.rounding.scale)) {
        issues.push(`rows.${index}.${metric}:ROUNDING_SCALE_MISMATCH`)
      }
    }
    const normalized = {
      ...row,
      ownerAgentId: agent.id,
      ownerAgentName: agent.name,
      groupLabel: group.labels.ru,
      groupOrder: group.order,
    }
    return { ...normalized, rowHash: sha256(normalized) }
  }).filter((row): row is PreparedCoverageSnapshotRow => Boolean(row))

  if (issues.length) return { ok: false, issues }

  const grouped = new Map<string, { populationCount: number; metrics: ReturnType<typeof zeroMetrics> }>()
  for (const group of definition.groups) grouped.set(group.key, { populationCount: 0, metrics: zeroMetrics() })
  for (const row of rows) {
    const total = grouped.get(row.groupKey)!
    total.populationCount += 1
    for (const metric of METRICS) total.metrics[metric] += decimalScale4(row[metric])
  }

  const overall = { populationCount: rows.length, metrics: zeroMetrics() }
  const totals = {
    groups: [...definition.groups]
      .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
      .map((group) => {
        const total = grouped.get(group.key)!
        for (const metric of METRICS) overall.metrics[metric] += total.metrics[metric]
        return {
          key: group.key,
          label: group.labels.ru,
          labels: group.labels,
          order: group.order,
          subjectType: group.subjectType,
          populationCount: total.populationCount,
          ...Object.fromEntries(METRICS.map((metric) => [metric, decimalText(total.metrics[metric], definition.rounding.scale)])),
        }
      }),
    overall: {
      populationCount: overall.populationCount,
      ...Object.fromEntries(METRICS.map((metric) => [metric, decimalText(overall.metrics[metric], definition.rounding.scale)])),
    },
  }
  const parsedTotals = CoverageSnapshotTotalsSchema.safeParse(totals)
  if (!parsedTotals.success || !coverageSnapshotTotalsReconcile(parsedTotals.data)) {
    return { ok: false, issues: ["TOTALS_RECONCILIATION_FAILED"] }
  }

  return {
    ok: true,
    value: {
      populationHash: sha256({
        schemaVersion: 1,
        policyId: input.policyId,
        definitionHash: input.expectedDefinitionHash.toLowerCase(),
        agentId: agent.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        sourceCutoffAt: input.sourceCutoffAt,
        sourceFreshnessAt: input.sourceFreshnessAt ?? null,
        sourceBatchReference: input.sourceBatchReference,
        rowHashes: rows.map((row) => row.rowHash).sort(),
      }),
      totals: parsedTotals.data,
      rows,
    },
  }
}
