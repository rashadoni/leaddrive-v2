#!/bin/bash
# ═══════════════════════════════════════════════════════════
# LeadDrive CRM — Multi-Client Management
# Usage: bash scripts/client.sh <command> [client-name] [options]
# ═══════════════════════════════════════════════════════════
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REGISTRY="$PROJECT_DIR/clients/registry.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Helpers ───
die()  { echo -e "${RED}ERROR:${NC} $1" >&2; exit 1; }
info() { echo -e "${CYAN}→${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }

# Check jq is available
command -v jq &>/dev/null || die "jq is required: brew install jq"

# Check registry exists
[ -f "$REGISTRY" ] || die "Registry not found: $REGISTRY"

# Get client field from registry
get_client() {
  local name="$1" field="$2"
  jq -r ".clients.\"$name\".\"$field\" // empty" "$REGISTRY"
}

is_wildcard_bind_host() {
  case "$1" in
    "0.0.0.0"|"::"|"[::]"|"*") return 0 ;;
    *) return 1 ;;
  esac
}

get_bind_host() {
  local name="$1"
  local host=$(get_client "$name" "bindHost")
  [ -n "$host" ] || host="127.0.0.1"
  if is_wildcard_bind_host "$host"; then
    echo "Client '$name' bindHost=$host would expose the Next.js upstream directly" >&2
    return 1
  fi
  echo "$host"
}

# Get all client names
get_all_clients() {
  jq -r '.clients | keys[]' "$REGISTRY"
}

# Get active client names
get_active_clients() {
  jq -r '.clients | to_entries[] | select(.value.status == "active") | .key' "$REGISTRY"
}

# Validate client exists
require_client() {
  local name="$1"
  [ -n "$name" ] || die "Client name required"
  local server=$(get_client "$name" "server")
  [ -n "$server" ] || die "Client '$name' not found in registry"
}

# Build SSH command for client
ssh_cmd() {
  local name="$1"
  local user=$(get_client "$name" "sshUser")
  local server=$(get_client "$name" "server")
  local key=$(get_client "$name" "sshKey")
  if [ -n "$key" ]; then
    echo "ssh -i $key -o ConnectTimeout=15 ${user}@${server}"
  else
    echo "ssh -o ConnectTimeout=15 ${user}@${server}"
  fi
}

# ═══════════════════════════════════════════════════════════
# COMMANDS
# ═══════════════════════════════════════════════════════════

cmd_list() {
  echo -e "\n${BOLD}LeadDrive CRM — Client Registry${NC}\n"
  printf "%-12s %-20s %-22s %-25s %s\n" "ID" "NAME" "DOMAIN" "SERVER" "STATUS"
  printf "%-12s %-20s %-22s %-25s %s\n" "──────────" "──────────────────" "────────────────────" "───────────────────────" "──────"

  for name in $(get_all_clients); do
    local cname=$(get_client "$name" "name")
    local domain=$(get_client "$name" "domain")
    local server=$(get_client "$name" "server")
    local status=$(get_client "$name" "status")

    local status_color="$GREEN"
    [ "$status" = "inactive" ] && status_color="$RED"
    [ "$status" = "setup" ] && status_color="$YELLOW"

    printf "%-12s %-20s %-22s %-25s ${status_color}%s${NC}\n" \
      "$name" "$cname" "$domain" "$server" "$status"
  done
  echo ""
}

cmd_status() {
  echo -e "\n${BOLD}Server Status${NC}\n"

  for name in $(get_active_clients); do
    local domain=$(get_client "$name" "domain")
    local server=$(get_client "$name" "server")
    local port=$(get_client "$name" "port")
    local pm2name=$(get_client "$name" "pm2Name")
    local SSH=$(ssh_cmd "$name")

    printf "${CYAN}%-12s${NC} " "$name"

    # Ping server
    if ! $SSH "echo ok" &>/dev/null; then
      fail "SSH unreachable ($server)"
      continue
    fi

    # Check PM2
    local pm2_status=$($SSH "pm2 jlist 2>/dev/null | jq -r '.[] | select(.name==\"$pm2name\") | .pm2_env.status' 2>/dev/null" || echo "unknown")

    # Check HTTP
    local http_code=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://localhost:$port 2>/dev/null" || echo "000")

    if [ "$pm2_status" = "online" ] && [ "$http_code" = "200" -o "$http_code" = "307" ]; then
      ok "PM2: $pm2_status | HTTP: $http_code | $domain"
    elif [ "$pm2_status" = "online" ]; then
      warn "PM2: $pm2_status | HTTP: $http_code | $domain"
    else
      fail "PM2: $pm2_status | HTTP: $http_code | $domain"
    fi
  done
  echo ""
}

cmd_deploy() {
  die "Direct client deploy is retired. Merge reviewed code to main and use .github/workflows/deploy.yml; the workflow enforces the immutable artifact, backup, migration, tenant-isolation and event-platform gates."

  local name="$1"
  require_client "$name"

  local cname=$(get_client "$name" "name")
  local server=$(get_client "$name" "server")
  local domain=$(get_client "$name" "domain")
  local appdir=$(get_client "$name" "appDir")
  local port=$(get_client "$name" "port")
  local bind_host
  bind_host=$(get_bind_host "$name") || die "Invalid bind host for client '$name'"
  local pm2name=$(get_client "$name" "pm2Name")
  local SSH=$(ssh_cmd "$name")

  echo -e "\n${BOLD}Deploy → $cname ($domain)${NC}\n"

  # Step 1: Push
  info "[1/4] Pushing to GitHub..."
  git push origin main 2>&1 | tail -3
  ok "Pushed"

  # Step 2: Build on server
  info "[2/4] Building on $server..."
  $SSH "
    cd $appdir &&
    git pull origin main --quiet &&
    npx prisma generate 2>&1 | tail -1 &&
    npx prisma migrate deploy 2>&1 | tail -3 &&
    npx next build --webpack 2>&1 | tail -5
  " || { fail "Build failed!"; return 1; }
  ok "Build complete"

  # Step 3: Restart
  info "[3/4] Restarting PM2..."
  $SSH "
    cd $appdir &&
    pm2 delete $pm2name 2>/dev/null; true
    pm2 start 'npx next start -H $bind_host -p $port' --name $pm2name --cwd $appdir
    pm2 save
  " || { fail "PM2 restart failed!"; return 1; }
  ok "PM2 restarted"

  # Step 4: Health check
  info "[4/4] Health check..."
  sleep 8
  local http_code=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://localhost:$port" || echo "000")
  if [ "$http_code" = "200" ] || [ "$http_code" = "307" ]; then
    ok "HTTP $http_code — https://$domain"
  else
    fail "HTTP $http_code — check: $SSH 'pm2 logs $pm2name --lines 30'"
    return 1
  fi

  echo -e "\n${GREEN}✓ Deployed: https://$domain${NC}\n"
}

cmd_deploy_all() {
  die "Direct multi-client deploy is retired. Each verified production target needs its own reviewed GitHub Actions release route; do not build or restart applications from this host."

  echo -e "\n${BOLD}Deploy ALL active clients${NC}\n"

  # Pre-flight
  if ! git diff --quiet HEAD 2>/dev/null; then
    die "Uncommitted changes! Commit first."
  fi

  git push origin main 2>&1 | tail -3
  ok "Pushed to GitHub"

  local success=0
  local failed=0
  local results=""

  for name in $(get_active_clients); do
    local domain=$(get_client "$name" "domain")
    local server=$(get_client "$name" "server")
    local appdir=$(get_client "$name" "appDir")
    local port=$(get_client "$name" "port")
    local bind_host
    bind_host=$(get_bind_host "$name") || die "Invalid bind host for client '$name'"
    local pm2name=$(get_client "$name" "pm2Name")
    local SSH=$(ssh_cmd "$name")

    printf "${CYAN}%-12s${NC} " "$name"

    # Build + restart
    if $SSH "
      cd $appdir &&
      git pull origin main --quiet &&
      npx prisma generate >/dev/null 2>&1 &&
      npx prisma migrate deploy >/dev/null 2>&1 &&
      npx next build --webpack >/dev/null 2>&1 &&
      pm2 delete $pm2name 2>/dev/null; true &&
      pm2 start 'npx next start -H $bind_host -p $port' --name $pm2name --cwd $appdir >/dev/null 2>&1 &&
      pm2 save >/dev/null 2>&1
    " 2>/dev/null; then
      sleep 5
      local http_code=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://localhost:$port" 2>/dev/null || echo "000")
      if [ "$http_code" = "200" ] || [ "$http_code" = "307" ]; then
        ok "$domain (HTTP $http_code)"
        results+="${GREEN}✓${NC} $name — $domain\n"
        ((success++))
      else
        warn "$domain (HTTP $http_code — check logs)"
        results+="${YELLOW}⚠${NC} $name — $domain (HTTP $http_code)\n"
        ((failed++))
      fi
    else
      fail "$domain (build/deploy error)"
      results+="${RED}✗${NC} $name — $domain (FAILED)\n"
      ((failed++))
    fi
  done

  echo -e "\n${BOLD}═══ Summary ═══${NC}"
  echo -e "$results"
  echo -e "Total: ${GREEN}$success OK${NC}, ${RED}$failed FAILED${NC}"
  echo ""
}

cmd_logs() {
  local name="$1"
  local lines="${2:-30}"
  require_client "$name"

  local pm2name=$(get_client "$name" "pm2Name")
  local SSH=$(ssh_cmd "$name")

  echo -e "\n${BOLD}Logs: $name ($pm2name)${NC}\n"
  $SSH "pm2 logs $pm2name --lines $lines --nostream"
}

cmd_ssh() {
  local name="$1"
  require_client "$name"

  local user=$(get_client "$name" "sshUser")
  local server=$(get_client "$name" "server")
  local key=$(get_client "$name" "sshKey")
  local appdir=$(get_client "$name" "appDir")

  echo -e "${CYAN}Connecting to $name ($server)...${NC}"
  if [ -n "$key" ]; then
    ssh -i "$key" -t "${user}@${server}" "cd $appdir && exec \$SHELL -l"
  else
    ssh -t "${user}@${server}" "cd $appdir && exec \$SHELL -l"
  fi
}

cmd_create() {
  local name="$1"
  [ -n "$name" ] || die "Usage: client.sh create <name> --server=IP --domain=DOMAIN"

  # Check not exists
  local existing=$(get_client "$name" "server")
  [ -z "$existing" ] || die "Client '$name' already exists"

  # Parse options
  local server="" domain=""
  shift
  for arg in "$@"; do
    case "$arg" in
      --server=*) server="${arg#*=}" ;;
      --domain=*) domain="${arg#*=}" ;;
    esac
  done

  [ -n "$server" ] || die "Missing --server=IP"
  [ -n "$domain" ] || die "Missing --domain=DOMAIN"

  # Add to registry
  local tmp=$(mktemp)
  jq --arg name "$name" \
     --arg server "$server" \
     --arg domain "$domain" \
     '.clients[$name] = {
        "name": $name,
        "server": $server,
        "sshUser": "root",
        "sshKey": "~/.ssh/id_ed25519",
        "domain": $domain,
        "marketingDomain": "",
        "appDir": "/opt/leaddrive-v2",
        "port": 3001,
        "pm2Name": ("leaddrive-" + $name),
        "status": "setup",
        "notes": ""
      }' "$REGISTRY" > "$tmp"
  mv "$tmp" "$REGISTRY"
  ok "Added to registry"

  # Create client dir
  mkdir -p "$PROJECT_DIR/clients/$name"
  cp "$PROJECT_DIR/clients/leaddrive/.env.example" "$PROJECT_DIR/clients/$name/.env.example"
  ok "Created clients/$name/.env.example — fill in secrets"

  echo -e "\n${BOLD}Next steps for '$name':${NC}"
  echo "  1. Edit clients/registry.json — set name, marketingDomain, notes"
  echo "  2. Edit clients/$name/.env.example — fill in all secrets"
  echo "  3. Setup server:"
  echo "     ssh root@$server"
  echo "     # Install: Node.js 18+, PM2, PostgreSQL, Redis, Nginx"
  echo "     # Clone repo, copy .env, run prisma migrate"
  echo "  4. Setup Nginx: copy clients/nginx/template.conf"
  echo "  5. Setup SSL: certbot --nginx -d $domain"
  echo "  6. Update registry status to 'active'"
  echo "  7. Deploy: bash scripts/client.sh deploy $name"
  echo ""
}

cmd_help() {
  echo -e "\n${BOLD}LeadDrive CRM — Client Management${NC}\n"
  echo "Usage: bash scripts/client.sh <command> [args]"
  echo ""
  echo "Commands:"
  echo "  list                           Show all clients"
  echo "  status                         Check server health for all active clients"
  echo "  deploy <name>                  RETIRED — use reviewed GitHub Actions release"
  echo "  deploy-all                     RETIRED — no cross-target direct deploy"
  echo "  logs <name> [lines]            Show PM2 logs"
  echo "  ssh <name>                     Open SSH session"
  echo "  create <name> --server= --domain=   Add new client"
  echo "  help                           Show this help"
  echo ""
}

# ═══════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════

COMMAND="${1:-help}"
shift 2>/dev/null || true

case "$COMMAND" in
  list)       cmd_list ;;
  status)     cmd_status ;;
  deploy)     cmd_deploy "$@" ;;
  deploy-all) cmd_deploy_all ;;
  logs)       cmd_logs "$@" ;;
  ssh)        cmd_ssh "$@" ;;
  create)     cmd_create "$@" ;;
  help|--help|-h) cmd_help ;;
  *) die "Unknown command: $COMMAND (try 'help')" ;;
esac
