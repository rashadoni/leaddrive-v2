import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const title = '      - name: Fund shadow restricted-login PostgreSQL transaction gate'

test('both required PR verification and production release run the real Fund shadow PG gate', () => {
  for (const workflow of ['pr-checks', 'deploy']) {
    const source = readFileSync(new URL(`.github/workflows/${workflow}.yml`, root), 'utf8')
    assert.equal(source.split(title).length, 2, `${workflow}: exactly one dedicated gate`)
    const start = source.indexOf(title)
    const next = source.indexOf('\n      - ', start + title.length)
    const step = source.slice(start, next === -1 ? undefined : next)
    assert.match(step, /run: npx vitest run src\/__tests__\/event-platform-fund-shadow-postgres\.test\.ts/)
    assert.match(step, /FUND_SHADOW_DB_GATE: required/)
    const target = workflow === 'deploy' ? '5432' : "${{ env.EVENT_PLATFORM_PG_PORT }}"
    assert.ok(step.includes(`FUND_SHADOW_TEST_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:${target}/event_platform_test`))
    const migration = source.indexOf('      - name: Event-platform migration and database invariant gate')
    assert.ok(migration >= 0 && migration < start, `${workflow}: actual migration gate must exist before the shadow gate`)
    assert.doesNotMatch(step, /\b(?:if|continue-on-error):|secrets\./)
    const unitTitle = '      - name: Fund exact reducer and shadow control-flow unit gate'
    assert.equal(source.split(unitTitle).length, 2, `${workflow}: explicit Fund unit gate must occur once`)
    const unitStart = source.indexOf(unitTitle)
    assert.ok(unitStart < start, `${workflow}: focused unit proof precedes real PG proof`)
    const unitStep = source.slice(unitStart, start)
    assert.match(unitStep, /run: npx vitest run src\/__tests__\/event-platform-fund-balance-reducer\.test\.ts src\/__tests__\/event-platform-fund-shadow-consumer\.test\.ts/)
    for (const testFile of ['event-platform-partition-processor', 'event-platform-fund-shadow-worker', 'event-platform-kafka-bridge',
      'event-platform-worker-process', 'event-platform-worker-session', 'event-platform-worker-admission', 'event-platform-worker-artifact']) {
      assert.ok(unitStep.includes(`src/__tests__/${testFile}.test.ts`), `${workflow}: ${testFile} must execute`)
    }
    assert.doesNotMatch(unitStep, /\b(?:if|continue-on-error):|secrets\./)
  }
})

test('real PG gate fails closed on missing admission and applies actual migrations, not mocks/db-push', () => {
  const source = readFileSync(new URL('src/__tests__/event-platform-fund-shadow-postgres.test.ts', root), 'utf8')
  const fixture = readFileSync(new URL('src/__tests__/fixtures/fund-shadow-postgres.ts', root), 'utf8')
  assert.match(source, /!adminUrl && process\.env\.FUND_SHADOW_DB_GATE === "required"/)
  assert.match(source, /from "\.\/fixtures\/fund-shadow-postgres"/)
  assert.match(source, /fundShadowDatabase as database/)
  assert.match(source, /postgres = createFundShadowPostgresFixture\(/)
  assert.match(source, /await postgres\.setup\(\)/)
  for (const migration of ['20260901090000_event_platform_foundation', '20260901100000_fund_event_source_pilot', '20260906120000_projection_replay_control_plane']) {
    assert.ok(fixture.includes(`"${migration}"`))
  }
  assert.match(fixture, /await client\.\$transaction\(async real/)
  assert.doesNotMatch(source + fixture, /vi\.mock\(|\["db", "push"/)
  assert.ok(fixture.includes('url.hostname !== "127.0.0.1"'))
  assert.ok(fixture.includes('url.pathname !== "/event_platform_test"'))
})

test('combined broker proof requires actual generated types and SQL before its sequential drill', () => {
  const workflow = readFileSync(new URL('.github/workflows/event-platform-broker.yml', root), 'utf8')
  const stack = readFileSync(new URL('scripts/event-platform/test-stack.sh', root), 'utf8')
  const drill = readFileSync(new URL('scripts/event-platform/test-broker-postgres.ts', root), 'utf8')
  const ordered = [
    'run: npx prisma generate --schema prisma/schema.prisma',
    'npx tsc --noEmit --skipLibCheck --strict',
    'run: npx vitest run src/__tests__/event-platform-fund-shadow-fixture.test.ts',
    'run: node scripts/ci/test-event-platform-migrations.mjs',
    'run: bash scripts/event-platform/test-stack.sh',
  ].map(required => { const index = workflow.indexOf(required); assert.ok(index >= 0, required); return index })
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b))
  // The actual Next ambient ProcessEnv contract requires NODE_ENV. Checking
  // only Node types would miss subprocess-environment errors in these tests.
  const strictStep = workflow.slice(ordered[1], workflow.indexOf('\n      - name:', ordered[1]))
  assert.match(strictStep, /node_modules\/next\/types\/global\.d\.ts/)
  assert.match(workflow, /LD_EVENT_STACK_COMBINED: '1'/)
  assert.match(workflow, /FUND_SHADOW_DB_GATE: required/)
  assert.match(workflow, /src\/__tests__\/fixtures\/fund-shadow-postgres\.ts/)
  assert.match(workflow, /image: postgres:16\.13-alpine@sha256:[a-f0-9]{64}/)
  assert.match(workflow, /--memory 512m --memory-swap 512m --cpus 1/)
  assert.match(workflow, /group: event-platform-disposable-integration/)
  assert.doesNotMatch(workflow, /continue-on-error:|secrets\./)
  assert.ok(stack.indexOf('"$task_root/scripts/event-platform/test-broker-driver.ts"')
    < stack.indexOf('"$task_root/scripts/event-platform/test-broker-postgres.ts"'))
  for (const contract of ['createFundShadowPostgresFixture(', 'await db.setup()', 'startKafkaWorkerSession(',
    'createFundShadowPartitionWorker(', 'fundShadowDatabase(context.client)']) {
    assert.ok(drill.includes(contract), contract)
  }
  assert.match(drill, /from "\.\.\/\.\.\/src\/__tests__\/fixtures\/fund-shadow-postgres"/)
  for (const [name, value] of [['GITHUB_ACTIONS', 'true'], ['LD_EVENT_STACK_DISPOSABLE', '1'],
    ['LD_EVENT_STACK_COMBINED', '1'], ['FUND_SHADOW_DB_GATE', 'required']]) {
    assert.ok(drill.includes(`assert.equal(process.env.${name}, "${value}")`), `combined admission: ${name}`)
  }
  // Broker cleanup failure cannot prevent the independent SQL cleanup attempt.
  assert.match(drill, /await Promise\.allSettled\(\[db\.close\(\)\]\)/)
  assert.doesNotMatch(drill, /vi\.mock\(|mockResolvedValue|\bdb push\b/)
  // Pipe cleanup must not replace real membership-fencing evidence with a
  // generic failure, timeout or host-side signal. Keep precise safe phases.
  assert.ok(drill.includes('phase = "takeover-assert-old-exit"'))
  assert.ok(drill.includes('phase = "takeover-wait-replacement-commit"'))
  assert.ok(drill.includes('assert.equal(old.child.exitCode, 1); assert.equal(old.child.signalCode, null)'))
  assert.ok(drill.includes('assert.equal(oldAck, 1); assert.equal(oldAckWritten, 1)'))
  assert.ok(drill.includes('Date.now() - old.recordReceivedAt < 60_000'))
  assert.match(drill, /catch \{ throw new Error\(`broker_postgres_phase=\$\{phase\}`\) \}/)
  const session = readFileSync(new URL('src/lib/event-platform/worker-session.ts', root), 'utf8')
  assert.match(session, /await runKafkaBridge\(/)
  for (const marker of ['broker_postgres_stop_after_commit_restart=PASS', 'broker_postgres_stop_during_commit_restart=PASS',
    'assert.equal(ackAttempts, 0); assert.equal(cursor(test), test.start)', 'assert.equal(observed[0].offset, test.start)',
    'assert.equal(released, false', 'assert.equal(released, true']) assert.ok(drill.includes(marker), marker)
  for (const name of ['worker-process', 'worker-session', 'worker-admission', 'worker-artifact']) {
    assert.ok(workflow.includes(`src/__tests__/event-platform-${name}.test.ts`))
  }
  for (const marker of ['worker_jvm_ordered_restart_exact_parity=PASS', 'worker_jvm_stop_after_commit_restart=PASS',
    'worker_jvm_stop_during_commit_restart=PASS', 'await first.exited', 'await second.exited']) assert.ok(drill.includes(marker), marker)
  const harness = readFileSync(new URL('scripts/event-platform/fixtures/kafka-broker-harness.ts', root), 'utf8')
  for (const contract of ['verifyKafkaWorkerArtifact(', 'validateKafkaWorkerPlan(', 'createSupervisedKafkaChannel(',
    'verified.classpath.join(":")', 'plan', '-Djdk.net.hosts.file=']) assert.ok(harness.includes(contract), contract)
})

test('full CDC Fund proof is an isolated required-SQL phase after existing CDC, never an activation route', () => {
  const workflow = readFileSync(new URL('.github/workflows/event-platform-cdc.yml', root), 'utf8')
  const stack = readFileSync(new URL('scripts/event-platform/test-stack.sh', root), 'utf8')
  const proof = readFileSync(new URL('scripts/event-platform/test-cdc-fund-postgres.ts', root), 'utf8')
  const full = workflow.slice(workflow.indexOf('  full-cdc-fund:'))
  for (const required of ['needs: cdc-smoke', 'group: event-platform-disposable-integration', 'cancel-in-progress: false',
    "LD_EVENT_STACK_FULL_CDC_FUND: '1'", 'FUND_SHADOW_DB_GATE: required', 'npx prisma generate --schema prisma/schema.prisma',
    '--strict --target ES2017', 'node_modules/next/types/global.d.ts', 'test-cdc-fund-postgres.ts',
    'test-cdc-fund-postgres.test.mjs', 'if: always()', 'down --volumes --remove-orphans --timeout 10']) {
    assert.ok(full.includes(required), required)
  }
  assert.doesNotMatch(full, /continue-on-error:|secrets\.|leaddrive-prod|workflow_dispatch:/)
  assert.ok(stack.includes('full CDC Fund requires its own isolated required-database phase'))
  assert.ok(stack.includes('"$task_root/scripts/event-platform/test-cdc-fund-postgres.ts"'))
  for (const required of ['sourceAppWrites: true', 'await db.newBuild(', 'corrected_new_build_recovery=PASS',
    'old_bad_builds_and_group_preserved=PASS', 'production_activation=NOT_RUN']) assert.ok(proof.includes(required), required)
})
