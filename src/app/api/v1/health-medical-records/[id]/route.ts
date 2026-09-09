/**
 * R2 Health — medical record per-id (slice-2-mini).
 *
 * GET only — the underlying table is append-only at the DB layer via
 * `health_medical_records_no_update_trigger`. There is no PATCH and
 * no DELETE; corrections are made by POSTing a follow-on record (e.g.
 * `addendum` type) that points at the prior row via
 * `metadata.supersedes`. This route exposes the read path only and
 * emits a PHI-audit row including the sensitivity tag (HIPAA
 * minimum-necessary trail).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { recordPhiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { softDecryptForTenant } from "@/lib/crypto/tenant-pii-encryption"
import { withRlsAuth } from "@/lib/with-rls"

const TABLE = "health_medical_records"

export const GET = withRlsAuth("health", "read", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing record id" }, { status: 400 })
  }

  try {
    const record = await prisma.healthMedicalRecord.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!record) {
      void recordPhiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json({ error: "Record not found" }, { status: 404 })
    }

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: record.id,
      action: "read",
      metadata: {
        patientId: record.patientId,
        encounterId: record.encounterId,
        recordedByProviderId: record.recordedByProviderId,
        recordType: record.recordType,
        severity: record.severity,
        sensitivity: record.sensitivity,
      },
    })

    // Soft-decrypt clinicianNotes (slice-2 column wrap — free-text PHI).
    return NextResponse.json({
      record: {
        ...record,
        clinicianNotes: softDecryptForTenant(orgId, record.clinicianNotes),
      },
    })
  } catch (err) {
    console.error("[health-medical-records/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load record" },
      { status: 500 },
    )
  }
})
