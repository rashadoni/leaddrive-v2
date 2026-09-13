const RAW_GPS_RETENTION_DAYS = 30
export const WORKFORCE_RAW_LOCATION_RETENTION_MAX_BATCH = 500

export type WorkforceRawLocationRetentionMode = "DRY_RUN" | "EXECUTE"

type IdRow = { id: string }

export type WorkforceRawLocationRetentionDb = {
  mtmAgentLocation: {
    findMany: (args: Record<string, unknown>) => Promise<IdRow[]>
    deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>
    count: (args: Record<string, unknown>) => Promise<number>
  }
  mtmAgentLatestLocation: {
    findMany: (args: Record<string, unknown>) => Promise<IdRow[]>
    deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>
    count: (args: Record<string, unknown>) => Promise<number>
  }
  mtmAgentWorkday: {
    findMany: (args: Record<string, unknown>) => Promise<IdRow[]>
    updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>
    count: (args: Record<string, unknown>) => Promise<number>
  }
  mtmAgentWorkdayEvent: {
    findMany: (args: Record<string, unknown>) => Promise<IdRow[]>
    updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>
    count: (args: Record<string, unknown>) => Promise<number>
  }
  workforceAttendanceEvidence: {
    findMany: (args: Record<string, unknown>) => Promise<IdRow[]>
    updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>
    count: (args: Record<string, unknown>) => Promise<number>
  }
}

type RawLocationRetentionCounts = {
  locationRows: number
  latestLocationRows: number
  workdayCoordinateRows: number
  workdayEventCoordinateRows: number
  evidenceCiphertextRows: number
}

export type WorkforceRawLocationRetentionResult = {
  mode: WorkforceRawLocationRetentionMode
  rawGpsCutoff: string
  rawEvidenceDueAt: string
  candidates: RawLocationRetentionCounts
  purged: RawLocationRetentionCounts
  remaining: RawLocationRetentionCounts
  morePending: boolean
}

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${name} must be a valid timestamp`)
  }
  return value
}

function boundedLimit(value: number | undefined): number {
  if (value == null) return WORKFORCE_RAW_LOCATION_RETENTION_MAX_BATCH
  if (!Number.isSafeInteger(value) || value < 1 || value > WORKFORCE_RAW_LOCATION_RETENTION_MAX_BATCH) {
    throw new RangeError(`limit must be an integer from 1 to ${WORKFORCE_RAW_LOCATION_RETENTION_MAX_BATCH}`)
  }
  return value
}

function validatedMode(value: WorkforceRawLocationRetentionMode | undefined): WorkforceRawLocationRetentionMode {
  if (value == null) return "DRY_RUN"
  if (value !== "DRY_RUN" && value !== "EXECUTE") throw new RangeError("mode must be DRY_RUN or EXECUTE")
  return value
}

function validatedOrganizationId(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 191) throw new RangeError("organizationId is invalid")
  return normalized
}

function rawGpsCutoff(now: Date): Date {
  return new Date(now.getTime() - RAW_GPS_RETENTION_DAYS * 24 * 60 * 60 * 1_000)
}

function workdayCutoff(cutoff: Date): Date {
  // Workday is a PostgreSQL DATE. Use the completed UTC calendar day before
  // the exact cutoff; never round forward and clear a younger partial day.
  return new Date(`${cutoff.toISOString().slice(0, 10)}T00:00:00.000Z`)
}

function coordinateWhere(organizationId: string, before: Date) {
  return {
    organizationId,
    workDate: { lt: workdayCutoff(before) },
    OR: [
      { startLatitude: { not: null } },
      { startLongitude: { not: null } },
      { endLatitude: { not: null } },
      { endLongitude: { not: null } },
    ],
  }
}

function eventCoordinateWhere(organizationId: string, before: Date) {
  return {
    organizationId,
    occurredAt: { lt: before },
    OR: [
      { latitude: { not: null } },
      { longitude: { not: null } },
      { accuracy: { not: null } },
    ],
  }
}

function evidenceWhere(organizationId: string, now: Date) {
  return {
    organizationId,
    rawPurgedAt: null,
    rawExpiresAt: { lte: now },
    rawEnvelopeCiphertext: { not: null },
  }
}

function zeroCounts(): RawLocationRetentionCounts {
  return {
    locationRows: 0,
    latestLocationRows: 0,
    workdayCoordinateRows: 0,
    workdayEventCoordinateRows: 0,
    evidenceCiphertextRows: 0,
  }
}

function countsFromCandidates(candidates: {
  locations: readonly IdRow[]
  latestLocations: readonly IdRow[]
  workdays: readonly IdRow[]
  events: readonly IdRow[]
  evidence: readonly IdRow[]
}): RawLocationRetentionCounts {
  return {
    locationRows: candidates.locations.length,
    latestLocationRows: candidates.latestLocations.length,
    workdayCoordinateRows: candidates.workdays.length,
    workdayEventCoordinateRows: candidates.events.length,
    evidenceCiphertextRows: candidates.evidence.length,
  }
}

async function reconciliationCounts(
  db: WorkforceRawLocationRetentionDb,
  organizationId: string,
  cutoff: Date,
  now: Date,
): Promise<RawLocationRetentionCounts> {
  const [locationRows, latestLocationRows, workdayCoordinateRows, workdayEventCoordinateRows, evidenceCiphertextRows] = await Promise.all([
    db.mtmAgentLocation.count({ where: { organizationId, recordedAt: { lt: cutoff } } }),
    db.mtmAgentLatestLocation.count({ where: { organizationId, recordedAt: { lt: cutoff } } }),
    db.mtmAgentWorkday.count({ where: coordinateWhere(organizationId, cutoff) }),
    db.mtmAgentWorkdayEvent.count({ where: eventCoordinateWhere(organizationId, cutoff) }),
    db.workforceAttendanceEvidence.count({ where: evidenceWhere(organizationId, now) }),
  ])
  return { locationRows, latestLocationRows, workdayCoordinateRows, workdayEventCoordinateRows, evidenceCiphertextRows }
}

/**
 * Plan or perform one bounded tenant-scoped 30-day raw-location purge. The
 * default is DRY_RUN. EXECUTE is deliberately not exposed by an HTTP route or
 * scheduler until backup/restore, legal-hold and pressure gates are proven.
 */
export async function runWorkforceRawLocationRetention(
  db: WorkforceRawLocationRetentionDb,
  input: {
    organizationId: string
    mode?: WorkforceRawLocationRetentionMode
    limit?: number
    now?: Date
  },
): Promise<WorkforceRawLocationRetentionResult> {
  const organizationId = validatedOrganizationId(input.organizationId)
  const now = validDate(input.now ?? new Date(), "now")
  const mode = validatedMode(input.mode)
  const limit = boundedLimit(input.limit)
  const cutoff = rawGpsCutoff(now)
  const [locations, latestLocations, workdays, events, evidence] = await Promise.all([
    db.mtmAgentLocation.findMany({ where: { organizationId, recordedAt: { lt: cutoff } }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }], take: limit, select: { id: true } }),
    db.mtmAgentLatestLocation.findMany({ where: { organizationId, recordedAt: { lt: cutoff } }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }], take: limit, select: { id: true } }),
    db.mtmAgentWorkday.findMany({ where: coordinateWhere(organizationId, cutoff), orderBy: [{ workDate: "asc" }, { id: "asc" }], take: limit, select: { id: true } }),
    db.mtmAgentWorkdayEvent.findMany({ where: eventCoordinateWhere(organizationId, cutoff), orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: limit, select: { id: true } }),
    db.workforceAttendanceEvidence.findMany({ where: evidenceWhere(organizationId, now), orderBy: [{ rawExpiresAt: "asc" }, { id: "asc" }], take: limit, select: { id: true } }),
  ])
  const candidates = { locations, latestLocations, workdays, events, evidence }
  const candidateCounts = countsFromCandidates(candidates)
  const purged = zeroCounts()

  if (mode === "EXECUTE") {
    if (locations.length > 0) purged.locationRows = (await db.mtmAgentLocation.deleteMany({ where: { organizationId, id: { in: locations.map((row) => row.id) } } })).count
    if (latestLocations.length > 0) purged.latestLocationRows = (await db.mtmAgentLatestLocation.deleteMany({ where: { organizationId, id: { in: latestLocations.map((row) => row.id) } } })).count
    if (workdays.length > 0) purged.workdayCoordinateRows = (await db.mtmAgentWorkday.updateMany({
      where: { organizationId, id: { in: workdays.map((row) => row.id) } },
      data: { startLatitude: null, startLongitude: null, endLatitude: null, endLongitude: null },
    })).count
    if (events.length > 0) purged.workdayEventCoordinateRows = (await db.mtmAgentWorkdayEvent.updateMany({
      where: { organizationId, id: { in: events.map((row) => row.id) } },
      data: { latitude: null, longitude: null, accuracy: null },
    })).count
    if (evidence.length > 0) purged.evidenceCiphertextRows = (await db.workforceAttendanceEvidence.updateMany({
      where: {
        organizationId,
        id: { in: evidence.map((row) => row.id) },
        ...evidenceWhere(organizationId, now),
      },
      data: { rawEnvelopeCiphertext: null, rawPurgedAt: now },
    })).count
  }

  const remaining = await reconciliationCounts(db, organizationId, cutoff, now)
  return {
    mode,
    rawGpsCutoff: cutoff.toISOString(),
    rawEvidenceDueAt: now.toISOString(),
    candidates: candidateCounts,
    purged,
    remaining,
    morePending: Object.values(remaining).some((count) => count > 0),
  }
}
