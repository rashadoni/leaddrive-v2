#!/bin/bash
# ═══════════════════════════════════════════════════
# LeadDrive CRM v2 — One-Command Setup
# Run: bash setup.sh
# ═══════════════════════════════════════════════════

set -e

echo "🚀 LeadDrive CRM v2 — Setup"
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js required. Install: https://nodejs.org"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker required. Install: https://docker.com"; exit 1; }

# 1. Create .env from example
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ Created .env from .env.example"
  echo "⚠️  Edit .env and add your ANTHROPIC_API_KEY"
else
  echo "✅ .env already exists"
fi

# 2. Install npm dependencies
echo "📦 Installing dependencies..."
npm ci

# 3. Start Docker services (PostgreSQL + Redis)
echo "🐳 Starting Docker services..."
docker compose up -d db redis
sleep 3

# 4. Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# 5. Run database migrations
echo "📊 Running database migrations..."
npx prisma migrate dev --name init

# 6. Seed initial data
echo "🌱 Seeding database..."
npx tsx prisma/seed.ts

# 7. Start compute service
echo "🐍 Starting compute service..."
docker compose up -d compute
sleep 2

# 8. Start Next.js dev server
echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo ""
echo "  Next.js:  http://localhost:3000"
echo "  Compute:  http://localhost:8000"
echo "  Database: localhost:5432 (leaddrive/leaddrive)"
echo "  Redis:    localhost:6379"
echo ""
echo "  Login: see .env for credentials"
echo "═══════════════════════════════════════════════════"
echo ""

npm run dev
