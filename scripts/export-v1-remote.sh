#!/bin/bash
# ═══════════════════════════════════════════════════
# LeadDrive CRM v1 → v2 Data Export (Remote Execution)
# Strategy: upload script to server, run there, download results
# Run on Mac: bash scripts/export-v1-remote.sh
# ═══════════════════════════════════════════════════

V1_HOST="${V1_HOST:?Set V1_HOST env var}"
V1_SSH_USER="${V1_SSH_USER:-root}"
V1_DB="${V1_DB:?Set V1_DB env var}"
V1_DB_USER="${V1_DB_USER:?Set V1_DB_USER env var}"
V1_DB_PASS="${V1_DB_PASS:?Set V1_DB_PASS env var}"

LOCAL_EXPORT_DIR="./scripts/v1-data"
REMOTE_EXPORT_DIR="/tmp/crm_export"

mkdir -p "$LOCAL_EXPORT_DIR"

echo "🔄 LeadDrive CRM v1 Data Export (Remote Mode)"
echo "   Server: $V1_HOST"
echo ""

# ─── Step 1: Create export script on server ───
echo "📝 Uploading export script to server..."

ssh -o StrictHostKeyChecking=no "$V1_SSH_USER@$V1_HOST" bash -s "$V1_DB_PASS" "$V1_DB_USER" "$V1_DB" << 'REMOTE_SCRIPT'
#!/bin/bash
export PGPASSWORD="$1"
DB_USER="$2"
DB_NAME="$3"
EXPORT_DIR="/tmp/crm_export"

rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

echo "🔍 Discovering tables..."
TABLES=$(psql -h localhost -U $DB_USER -d $DB_NAME -t -A -c \
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")

echo "$TABLES" > "$EXPORT_DIR/_tables.txt"
TABLE_COUNT=$(echo "$TABLES" | grep -c '.')
echo "   Found $TABLE_COUNT tables"

SUCCESS=0
FAILED=0

while IFS= read -r table; do
  [ -z "$table" ] && continue
  echo -n "  📦 $table... "

  # Use LIMIT for known large tables
  case "$table" in
    audit_log|email_log|webhook_logs|ai_chat_messages|token_blacklist)
      QUERY="SELECT * FROM \"$table\" ORDER BY id DESC LIMIT 2000"
      ;;
    campaign_recipients|nurture_enrollments|journey_enrollments|portal_notifications)
      QUERY="SELECT * FROM \"$table\" LIMIT 5000"
      ;;
    *)
      QUERY="SELECT * FROM \"$table\""
      ;;
  esac

  # Export to JSON file directly on server
  psql -h localhost -U $DB_USER -d $DB_NAME -t -A -c \
    "SELECT json_agg(t) FROM ($QUERY) t" > "$EXPORT_DIR/${table}.json" 2>/tmp/crm_export_err.log

  if [ $? -eq 0 ]; then
    # Check if file has actual data (not just "null" or empty)
    CONTENT=$(head -c 10 "$EXPORT_DIR/${table}.json")
    if [ "$CONTENT" = "" ] || [ "$CONTENT" = "null" ]; then
      echo "⏭️ empty"
      rm -f "$EXPORT_DIR/${table}.json"
    else
      SIZE=$(wc -c < "$EXPORT_DIR/${table}.json" | tr -d ' ')
      echo "✅ ($SIZE bytes)"
      SUCCESS=$((SUCCESS + 1))
    fi
  else
    echo "⚠️ Failed"
    cat /tmp/crm_export_err.log 2>/dev/null
    rm -f "$EXPORT_DIR/${table}.json"
    FAILED=$((FAILED + 1))
  fi
done <<< "$TABLES"

echo ""
echo "═══════════════════════════════════════"
echo "📊 Server Export Summary"
echo "   ✅ Success: $SUCCESS | ⚠️ Failed: $FAILED | ⏭️ Empty: $((TABLE_COUNT - SUCCESS - FAILED))"
echo "   Files: $(ls $EXPORT_DIR/*.json 2>/dev/null | wc -l)"
echo "   Total size: $(du -sh $EXPORT_DIR | cut -f1)"
echo "═══════════════════════════════════════"

# Create a tar for easy download
cd /tmp && tar czf crm_export.tar.gz crm_export/
echo ""
echo "📦 Archive ready: /tmp/crm_export.tar.gz ($(du -sh /tmp/crm_export.tar.gz | cut -f1))"
REMOTE_SCRIPT

if [ $? -ne 0 ]; then
  echo "❌ Remote script failed!"
  exit 1
fi

# ─── Step 2: Download results ───
echo ""
echo "⬇️  Downloading exported data..."
scp -o StrictHostKeyChecking=no "$V1_SSH_USER@$V1_HOST:/tmp/crm_export.tar.gz" "/tmp/crm_export.tar.gz"

if [ $? -ne 0 ]; then
  echo "❌ Download failed!"
  exit 1
fi

# ─── Step 3: Extract locally ───
echo "📂 Extracting..."
cd /tmp && tar xzf crm_export.tar.gz
cp -f /tmp/crm_export/*.json "$LOCAL_EXPORT_DIR/" 2>/dev/null
cp -f /tmp/crm_export/_tables.txt "$LOCAL_EXPORT_DIR/" 2>/dev/null

echo ""
echo "═══════════════════════════════════════════════════"
echo "✅ Export complete!"
echo "   Local directory: $LOCAL_EXPORT_DIR"
echo "   Files: $(ls $LOCAL_EXPORT_DIR/*.json 2>/dev/null | wc -l | tr -d ' ')"
echo "   Total size: $(du -sh $LOCAL_EXPORT_DIR | cut -f1)"
echo ""
echo "   Key counts:"
for f in companies contacts deals leads tasks tickets users; do
  if [ -f "$LOCAL_EXPORT_DIR/${f}.json" ]; then
    COUNT=$(cat "$LOCAL_EXPORT_DIR/${f}.json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if d else 0)" 2>/dev/null || echo "?")
    echo "   - $f: $COUNT"
  else
    echo "   - $f: (not exported)"
  fi
done
echo "═══════════════════════════════════════════════════"
echo ""
echo "Next: Run 'npx tsx scripts/import-v1.ts' to import into v2 database"
