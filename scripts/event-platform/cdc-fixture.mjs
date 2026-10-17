/**
 * Pure generators for the disposable CDC transport fixture. No I/O or runtime
 * activation belongs here. These events do not prove Fund command adoption,
 * replay safety, production TLS, or a business projection's correctness.
 *
 * Apply bootstrapSql() as the fixture DBA, then the COMPLETE unchanged
 * 20260901090000_event_platform_foundation migration as event_migrator.
 * Apply phaseSql() as event_app, not a superuser. The foundation owns all event
 * tables, RLS, grants, deferred coherence checks and PostgreSQL JSONB hashes.
 */

export const FIXTURE = Object.freeze({
  database: 'event_platform_test',
  hostname: 'postgres',
  adminRole: 'event_test',
  appRole: 'event_app',
  appPassword: 'event-app-password',
  migratorRole: 'event_migrator',
  migratorPassword: 'event-migrator-password',
  cdcRole: 'leaddrive_event_cdc',
  cdcPassword: 'synthetic-cdc-only',
  aggregateType: 'transport-fixture',
  aggregateId: 'same-logical-id',
  eventType: 'transport.fixture-recorded.v1',
  sourceTopic: 'leaddrive.domain.transport.v1',
})

export const FIXTURE_TENANTS = Object.freeze(['test-tenant-a', 'test-tenant-b'])
export const FIXTURE_PHASES = Object.freeze(['snapshot', 'stream', 'restart'])
export const CONNECTOR_MODES = Object.freeze(['expanded', 'raw'])
const versionsByPhase = Object.freeze({ snapshot: [1, 2], stream: [3], restart: [4] })

function assertConnectorMode(mode) {
  if (!CONNECTOR_MODES.includes(mode)) throw new RangeError(`Unknown CDC fixture connector mode: ${String(mode)}`)
}

/** Separate A/B topics prevent one converter's evidence contaminating another. */
export function fixtureKafkaTopic(mode) {
  assertConnectorMode(mode)
  return `ld.test${mode}.transport.events.v1`
}

/** PostgreSQL E-string literal, independent of standard_conforming_strings. */
export function sqlQuote(value) {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new TypeError('SQL fixture literals must be strings without NUL')
  }
  return `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

function uuid(kind, tenantIndex, version) {
  // Reversed suffixes make UUID order disagree with aggregateVersion order.
  // Distinct kinds also catch accidental use of outbox.id as the event ID.
  return `${kind}0000000-0000-4000-8000-${((tenantIndex + 1) * 1000 + 10 - version).toString(16).padStart(12, '0')}`
}

function assertPhase(phase) {
  if (!FIXTURE_PHASES.includes(phase)) throw new RangeError(`Unknown CDC fixture phase: ${String(phase)}`)
}

/** Fresh objects, in expected semantic order; snapshot SQL inserts in reverse. */
export function fixtureEvents(phase) {
  assertPhase(phase)
  return FIXTURE_TENANTS.flatMap((organizationId, tenantIndex) =>
    versionsByPhase[phase].map(aggregateVersion => {
      const eventId = uuid('1', tenantIndex, aggregateVersion)
      const outboxId = uuid('2', tenantIndex, aggregateVersion)
      const headId = uuid('3', tenantIndex, 0)
      const occurredAt = `2026-10-17T00:00:0${aggregateVersion}.000Z`
      const data = {
        fixture: 'synthetic-transport-only',
        version: aggregateVersion,
        nullable: null,
        disabled: false,
        zero: 0,
        text: "Привет — Bakı — 東京; O'Reilly \\ line\nnext",
        empty: [],
        nested: { empty: [], values: [0, 1], objects: [{ nullable: null, empty: [] }] },
      }
      const envelope = {
        specversion: '1.0',
        id: eventId,
        source: 'urn:leaddrive:synthetic-cdc-fixture',
        type: FIXTURE.eventType,
        time: occurredAt,
        datacontenttype: 'application/json',
        dataschema: 'urn:leaddrive:test:transport-fixture:v1',
        organizationid: organizationId,
        aggregatetype: FIXTURE.aggregateType,
        aggregateid: FIXTURE.aggregateId,
        aggregateversion: aggregateVersion,
        correlationid: `synthetic-${organizationId}`,
        producer: 'disposable-cdc-fixture',
        producerversion: 'fixture-v1',
        classification: 'internal',
        data,
      }
      return {
        eventId, outboxId, headId, organizationId,
        aggregateType: FIXTURE.aggregateType,
        aggregateId: FIXTURE.aggregateId,
        aggregateVersion,
        eventType: FIXTURE.eventType,
        occurredAt,
        topic: FIXTURE.sourceTopic,
        partitionKey: `${organizationId}:${FIXTURE.aggregateType}:${FIXTURE.aggregateId}`,
        envelope,
      }
    }))
}

export function bootstrapSql() {
  return `-- DISPOSABLE TRANSPORT TEST ONLY; passwords below are public fixture values.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $fixture_guard$
BEGIN
  IF current_database() <> ${sqlQuote(FIXTURE.database)}
     OR current_user <> ${sqlQuote(FIXTURE.adminRole)}
     OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'CDC fixture bootstrap requires the disposable test DBA/database';
  END IF;
  IF to_regclass('public.organizations') IS NOT NULL
     OR to_regclass('public.funds') IS NOT NULL
     OR to_regclass('public.event_outbox') IS NOT NULL THEN
    RAISE EXCEPTION 'CDC fixture bootstrap requires an empty disposable database';
  END IF;
END;
$fixture_guard$;
CREATE ROLE event_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD ${sqlQuote(FIXTURE.appPassword)};
CREATE ROLE event_migrator LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS
  PASSWORD ${sqlQuote(FIXTURE.migratorPassword)};
GRANT event_app TO event_migrator;
GRANT CONNECT ON DATABASE event_platform_test TO event_app;
GRANT CONNECT, CREATE ON DATABASE event_platform_test TO event_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO event_app, event_migrator;
SET LOCAL ROLE event_app;
CREATE TABLE public.organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
-- Ownership anchor ONLY: not the application Fund schema or a Fund write path.
CREATE TABLE public.funds (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES public.organizations(id)
);
INSERT INTO public.organizations (id, name) VALUES
  (${sqlQuote(FIXTURE_TENANTS[0])}, 'Synthetic tenant A'),
  (${sqlQuote(FIXTURE_TENANTS[1])}, 'Synthetic tenant B');
RESET ROLE;
COMMIT;
-- Apply the full foundation migration separately as event_migrator now.
`
}

function timestampSql(value) {
  return `(${sqlQuote(value)}::timestamptz AT TIME ZONE 'UTC')`
}

function eventInsertSql(event) {
  const e = event.envelope
  // Deliberately omit both payloadHash columns: the real foundation triggers
  // compute hashes from PostgreSQL JSONB text, NOT JSON.stringify bytes.
  return `INSERT INTO public.domain_events (
  "id", "organizationId", "aggregateType", "aggregateId", "aggregateVersion",
  "eventType", "eventVersion", "source", "dataSchema", "classification",
  "subjectRef", "correlationId", "causationId", "traceparent", "commandId",
  "producer", "producerVersion", "data", "occurredAt"
) VALUES (
  ${sqlQuote(event.eventId)}::uuid, ${sqlQuote(event.organizationId)}, ${sqlQuote(event.aggregateType)}, ${sqlQuote(event.aggregateId)}, ${event.aggregateVersion},
  ${sqlQuote(event.eventType)}, 1, ${sqlQuote(e.source)}, ${sqlQuote(e.dataschema)}, ${sqlQuote(e.classification)},
  NULL, ${sqlQuote(e.correlationid)}, NULL, NULL, NULL,
  ${sqlQuote(e.producer)}, ${sqlQuote(e.producerversion)}, ${sqlQuote(JSON.stringify(e.data))}::jsonb, ${timestampSql(event.occurredAt)}
);
INSERT INTO public.event_outbox (
  "id", "organizationId", "eventId", "eventType", "topic", "partitionKey", "envelope", "createdAt"
) VALUES (
  ${sqlQuote(event.outboxId)}::uuid, ${sqlQuote(event.organizationId)}, ${sqlQuote(event.eventId)}::uuid,
  ${sqlQuote(event.eventType)}, ${sqlQuote(event.topic)}, ${sqlQuote(event.partitionKey)},
  ${sqlQuote(JSON.stringify(e))}::jsonb, ${timestampSql(event.occurredAt)}
);
`
}

function headSql(last, phase) {
  if (phase === 'snapshot') {
    return `INSERT INTO public.event_aggregate_heads (
  "id", "organizationId", "aggregateType", "aggregateId", "currentVersion", "lastEventId", "lastEventAt"
) VALUES (
  ${sqlQuote(last.headId)}::uuid, ${sqlQuote(last.organizationId)}, ${sqlQuote(last.aggregateType)}, ${sqlQuote(last.aggregateId)},
  ${last.aggregateVersion}, ${sqlQuote(last.eventId)}::uuid, ${timestampSql(last.occurredAt)}
);
`
  }
  return `DO $fixture_advance$
DECLARE changed INTEGER;
BEGIN
  UPDATE public.event_aggregate_heads
     SET "currentVersion" = ${last.aggregateVersion},
         "lastEventId" = ${sqlQuote(last.eventId)}::uuid,
         "lastEventAt" = ${timestampSql(last.occurredAt)},
         "updatedAt" = ${timestampSql(last.occurredAt)}
   WHERE "id" = ${sqlQuote(last.headId)}::uuid
     AND "organizationId" = ${sqlQuote(last.organizationId)}
     AND "aggregateType" = ${sqlQuote(last.aggregateType)}
     AND "aggregateId" = ${sqlQuote(last.aggregateId)}
     AND "currentVersion" = ${last.aggregateVersion - 1};
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'CDC fixture phase requires exactly one preceding aggregate head';
  END IF;
END;
$fixture_advance$;
`
}

/**
 * snapshot: v1+v2/key, physically v2 before v1, one transaction per tenant.
 * stream: v3/key. restart: v4/key after Connect restart with its offsets intact.
 * Repeating or skipping a phase fails instead of silently ignoring duplicates.
 */
export function phaseSql(phase) {
  const events = fixtureEvents(phase)
  return `-- SYNTHETIC TRANSPORT ONLY: ${phase}; execute as event_app.\n` + FIXTURE_TENANTS.map(tenant => {
    const rows = events.filter(event => event.organizationId === tenant)
    const last = rows.at(-1)
    return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';
DO $fixture_guard$
BEGIN
  IF current_database() <> ${sqlQuote(FIXTURE.database)}
     OR current_user <> ${sqlQuote(FIXTURE.appRole)}
     OR (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'CDC fixture writes require the non-bypass test app role/database';
  END IF;
END;
$fixture_guard$;
SET LOCAL app.org_id = ${sqlQuote(tenant)};
${headSql(last, phase)}${[...rows].reverse().map(eventInsertSql).join('')}SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
`
  }).join('\n')
}

// Keys which a disposable test may change; all other template fields survive
// verbatim. Never use this renderer to create a production connector.
export const TEST_CONNECTOR_CONFIG_CHANGES = Object.freeze([
  'topic.prefix', 'database.hostname', 'database.dbname', 'database.user',
  'database.password', 'database.sslmode', 'database.sslrootcert', 'slot.name',
  'transforms.outbox.route.topic.replacement', 'transforms.outbox.table.expand.json.payload',
  'value.converter', 'value.converter.schemas.enable',
])

const expectedMutableTemplateValues = Object.freeze({
  'topic.prefix': 'ld.__ENV__.cdc-source',
  'database.hostname': '__PGHOST__',
  'database.dbname': '__PGDATABASE__',
  'database.user': 'leaddrive_event_cdc',
  'database.password': '__SECRET_FROM_PROVIDER__',
  'database.sslmode': 'verify-full',
  'database.sslrootcert': '__PG_SSL_ROOT_CERT_PATH__',
  'slot.name': 'leaddrive_event_outbox___ENV__',
  'transforms.outbox.route.topic.replacement': 'ld.__ENV__.$1.events.v1',
  'transforms.outbox.table.expand.json.payload': 'true',
  'value.converter': 'org.apache.kafka.connect.json.JsonConverter',
  'value.converter.schemas.enable': 'false',
})

export function renderTestConnector(template, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => key !== 'mode')) {
    throw new TypeError('Only a test connector mode option is allowed')
  }
  const mode = options.mode === undefined ? 'expanded' : options.mode
  assertConnectorMode(mode)
  if (!template || typeof template !== 'object' || Array.isArray(template)
      || template.name !== 'leaddrive-event-outbox-__ENV__'
      || !template.config || typeof template.config !== 'object' || Array.isArray(template.config)
      || Object.keys(template).some(key => !['name', 'config'].includes(key))
      || Object.values(template.config).some(value => typeof value !== 'string')) {
    throw new TypeError('Expected the checked-in event-outbox connector template')
  }
  for (const [key, expected] of Object.entries(expectedMutableTemplateValues)) {
    if (template.config[key] !== expected) throw new Error(`Connector template changed at ${key}; review the test override explicitly`)
  }
  const connector = structuredClone(template)
  connector.name = `leaddrive-event-outbox-test-${mode}`
  Object.assign(connector.config, {
    'topic.prefix': `ld.test.cdc-source-${mode}`,
    'database.hostname': FIXTURE.hostname,
    'database.dbname': FIXTURE.database,
    'database.user': FIXTURE.cdcRole,
    'database.password': FIXTURE.cdcPassword,
    'database.sslmode': 'disable',
    'slot.name': `leaddrive_event_outbox_test_${mode}`,
    'transforms.outbox.route.topic.replacement': `ld.test${mode}.$1.events.v1`,
  })
  delete connector.config['database.sslrootcert']
  if (mode === 'raw') {
    // A/B transport candidate only. StringConverter writes the existing JSON
    // text; it does not wrap it in a second JSON string or infer array schemas.
    connector.config['transforms.outbox.table.expand.json.payload'] = 'false'
    connector.config['value.converter'] = 'org.apache.kafka.connect.storage.StringConverter'
    delete connector.config['value.converter.schemas.enable']
  }
  for (const key of new Set([...Object.keys(template.config), ...Object.keys(connector.config)])) {
    if (template.config[key] !== connector.config[key] && !TEST_CONNECTOR_CONFIG_CHANGES.includes(key)) {
      throw new Error(`Disallowed test connector change: ${key}`)
    }
  }
  if (/__[A-Z_]+__/.test(JSON.stringify(connector))) throw new Error('Unresolved connector template placeholder')
  return connector
}
