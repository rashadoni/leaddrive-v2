#!/bin/bash
# ═══════════════════════════════════════════════════
# LeadDrive CRM v1 → v2 Data Export (via SSH)
# Run on Mac: bash scripts/export-v1-ssh.sh
# Uses SSH to run psql DIRECTLY on the server
# This is the most reliable method!
# ═══════════════════════════════════════════════════

V1_HOST="${V1_HOST:?Set V1_HOST env var}"
V1_SSH_USER="${V1_SSH_USER:-root}"
V1_DB="${V1_DB:?Set V1_DB env var}"
V1_DB_USER="${V1_DB_USER:?Set V1_DB_USER env var}"
V1_DB_PASS="${V1_DB_PASS:?Set V1_DB_PASS env var}"

EXPORT_DIR="./scripts/v1-data"

mkdir -p "$EXPORT_DIR"

echo "🔄 LeadDrive CRM v1 Data Export (SSH Mode)"
echo "   Server: $V1_HOST (via SSH)"
echo ""

SUCCESS=0
FAILED=0

# Function: run psql on remote server via SSH, save JSON locally
export_table_ssh() {
  local table=$1
  local query=${2:-"SELECT * FROM $table"}
  echo -n "  📦 $table... "

  RESULT=$(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no \
    "$V1_SSH_USER@$V1_HOST" \
    "PGPASSWORD='$V1_DB_PASS' psql -h localhost -U $V1_DB_USER -d $V1_DB -t -A -c \"SELECT json_agg(t) FROM ($query) t\"" \
    2>/dev/null)

  if [ $? -eq 0 ] && [ -n "$RESULT" ] && [ "$RESULT" != "null" ]; then
    echo "$RESULT" > "$EXPORT_DIR/${table}.json"
    # Count records
    COUNT=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if d else 0)" 2>/dev/null || echo "?")
    echo "✅ ($COUNT records)"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "⚠️ Failed or empty"
    FAILED=$((FAILED + 1))
  fi
}

# ─── Test SSH connection first ───
echo "🔑 Testing SSH connection..."
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$V1_SSH_USER@$V1_HOST" "echo OK" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "❌ SSH connection failed!"
  echo ""
  echo "Make sure you can SSH to the server:"
  echo "  ssh $V1_SSH_USER@$V1_HOST"
  echo ""
  echo "If SSH user is different, edit V1_SSH_USER in this script"
  exit 1
fi
echo "  ✅ SSH OK"
echo ""

# ─── First, discover what tables exist ───
echo "🔍 Discovering tables..."
TABLES=$(ssh -o ConnectTimeout=10 "$V1_SSH_USER@$V1_HOST" \
  "PGPASSWORD='$V1_DB_PASS' psql -h localhost -U $V1_DB_USER -d $V1_DB -t -A -c \"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename\"" 2>/dev/null)

if [ -n "$TABLES" ]; then
  echo "$TABLES" > "$EXPORT_DIR/_tables.txt"
  TABLE_COUNT=$(echo "$TABLES" | wc -l | tr -d ' ')
  echo "  Found $TABLE_COUNT tables:"
  echo "$TABLES" | sed 's/^/    /'
  echo ""
fi

# ─── Export ALL discovered tables ───
echo "📤 Exporting all tables..."
echo ""

if [ -n "$TABLES" ]; then
  # Export every table that exists
  while IFS= read -r table; do
    [ -z "$table" ] && continue
    # Large tables get a LIMIT
    case "$table" in
      audit_log|email_log|webhook_logs|ai_chat_messages|token_blacklist)
        export_table_ssh "$table" "SELECT * FROM $table ORDER BY id DESC LIMIT 2000"
        ;;
      campaign_recipients|nurture_enrollments|journey_enrollments)
        export_table_ssh "$table" "SELECT * FROM $table LIMIT 5000"
        ;;
      *)
        export_table_ssh "$table"
        ;;
    esac
  done <<< "$TABLES"
else
  # Fallback: try known table names
  echo "  (Using known table names...)"
  export_table_ssh "companies"
  export_table_ssh "contacts"
  export_table_ssh "deals"
  export_table_ssh "leads"
  export_table_ssh "tasks"
  export_table_ssh "activities"
  export_table_ssh "contracts"
  export_table_ssh "offers"
  export_table_ssh "users"
  export_table_ssh "roles"
  export_table_ssh "pipeline_stages"
  export_table_ssh "overhead_costs"
  export_table_ssh "cost_employees"
  export_table_ssh "pricing_parameters"
  export_table_ssh "client_services"
  export_table_ssh "tickets"
  export_table_ssh "ticket_comments"
  export_table_ssh "sla_policies"
  export_table_ssh "kb_articles"
  export_table_ssh "kb_categories"
  export_table_ssh "campaigns"
  export_table_ssh "campaign_recipients" "SELECT * FROM campaign_recipients LIMIT 5000"
  export_table_ssh "email_templates"
  export_table_ssh "email_log" "SELECT * FROM email_log ORDER BY id DESC LIMIT 1000"
  export_table_ssh "contact_segments"
  export_table_ssh "nurture_sequences"
  export_table_ssh "nurture_steps"
  export_table_ssh "nurture_enrollments"
  export_table_ssh "journeys"
  export_table_ssh "journey_steps"
  export_table_ssh "journey_enrollments"
  export_table_ssh "ai_agent_configs"
  export_table_ssh "ai_chat_sessions"
  export_table_ssh "ai_chat_messages" "SELECT * FROM ai_chat_messages ORDER BY id DESC LIMIT 1000"
  export_table_ssh "notifications" "SELECT * FROM notifications ORDER BY id DESC LIMIT 500"
  export_table_ssh "notification_preferences"
  export_table_ssh "channel_configs"
  export_table_ssh "workflow_rules"
  export_table_ssh "workflow_actions"
  export_table_ssh "custom_fields"
  export_table_ssh "custom_field_values"
  export_table_ssh "currencies"
  export_table_ssh "dashboard_layouts"
  export_table_ssh "audit_log" "SELECT * FROM audit_log ORDER BY id DESC LIMIT 2000"
  export_table_ssh "webhooks"
  export_table_ssh "webhook_logs" "SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 500"
  export_table_ssh "lead_scoring_rules"
  export_table_ssh "lead_assignment_rules"
  export_table_ssh "price_changes"
  export_table_ssh "api_keys"
  export_table_ssh "token_blacklist" "SELECT * FROM token_blacklist LIMIT 100"
  export_table_ssh "crm_metadata"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "📊 Export Summary"
echo "   ✅ Success: $SUCCESS | ⚠️ Failed: $FAILED"
echo "   Files: $(ls $EXPORT_DIR/*.json 2>/dev/null | wc -l | tr -d ' ')"
echo "   Total size: $(du -sh $EXPORT_DIR 2>/dev/null | cut -f1)"
echo ""

# Show record counts for key tables
echo "   Key counts:"
for f in companies contacts deals leads tasks tickets users; do
  if [ -f "$EXPORT_DIR/${f}.json" ]; then
    COUNT=$(cat "$EXPORT_DIR/${f}.json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if d else 0)" 2>/dev/null || echo "?")
    echo "   - $f: $COUNT"
  fi
done

echo "═══════════════════════════════════════════════════"
echo ""
echo "Next: Run 'npx tsx scripts/import-v1.ts' to import into v2 database"
