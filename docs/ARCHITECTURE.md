# LeadDrive CRM v2 — Architecture

## What This Is

LeadDrive CRM v2 — полный переписал v1 (Python/FastAPI) на Next.js 16 + TypeScript + Prisma + PostgreSQL.
SaaS multi-tenant CRM для IT-аутсорсинговых компаний. Оператор и контролёр
данных: Fanumsec MMC, Баку, Азербайджан.

## Stack

- **Frontend**: Next.js 16 (App Router) + Tailwind CSS + shadcn/ui
- **Backend**: Next.js API Routes + Prisma ORM
- **Database**: PostgreSQL (local dev + production)
- **Auth**: NextAuth.js v5 (Credentials provider, JWT sessions)
- **Multi-tenant**: `organizationId` on every table, middleware injects from JWT
- **DB-level tenant isolation**: Postgres RLS (fail-closed). Rollout/rollback: `docs/rls-rollout-runbook.md`; design: `docs/superpowers/specs/2026-06-10-postgres-rls-tenant-isolation-design.md`
- **Event platform**: hybrid Kafka/event-sourcing architecture with an implemented PostgreSQL foundation and Finance Fund pilot. Kafka/Connect/Registry/archive assets are passive templates and are not currently activated. Status and operational boundaries: `docs/event-platform/README.md`.
- **Deployment**: shared Contabo production instance, PM2, Nginx reverse proxy;
  only immutable GitHub Actions artifacts may activate production

## Key Files

> Usually graphify (`graphify-out/wiki/`) is the better first stop. This is a fallback list.

- `prisma/schema.prisma` — 500+ models across core modules and industry clouds
- `src/lib/auth.ts` — NextAuth config with Prisma + bcrypt
- `src/lib/api-auth.ts` — `getOrgId` helper (header or session)
- `src/lib/prisma.ts` — Prisma singleton + `tenantPrisma`
- `src/lib/whatsapp.ts` — WhatsApp API client
- `src/lib/auto-assign.ts` — skill-based ticket routing
- `src/lib/email.ts` — email sending via nodemailer
- `src/middleware.ts` — auth guard + org context injection
- `src/app/layout.tsx` — root layout with SessionProvider
- `src/app/api/v1/webhooks/whatsapp/route.ts` — WhatsApp webhook + Da Vinci auto-reply
- `docs/social-monitoring-v2-architecture-plan.md` — целевая архитектура Social Monitoring, platform capabilities и порядок PR1→PR6
- `docs/SOCIAL-MONITORING-CLIENT-READINESS.md` — обязательные gates, CR-0→CR-9 и prompt для доведения Social Monitoring до платного пилота
- `docs/event-platform/README.md` — Kafka/event-sourcing decision, module catalog, canonical event envelope, and projection-recovery runbook
- `scripts/import-v1.ts` — v1→v2 data import (29 sections)
- `scripts/create-admin.ts` — creates admin user
- `.github/workflows/deploy.yml` + `scripts/server-deploy.sh` — supported
  SHA-bound production release and fail-closed server cutover
- `scripts/deploy.sh` + `scripts/server-build-deploy.sh` — retired on-host
  deployment/build tombstones (always fail)

## Dev Commands

```bash
# Local dev
npx next dev

# Prisma
npx prisma migrate dev --name <name>
npx prisma generate
npx prisma studio

# Import v1 data
ADMIN_PASSWORD='<secret-managed-strong-password>' npx tsx scripts/import-v1.ts
# A non-local target additionally requires CONFIRM_PROD=import-v1:leaddrive.
# Imported v1 principals are disabled with reset credentials; only the explicit
# admin account is activated with ADMIN_PASSWORD.
npx tsx scripts/create-admin.ts
```

## Testing

134 tests in 11 files (Vitest) — rate-limit, webhooks, auto-assign, workflow-engine.

## Environment Variables

See `.env.example` for the full list. Credentials live in `.env` files and memory, never in version control.
