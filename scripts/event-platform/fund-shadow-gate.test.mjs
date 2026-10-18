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
    for (const testFile of ['event-platform-partition-processor', 'event-platform-fund-shadow-worker', 'event-platform-kafka-bridge']) {
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
  assert.match(workflow, /LD_EVENT_STACK_COMBINED: '1'/)
  assert.match(workflow, /FUND_SHADOW_DB_GATE: required/)
  assert.match(workflow, /src\/__tests__\/fixtures\/fund-shadow-postgres\.ts/)
  assert.match(workflow, /image: postgres:16\.13-alpine@sha256:[a-f0-9]{64}/)
  assert.match(workflow, /--memory 512m --memory-swap 512m --cpus 1/)
  assert.match(workflow, /group: event-platform-disposable-integration/)
  assert.doesNotMatch(workflow, /continue-on-error:|secrets\./)
  assert.ok(stack.indexOf('"$task_root/scripts/event-platform/test-broker-driver.ts"')
    < stack.indexOf('"$task_root/scripts/event-platform/test-broker-postgres.ts"'))
  for (const contract of ['createFundShadowPostgresFixture(', 'await db.setup()', 'runKafkaBridge(',
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
})
