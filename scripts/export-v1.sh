#!/bin/bash
# ═══════════════════════════════════════════════════
# LeadDrive CRM v1 → v2 Data Export
# Run on Mac: bash scripts/export-v1.sh
# Requires: psql (brew install libpq)
# ═══════════════════════════════════════════════════

set -e

V1_HOST="${V1_HOST:?Set V1_HOST env var}"
V1_PORT="${V1_PORT:-5432}"
V1_DB="${V1_DB:?Set V1_DB env var}"
V1_USER="${V1_USER:?Set V1_USER env var}"
V1_PASS="${V1_PASS:?Set V1_PASS env var}"

EXPORT_DIR="./scripts/v1-data"
PSQL="/opt/homebrew/opt/libpq/bin/psql"

mkdir -p "$EXPORT_DIR"

echo "🔄 LeadDrive CRM v1 Data Export"
echo "   Server: $V1_HOST:$V1_PORT/$V1_DB"
echo ""

export PGPASSWORD="$V1_PASS"

# Function to export table as JSON
export_table() {
  local table=$1
  local query=${2:-"SELECT * FROM $table"}
  echo "  📦 Exporting $table..."
  $PSQL -h $V1_HOST -p $V1_PORT -U $V1_USER -d $V1_DB -t -A -c \
    "SELECT json_agg(t) FROM ($query) t" > "$EXPORT_DIR/${table}.json" 2>/dev/null || echo "    ⚠️ Failed: $table"
}

# Core CRM
export_table "companies"
export_table "contacts"
export_table "deals"
export_table "leads"
export_table "tasks"
export_table "activities"
export_table "contracts"
export_table "offers"

# Users & Auth
export_table "users"
export_table "roles"

# Pipeline
export_table "pipeline_stages"

# Cost Model
export_table "overhead_costs"
export_table "cost_employees"
export_table "pricing_parameters"
export_table "client_services"
export_table "cost_model_log"

# Support
export_table "tickets"
export_table "ticket_comments"
export_table "sla_policies"
export_table "kb_articles"
export_table "kb_categories"

# Marketing
export_table "campaigns"
export_table "campaign_recipients" "SELECT * FROM campaign_recipients LIMIT 5000"
export_table "email_templates"
export_table "email_log" "SELECT * FROM email_log ORDER BY id DESC LIMIT 1000"
export_table "contact_segments"
export_table "nurture_sequences"
export_table "nurture_steps"
export_table "nurture_enrollments"
export_table "journeys"
export_table "journey_steps"
export_table "journey_enrollments"

# AI
export_table "ai_agent_configs"
export_table "ai_chat_sessions"
export_table "ai_chat_messages" "SELECT * FROM ai_chat_messages ORDER BY id DESC LIMIT 1000"

# Platform
export_table "notifications" "SELECT * FROM notifications ORDER BY id DESC LIMIT 500"
export_table "notification_preferences"
export_table "channel_configs"
export_table "workflow_rules"
export_table "workflow_actions"
export_table "custom_fields"
export_table "custom_field_values"
export_table "currencies"
export_table "dashboard_layouts"
export_table "audit_log" "SELECT * FROM audit_log ORDER BY id DESC LIMIT 2000"
export_table "webhooks"
export_table "webhook_logs" "SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 500"
export_table "lead_scoring_rules"
export_table "lead_assignment_rules"
export_table "web_forms" "SELECT * FROM web_forms" 2>/dev/null || true
export_table "price_changes"
export_table "api_keys"
export_table "token_blacklist" "SELECT * FROM token_blacklist LIMIT 100"
export_table "crm_metadata"

unset PGPASSWORD

# Count exported files
echo ""
echo "═══════════════════════════════════════════════════"
echo "✅ Export complete!"
echo "   Files: $(ls $EXPORT_DIR/*.json 2>/dev/null | wc -l | tr -d ' ')"
echo "   Total size: $(du -sh $EXPORT_DIR | cut -f1)"
echo ""
echo "   Key counts:"
for f in companies contacts deals leads tasks tickets; do
  COUNT=$(cat "$EXPORT_DIR/${f}.json" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if d else 0)" 2>/dev/null || echo "?")
  echo "   - $f: $COUNT"
done
echo "═══════════════════════════════════════════════════"
echo ""
echo "Next: Run 'npx tsx scripts/import-v1.ts' to import into v2 database"
