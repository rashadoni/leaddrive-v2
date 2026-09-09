/**
 * C5 Account Engagement — Phase 5: third-party intent CSV import.
 *
 * POST /api/v1/account-intent-signals/import
 *   Body: { csv: string }   (a third-party intent export, header-mapped)
 *
 * Parses the CSV, resolves each row's company (domain → website, else name) to
 * a tracked MarketingAccount, and records third_party_intent signals (company-
 * level, contactId null, idempotent per account+topic+date). Admin-gated +
 * tenant-scoped; the actual vendor API integration (Bombora/6sense) is the
 * deferred paid piece — this route + the provider seam are the interim path.
 */
import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  parseIntentCsv,
  applyThirdPartyIntentRows,
} from "@/lib/account-engagement/third-party-intent"

const TABLE = "account_intent_signals"
const MAX_CSV_BYTES = 2_000_000 // 2 MB

export const POST = withRlsAuth(
  "account-engagement",
  "write",
  async (req: NextRequest, auth) => {
    const orgId = auth.orgId

    let body: { csv?: unknown }
    try {
      body = (await req.json()) as { csv?: unknown }
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const csv = typeof body.csv === "string" ? body.csv : null
    if (!csv) {
      return NextResponse.json({ error: "`csv` (string) is required" }, { status: 400 })
    }
    if (csv.length > MAX_CSV_BYTES) {
      return NextResponse.json(
        { error: `CSV too large — max ${MAX_CSV_BYTES} bytes` },
        { status: 413 },
      )
    }

    const { rows, errors } = parseIntentCsv(csv)
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows parsed", parseErrors: errors.slice(0, 20) },
        { status: 400 },
      )
    }

    try {
      const result = await applyThirdPartyIntentRows(orgId, rows)

      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: null,
        action: "write",
        metadata: {
          source: "third_party_intent_csv",
          totalRows: result.totalRows,
          recorded: result.recorded,
        },
      })

      return NextResponse.json(
        { ...result, parseErrors: errors.slice(0, 20) },
        { status: result.recorded > 0 ? 201 : 200 },
      )
    } catch (err) {
      console.error("[account-intent-signals/import] POST error:", err instanceof Error ? err.message : "unknown")
      return NextResponse.json({ error: "Failed to import intent signals" }, { status: 500 })
    }
  },
)
