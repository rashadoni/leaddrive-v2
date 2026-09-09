#!/bin/bash
# ═══════════════════════════════════════════════════
# LeadDrive CRM v1 → v2 Data Export (via API)
# Run on Mac: bash scripts/export-v1-api.sh
# Uses v1 HTTP API instead of direct PostgreSQL
# ═══════════════════════════════════════════════════

V1_BASE="${V1_BASE:?Set V1_BASE env var (e.g. http://host:8000)}"
EXPORT_DIR="./scripts/v1-data"

mkdir -p "$EXPORT_DIR"

echo "🔄 LeadDrive CRM v1 Data Export (API Mode)"
echo "   Server: $V1_BASE"
echo ""

SUCCESS=0
FAILED=0
TOTAL=0

# Function to export via API endpoint
export_api() {
  local name=$1
  local endpoint=$2
  TOTAL=$((TOTAL + 1))
  echo -n "  📦 $name... "

  HTTP_CODE=$(curl -s -o "$EXPORT_DIR/${name}.json" -w "%{http_code}" \
    --max-time 30 "$V1_BASE$endpoint" 2>/dev/null)

  if [ "$HTTP_CODE" = "200" ]; then
    SIZE=$(wc -c < "$EXPORT_DIR/${name}.json" | tr -d ' ')
    echo "✅ ($SIZE bytes)"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "⚠️ HTTP $HTTP_CODE"
    rm -f "$EXPORT_DIR/${name}.json"
    FAILED=$((FAILED + 1))
  fi
}

# ─── Core CRM ───
export_api "companies" "/api/companies"
export_api "contacts" "/api/contacts"
export_api "deals" "/api/deals"
export_api "leads" "/api/leads"
export_api "tasks" "/api/tasks"
export_api "activities" "/api/activities"

# ─── Sales ───
export_api "contracts" "/api/contracts"
export_api "offers" "/api/offers"
export_api "pipeline_stages" "/api/pipeline/stages"

# ─── Cost Model ───
export_api "cost_employees" "/api/cost-model/employees"
export_api "overhead_costs" "/api/cost-model/overhead"
export_api "pricing_parameters" "/api/cost-model/pricing"
export_api "client_services" "/api/cost-model/client-services"

# ─── Support ───
export_api "tickets" "/api/tickets"
export_api "sla_policies" "/api/sla"
export_api "kb_categories" "/api/kb/categories"
export_api "kb_articles" "/api/kb/articles"

# ─── Marketing ───
export_api "campaigns" "/api/campaigns"
export_api "email_templates" "/api/email-templates"
export_api "contact_segments" "/api/segments"
export_api "nurture_sequences" "/api/nurture/sequences"
export_api "journeys" "/api/journeys"

# ─── AI ───
export_api "ai_agent_configs" "/api/ai/agents"
export_api "ai_chat_sessions" "/api/ai/sessions"

# ─── Platform ───
export_api "users" "/api/users"
export_api "notifications" "/api/notifications"
export_api "workflow_rules" "/api/workflows"
export_api "custom_fields" "/api/custom-fields"
export_api "currencies" "/api/currencies"
export_api "dashboard_layouts" "/api/dashboard/layouts"
export_api "webhooks" "/api/webhooks"
export_api "lead_scoring_rules" "/api/lead-scoring/rules"
export_api "audit_log" "/api/audit-log?limit=2000"
export_api "api_keys" "/api/api-keys"
export_api "crm_metadata" "/api/metadata"
export_api "channel_configs" "/api/channels"

# ─── Try alternative endpoints if main ones fail ───
# Some v1 endpoints might be at different paths
if [ ! -f "$EXPORT_DIR/companies.json" ]; then
  echo ""
  echo "🔄 Trying alternative endpoints..."
  export_api "companies" "/api/company"
  export_api "contacts" "/api/contact"
  export_api "deals" "/api/deal"
  export_api "leads" "/api/lead"
fi

# ─── Also try to discover all available endpoints ───
echo ""
echo "🔍 Discovering API structure..."
curl -s --max-time 10 "$V1_BASE/api/" > "$EXPORT_DIR/_api_root.json" 2>/dev/null
curl -s --max-time 10 "$V1_BASE/docs" > "$EXPORT_DIR/_api_docs.html" 2>/dev/null
curl -s --max-time 10 "$V1_BASE/openapi.json" > "$EXPORT_DIR/_openapi.json" 2>/dev/null

echo ""
echo "═══════════════════════════════════════════════════"
echo "📊 Export Summary"
echo "   Total: $TOTAL | ✅ Success: $SUCCESS | ⚠️ Failed: $FAILED"
echo "   Files: $(ls $EXPORT_DIR/*.json 2>/dev/null | wc -l | tr -d ' ')"
echo "   Total size: $(du -sh $EXPORT_DIR 2>/dev/null | cut -f1)"
echo "═══════════════════════════════════════════════════"

if [ $SUCCESS -eq 0 ]; then
  echo ""
  echo "❌ All exports failed!"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Check if server is running: curl $V1_BASE" # gitleaks:allow -- generated command example, no credential value
  echo "  2. Try the FastAPI docs: open $V1_BASE/docs"
  echo "  3. The API might require auth token. Try:"
  echo "     curl -H 'Authorization: Bearer YOUR_TOKEN' $V1_BASE/api/companies"
  echo ""
  echo "If API needs auth, login first:"
  echo "  curl -X POST $V1_BASE/api/auth/login \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"email\":\"admin@leaddrive.com\",\"password\":\"YOUR_PASSWORD\"}'"
fi
