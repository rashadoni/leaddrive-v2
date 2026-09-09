-- Fresh-install compatibility for the original MTM core. These tables and
-- enum types historically came from db push; subsequent migrations contain
-- only deltas (geofence, audit metadata, EXIF, soft-delete, analytics indexes).
DO $$ BEGIN CREATE TYPE "MtmCustomerCategory" AS ENUM ('A', 'B', 'C', 'D'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MtmCustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PROSPECT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MtmRouteStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MtmPointStatus" AS ENUM ('PENDING', 'VISITED', 'SKIPPED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MtmVisitStatus" AS ENUM ('CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MtmTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'OVERDUE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MtmTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MtmPhotoStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MtmAlertType" AS ENUM ('GPS_ANOMALY', 'LATE_START', 'MISSED_VISIT', 'LONG_BREAK', 'GPS_SPOOFING', 'OUT_OF_ZONE', 'LOW_BATTERY', 'OVERTIME'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MtmAlertCategory" AS ENUM ('WARNING', 'CRITICAL', 'INFO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "mtm_customers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "category" "MtmCustomerCategory" NOT NULL DEFAULT 'B',
    "status" "MtmCustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "address" TEXT,
    "city" TEXT,
    "district" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "contactPerson" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mtm_customers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "mtm_customers_organizationId_code_key" ON "mtm_customers"("organizationId", "code");
CREATE INDEX IF NOT EXISTS "mtm_customers_organizationId_idx" ON "mtm_customers"("organizationId");

CREATE TABLE IF NOT EXISTS "mtm_routes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT,
    "status" "MtmRouteStatus" NOT NULL DEFAULT 'PLANNED',
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "visitedPoints" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mtm_routes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_routes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_routes_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "mtm_routes_organizationId_idx" ON "mtm_routes"("organizationId");
CREATE INDEX IF NOT EXISTS "mtm_routes_agentId_idx" ON "mtm_routes"("agentId");
CREATE INDEX IF NOT EXISTS "mtm_routes_date_idx" ON "mtm_routes"("date");

CREATE TABLE IF NOT EXISTS "mtm_route_points" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "MtmPointStatus" NOT NULL DEFAULT 'PENDING',
    "plannedTime" TIMESTAMP(3),
    "visitedAt" TIMESTAMP(3),
    "notes" TEXT,
    CONSTRAINT "mtm_route_points_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_route_points_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "mtm_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_route_points_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "mtm_route_points_routeId_idx" ON "mtm_route_points"("routeId");
CREATE INDEX IF NOT EXISTS "mtm_route_points_customerId_idx" ON "mtm_route_points"("customerId");

CREATE TABLE IF NOT EXISTS "mtm_visits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "MtmVisitStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "checkInLat" DOUBLE PRECISION,
    "checkInLng" DOUBLE PRECISION,
    "checkOutLat" DOUBLE PRECISION,
    "checkOutLng" DOUBLE PRECISION,
    "duration" INTEGER,
    "notes" TEXT,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "tasksTotal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mtm_visits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_visits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_visits_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_visits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "mtm_visits_organizationId_idx" ON "mtm_visits"("organizationId");
CREATE INDEX IF NOT EXISTS "mtm_visits_agentId_idx" ON "mtm_visits"("agentId");
CREATE INDEX IF NOT EXISTS "mtm_visits_customerId_idx" ON "mtm_visits"("customerId");
CREATE INDEX IF NOT EXISTS "mtm_visits_checkInAt_idx" ON "mtm_visits"("checkInAt");

CREATE TABLE IF NOT EXISTS "mtm_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "customerId" TEXT,
    "visitId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "MtmTaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "MtmTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mtm_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_tasks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_tasks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "mtm_tasks_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "mtm_tasks_organizationId_idx" ON "mtm_tasks"("organizationId");
CREATE INDEX IF NOT EXISTS "mtm_tasks_agentId_idx" ON "mtm_tasks"("agentId");
CREATE INDEX IF NOT EXISTS "mtm_tasks_customerId_idx" ON "mtm_tasks"("customerId");
CREATE INDEX IF NOT EXISTS "mtm_tasks_visitId_idx" ON "mtm_tasks"("visitId");

CREATE TABLE IF NOT EXISTS "mtm_photos" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visitId" TEXT,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "category" TEXT,
    "status" "MtmPhotoStatus" NOT NULL DEFAULT 'PENDING',
    "hasWatermark" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "dislikes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mtm_photos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_photos_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_photos_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_photos_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "mtm_photos_organizationId_idx" ON "mtm_photos"("organizationId");
CREATE INDEX IF NOT EXISTS "mtm_photos_agentId_idx" ON "mtm_photos"("agentId");
CREATE INDEX IF NOT EXISTS "mtm_photos_visitId_idx" ON "mtm_photos"("visitId");

CREATE TABLE IF NOT EXISTS "mtm_alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "type" "MtmAlertType" NOT NULL,
    "category" "MtmAlertCategory" NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mtm_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_alerts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "mtm_alerts_organizationId_idx" ON "mtm_alerts"("organizationId");
CREATE INDEX IF NOT EXISTS "mtm_alerts_agentId_idx" ON "mtm_alerts"("agentId");
CREATE INDEX IF NOT EXISTS "mtm_alerts_createdAt_idx" ON "mtm_alerts"("createdAt");

CREATE TABLE IF NOT EXISTS "mtm_agent_locations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "battery" DOUBLE PRECISION,
    "isMoving" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mtm_agent_locations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_agent_locations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_agent_locations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "mtm_agent_locations_organizationId_idx" ON "mtm_agent_locations"("organizationId");
CREATE INDEX IF NOT EXISTS "mtm_agent_locations_agentId_idx" ON "mtm_agent_locations"("agentId");
CREATE INDEX IF NOT EXISTS "mtm_agent_locations_recordedAt_idx" ON "mtm_agent_locations"("recordedAt");

CREATE TABLE IF NOT EXISTS "mtm_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mtm_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "mtm_settings_organizationId_key_key" ON "mtm_settings"("organizationId", "key");

CREATE TABLE IF NOT EXISTS "mtm_notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "type" TEXT NOT NULL DEFAULT 'info',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mtm_notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_notifications_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "mtm_notifications_organizationId_idx" ON "mtm_notifications"("organizationId");
CREATE INDEX IF NOT EXISTS "mtm_notifications_agentId_idx" ON "mtm_notifications"("agentId");
CREATE INDEX IF NOT EXISTS "mtm_notifications_createdAt_idx" ON "mtm_notifications"("createdAt");

CREATE TABLE IF NOT EXISTS "mtm_audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldData" JSONB,
    "newData" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mtm_audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "mtm_audit_logs_organizationId_idx" ON "mtm_audit_logs"("organizationId");
CREATE INDEX IF NOT EXISTS "mtm_audit_logs_agentId_idx" ON "mtm_audit_logs"("agentId");
CREATE INDEX IF NOT EXISTS "mtm_audit_logs_createdAt_idx" ON "mtm_audit_logs"("createdAt");
