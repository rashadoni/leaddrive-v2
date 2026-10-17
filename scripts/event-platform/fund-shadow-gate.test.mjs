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
    assert.ok(source.indexOf('      - name: Event-platform migration and database invariant gate') < start)
    assert.doesNotMatch(step, /\b(?:if|continue-on-error):|secrets\./)
  }
})

test('real PG gate fails closed on missing admission and applies actual migrations, not mocks/db-push', () => {
  const source = readFileSync(new URL('src/__tests__/event-platform-fund-shadow-postgres.test.ts', root), 'utf8')
  assert.match(source, /!adminUrl && process\.env\.FUND_SHADOW_DB_GATE === "required"/)
  for (const migration of ['20260901090000_event_platform_foundation', '20260901100000_fund_event_source_pilot', '20260906120000_projection_replay_control_plane']) {
    assert.ok(source.includes(`"${migration}"`))
  }
  assert.match(source, /client\.\$transaction\(async real/)
  assert.doesNotMatch(source, /vi\.mock\(|\["db", "push"/)
  assert.ok(source.includes('url.hostname !== "127.0.0.1"'))
  assert.ok(source.includes('url.pathname !== "/event_platform_test"'))
})
