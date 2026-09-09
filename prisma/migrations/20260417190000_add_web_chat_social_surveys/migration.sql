-- Web Chat Widget (§4) + Social Monitoring (§5) + Surveys/NPS (§8)

-- ─────────────────────────────────────────────────────────────
-- WEB CHAT WIDGET
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "web_chat_widgets" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE CASCADE,
  "enabled"         BOOLEAN NOT NULL DEFAULT true,
  "publicKey"       TEXT NOT NULL UNIQUE,
  "title"           TEXT NOT NULL DEFAULT 'Support',
  "greeting"        TEXT NOT NULL DEFAULT 'Hi! How can we help?',
  "primaryColor"    TEXT NOT NULL DEFAULT '#0176D3',
  "position"        TEXT NOT NULL DEFAULT 'bottom-right',
  "showLauncher"    BOOLEAN NOT NULL DEFAULT true,
  "aiEnabled"       BOOLEAN NOT NULL DEFAULT true,
  "escalateToTicket" BOOLEAN NOT NULL DEFAULT true,
  "allowedOrigins"  TEXT[] NOT NULL DEFAULT '{}',
  "workingHours"    JSONB,
  "offlineMessage"  TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "web_chat_widgets_publicKey_idx" ON "web_chat_widgets"("publicKey");

CREATE TABLE IF NOT EXISTS "web_chat_sessions" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "visitorName"     TEXT,
  "visitorEmail"    TEXT,
  "visitorPhone"    TEXT,
  "pageUrl"         TEXT,
  "userAgent"       TEXT,
  "ipAddress"       TEXT,
  "status"          TEXT NOT NULL DEFAULT 'open',
  "ticketId"        TEXT,
  "assignedUserId"  TEXT,
  "lastMessageAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "web_chat_sessions_org_idx" ON "web_chat_sessions"("organizationId");
CREATE INDEX IF NOT EXISTS "web_chat_sessions_org_status_idx" ON "web_chat_sessions"("organizationId","status");
CREATE INDEX IF NOT EXISTS "web_chat_sessions_org_lastMsg_idx" ON "web_chat_sessions"("organizationId","lastMessageAt");

CREATE TABLE IF NOT EXISTS "web_chat_messages" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "sessionId"       TEXT NOT NULL REFERENCES "web_chat_sessions"("id") ON DELETE CASCADE,
  "fromRole"        TEXT NOT NULL,
  "authorUserId"    TEXT,
  "text"            TEXT NOT NULL,
  "metadata"        JSONB,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "web_chat_messages_session_created_idx" ON "web_chat_messages"("sessionId","createdAt");
CREATE INDEX IF NOT EXISTS "web_chat_messages_org_idx" ON "web_chat_messages"("organizationId");

-- ─────────────────────────────────────────────────────────────
-- SOCIAL MONITORING (social_conversations table already exists)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "social_accounts" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "platform"        TEXT NOT NULL,
  "handle"          TEXT NOT NULL,
  "displayName"     TEXT,
  "accessToken"     TEXT,
  "tokenExpiresAt"  TIMESTAMP(3),
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "keywords"        TEXT[] NOT NULL DEFAULT '{}',
  "lastPolledAt"    TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organizationId","platform","handle")
);
CREATE INDEX IF NOT EXISTS "social_accounts_org_platform_idx" ON "social_accounts"("organizationId","platform");

CREATE TABLE IF NOT EXISTS "social_mentions" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "accountId"       TEXT REFERENCES "social_accounts"("id") ON DELETE SET NULL,
  "platform"        TEXT NOT NULL,
  "externalId"      TEXT NOT NULL,
  "authorName"      TEXT,
  "authorHandle"    TEXT,
  "authorAvatar"    TEXT,
  "text"            TEXT NOT NULL,
  "url"             TEXT,
  "sentiment"       TEXT,
  "matchedTerm"     TEXT,
  "reach"           INTEGER NOT NULL DEFAULT 0,
  "engagement"      INTEGER NOT NULL DEFAULT 0,
  "status"          TEXT NOT NULL DEFAULT 'new',
  "ticketId"        TEXT,
  "handledBy"       TEXT,
  "handledAt"       TIMESTAMP(3),
  "publishedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organizationId","platform","externalId")
);
CREATE INDEX IF NOT EXISTS "social_mentions_org_status_idx" ON "social_mentions"("organizationId","status");
CREATE INDEX IF NOT EXISTS "social_mentions_org_platform_published_idx" ON "social_mentions"("organizationId","platform","publishedAt");
CREATE INDEX IF NOT EXISTS "social_mentions_org_sentiment_idx" ON "social_mentions"("organizationId","sentiment");

-- ─────────────────────────────────────────────────────────────
-- SURVEYS / NPS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "surveys" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "type"            TEXT NOT NULL DEFAULT 'nps',
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "publicSlug"      TEXT NOT NULL UNIQUE,
  "thankYouText"    TEXT NOT NULL DEFAULT 'Thank you for your feedback!',
  "questions"       JSONB NOT NULL DEFAULT '[]',
  "triggers"        JSONB NOT NULL DEFAULT '{}',
  "channels"        TEXT[] NOT NULL DEFAULT '{}',
  "totalSent"       INTEGER NOT NULL DEFAULT 0,
  "totalResponses"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "surveys_org_status_idx" ON "surveys"("organizationId","status");

CREATE TABLE IF NOT EXISTS "survey_responses" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "surveyId"        TEXT NOT NULL REFERENCES "surveys"("id") ON DELETE CASCADE,
  "contactId"       TEXT,
  "ticketId"        TEXT,
  "email"           TEXT,
  "phone"           TEXT,
  "score"           INTEGER,
  "category"        TEXT,
  "answers"         JSONB NOT NULL DEFAULT '{}',
  "comment"         TEXT,
  "channel"         TEXT,
  "completedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress"       TEXT
);
CREATE INDEX IF NOT EXISTS "survey_responses_org_survey_idx" ON "survey_responses"("organizationId","surveyId");
CREATE INDEX IF NOT EXISTS "survey_responses_org_completed_idx" ON "survey_responses"("organizationId","completedAt");
CREATE INDEX IF NOT EXISTS "survey_responses_survey_category_idx" ON "survey_responses"("surveyId","category");
