/**
 * The boards end to end, in a real browser against a real app and database,
 * on a fictional copy of Zeytun's set-up (owner, 2026-11-08: «полный тест от
 * А до Я … по доступам, по задачам, по дедлайнам»).
 *
 * Runs ONLY in GitHub Actions on an empty disposable Postgres
 * (.github/workflows/boards-e2e.yml): never against production, never with a
 * real person's account. Every person and password here is made up on the spot.
 *
 *   node scripts/boards-browser-evidence.mjs prepare   restricted app role + tenant RLS
 *   node scripts/boards-browser-evidence.mjs           seed, log in each role, run the scenarios
 *
 * The copy: three folders (Digital Marketing, Traditional Marketing,
 * Cust-Serv / 2026) with boards inside, columns New task / In progress /
 * Completed, and the people Zeytun has — admin, a manager, marketers on both
 * marketing folders (one granted before members could finish tasks), a
 * Cust-Serv clerk, a marketer who has the boards and nothing else, a viewer —
 * plus a second organization whose board must stay out of reach, and a third
 * that bought the boards without CRM (2026-11-08: boards a tenant module of
 * their own) — its boards work, its CRM stays closed.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { chromium } from 'playwright'
import { makeRlsTestPrisma } from './_rls.mjs'

const DATABASE = 'boards_e2e'
const ROLE = 'boards_e2e'
const OUT = process.env.BOARDS_E2E_OUTPUT || 'artifacts/boards-e2e'

function guard() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'GitHub Actions only')
  assert.equal(process.env.CI, 'true')
  assert.equal(process.env.BOARDS_E2E, '1')
  assert.notEqual(process.env.NODE_ENV, 'production')
  const [admin, app] = [process.env.ADMIN_DATABASE_URL, process.env.DATABASE_URL].map((value) => new URL(value))
  for (const url of [admin, app]) {
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'loopback database only')
    assert.equal(url.pathname, `/${DATABASE}`)
  }
  assert.equal(admin.username, 'postgres')
  assert.equal(app.username, ROLE)
  assert.equal(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, admin.href)
  return { adminURL: admin.href, appURL: app.href }
}

function prepare() {
  const { adminURL } = guard()
  const sql = (value) => execFileSync('psql', [adminURL, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: value, stdio: ['pipe', 'pipe', 'pipe'] })
  sql(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM organizations) THEN RAISE EXCEPTION 'boards fixture must be empty'; END IF; END $$;`)
  const password = process.env.BOARDS_E2E_DATABASE_PASSWORD
  assert.match(password ?? '', /^[a-f0-9]{48}$/)
  // The app connects as a plain role, so every tenant table answers only for
  // the organization the request set — as in production.
  sql(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
    GRANT CONNECT ON DATABASE ${DATABASE} TO ${ROLE}; GRANT USAGE ON SCHEMA public TO ${ROLE};
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE};
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE};
    DO $$ DECLARE t record; BEGIN FOR t IN SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND a.attname='organizationId' AND NOT a.attisdropped AND NOT c.relrowsecurity LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.relname);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t.relname);
      EXECUTE format('CREATE POLICY boards_e2e_tenant ON public.%I USING ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'') WITH CHECK ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'')',t.relname);
    END LOOP; END $$;`)
}

// Everything a person can be given, minus the boards: someone with the boards only.
const ALL_BUT_BOARDS = ['crm', 'sales', 'contracts', 'marketing', 'loyalty', 'omnichannel', 'social', 'voip', 'support', 'finance', 'analytics', 'mtm', 'health', 'insurance', 'public-sector', 'media', 'energy', 'workforce-hrm']
const OLD_MEMBER = { canView: true, canEdit: true, canCreateTask: true, canComment: true, canMoveToTodo: true, canMoveToInProgress: true, canMoveToTesting: true, canMoveToReview: true, canMoveBack: true }
const MEMBER = { ...OLD_MEMBER, canMoveToDone: true }

async function seed() {
  const { adminURL } = guard()
  const db = makeRlsTestPrisma(adminURL)
  await db.$executeRaw`SELECT set_config('app.rls_bypass', 'on', false)`
  const password = `Fixture!${randomUUID()}`
  const passwordHash = await bcrypt.hash(password, 4)
  const slug = `zeytun-e2e-${randomUUID().slice(0, 8)}`
  const org = await db.organization.create({ data: { name: 'Fictional Zeytun E2E', slug, plan: 'enterprise', modules: { crm: true }, settings: { fixtureOnly: true } } })
  const foreign = await db.organization.create({ data: { name: 'Fictional Foreign E2E', slug: `${slug}-foreign`, plan: 'enterprise', modules: { crm: true }, settings: { fixtureOnly: true } } })
  const boardsTenant = await db.organization.create({ data: { name: 'Fictional Boards-only Tenant E2E', slug: `${slug}-boards`, plan: 'starter', features: ['boards', 'settings'], modules: { boards: true, crm: false, sales: false, settings: true }, settings: { fixtureOnly: true } } })

  const users = {}
  const person = async (key, role, extra = {}, organizationId = org.id) => {
    users[key] = await db.user.create({ data: { organizationId, name: `Fixture ${key}`, email: `${key}-${slug}@example.invalid`, passwordHash, role, preferredLanguage: 'az', ...extra } })
  }
  await person('admin', 'admin')
  await person('manager', 'manager')
  await person('marketer', 'sales')
  await person('marketerOld', 'sales')
  await person('clerk', 'sales')
  await person('boardsOnly', 'sales', { hiddenModules: ALL_BUT_BOARDS })
  await person('viewer', 'viewer')
  await person('foreign', 'admin', {}, foreign.id)
  await person('boardsTenantAdmin', 'admin', {}, boardsTenant.id)

  const boards = {}
  const board = async (key, name, sortOrder, parent = null, organizationId = org.id) => {
    boards[key] = await db.division.create({ data: { organizationId, key, name, sortOrder, isDepartment: parent === 'department', parentDivisionId: parent && parent !== 'department' ? boards[parent].id : null } })
    if (parent !== 'department') {
      await db.boardColumn.createMany({ data: [['todo', 'New task'], ['in_progress', 'In progress'], ['done', 'Completed']].map(([stage, label], index) => (
        { organizationId, divisionId: boards[key].id, key: `c_${stage}`, label, sortOrder: index, mapsToStatus: stage })) })
    }
  }
  await board('DIGITAL', 'Digital Marketing', 10, 'department')
  await board('TRADITIONAL', 'Traditional Marketing', 20, 'department')
  await board('CUSTSERV', 'Cust-Serv / 2026', 30, 'department')
  await board('DZEYTUN', 'Zeytun', 1, 'DIGITAL')
  await board('DPHARMA', 'Pharmastore', 2, 'DIGITAL')
  await board('TZEYTUN', 'Zeytun', 1, 'TRADITIONAL')
  await board('MX2611', '11. NOYABR 26 MX', 11, 'CUSTSERV')
  await board('FOREIGN', 'Foreign board', 1, null, foreign.id)
  await board('SOLO', 'Solo board', 1, null, boardsTenant.id)

  const grant = (user, division, flags) => db.boardPermission.create({ data: { organizationId: org.id, userId: users[user].id, divisionId: boards[division].id, ...flags } })
  for (const folder of ['DIGITAL', 'TRADITIONAL']) {
    await grant('manager', folder, MEMBER)
    await grant('marketer', folder, MEMBER)
  }
  await grant('marketerOld', 'DIGITAL', OLD_MEMBER)
  await grant('clerk', 'CUSTSERV', MEMBER)
  await grant('boardsOnly', 'DIGITAL', MEMBER)

  const tasks = {}
  let n = 0
  const task = async (key, division, status, extra = {}) => {
    const organizationId = boards[division].organizationId
    n += 1
    tasks[key] = await db.task.create({ data: { organizationId, divisionId: boards[division].id, taskKey: `${division}-${n}`, title: `Fixture ${key}`, status,
      boardColumnKey: `c_${status}`, ...(status === 'done' ? { completedAt: new Date() } : {}), ...extra } })
  }
  await task('pharmaOpen', 'DPHARMA', 'todo', { dueDate: new Date('2026-11-13T19:59:59.000Z'), assignedTo: users.marketer.id })
  await task('pharmaWork', 'DPHARMA', 'in_progress', { assignedTo: users.marketerOld.id })
  await task('pharmaDone', 'DPHARMA', 'done')
  await task('zeytunOne', 'DZEYTUN', 'todo')
  await task('zeytunTwo', 'DZEYTUN', 'in_progress')
  await task('tradOne', 'TZEYTUN', 'todo')
  await task('mxOne', 'MX2611', 'todo')
  await task('mxTwo', 'MX2611', 'done')
  await task('foreignOne', 'FOREIGN', 'todo')
  await task('soloOne', 'SOLO', 'todo')
  await db.$disconnect()
  return { org, foreign, boardsTenant, slug, password, users, boards, tasks }
}

// ── scenarios ───────────────────────────────────────────────────────────────
const az = JSON.parse(readFileSync('messages/az.json', 'utf8'))
const results = []
let failed = 0
async function step(name, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) })
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error).slice(0, 600) })
    console.log(`FAIL ${name}\n     ${String(error?.message ?? error).slice(0, 600)}`)
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const origin = new URL(process.env.BOARDS_E2E_BASE_URL)
  const f = await seed()
  const browser = await chromium.launch()
  const sessions = {}

  async function login(key, slug = f.slug) {
    const context = await browser.newContext({ baseURL: origin.origin, viewport: { width: 1440, height: 1000 }, locale: 'az-AZ' })
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'az', url: origin.origin }])
    const { csrfToken } = await (await context.request.get('/api/auth/csrf', { timeout: 120000 })).json()
    const response = await context.request.post('/api/auth/callback/credentials', { timeout: 120000,
      headers: { 'X-Auth-Return-Redirect': '1' },
      form: { csrfToken, email: f.users[key].email, password: f.password, organizationSlug: slug, callbackUrl: `${origin.origin}/boards` } })
    assert.equal(response.status(), 200, `login ${key}`)
    assert.equal(new URL((await response.json()).url, origin).searchParams.get('error'), null, `login ${key} refused`)
    const session = await (await context.request.get('/api/auth/session')).json()
    assert.equal(session.user.id, f.users[key].id)
    sessions[key] = context
    return context
  }
  const api = async (key, path, { method = 'GET', body } = {}) => {
    const response = await sessions[key].request.fetch(path, { method, timeout: 120000, ...(body ? { data: body } : {}) })
    let json = null
    try { json = await response.json() } catch { /* not JSON */ }
    return { status: response.status(), json }
  }
  const openBoard = async (page, boardKey) => {
    await page.goto(`/boards/${f.boards[boardKey].id}`, { timeout: 180000 })
    await page.waitForFunction(() => /\d+ nəticə/.test(document.body.innerText) || document.body.innerText.includes('girişiniz yoxdur'), null, { timeout: 180000 })
  }
  const resultCount = async (page) => Number((/(\d+) nəticə/.exec(await page.innerText('body')) ?? [])[1])
  // The sidebar reads the board list on its own: wait for it, not just for the table.
  const folders = async (page) => {
    await page.waitForSelector('[data-testid="sidebar-board-folder-toggle"]', { timeout: 60000 })
    return page.$$eval('[data-testid="sidebar-board-folder-toggle"]', (els) => els.map((el) => el.textContent?.trim()))
  }

  await step('every role logs in with its own password', async () => {
    for (const key of ['admin', 'manager', 'marketer', 'marketerOld', 'clerk', 'boardsOnly', 'viewer']) await login(key)
    await login('foreign', `${f.slug}-foreign`)
    await login('boardsTenantAdmin', `${f.slug}-boards`)
    return { logins: 9 }
  })

  // Everyone but the manager has already been offered the Boards video, the
  // way the prompt itself records it — so its window does not stand over the
  // pages the other scenarios click. The manager meets it as a newcomer.
  for (const key of Object.keys(sessions)) {
    if (key === 'manager') continue
    const seen = await api(key, '/api/v1/users/me/preferences', { method: 'PUT', body: { helpVideoSeen: ['boards'] } })
    assert.equal(seen.status, 200, `${key}: ${JSON.stringify(seen.json)}`)
  }

  await step('first visit: the «watch the video?» window comes once, «Sonra» closes it for good', async () => {
    const page = await sessions.manager.newPage()
    await page.goto(`/boards/${f.boards.DPHARMA.id}`, { timeout: 180000 })
    await page.waitForSelector('[data-testid="help-video-first-visit"]', { timeout: 120000 })
    assert.match(await page.innerText('[data-testid="help-video-first-visit"]'), /ilk dəfəsiniz/)
    await page.click('[data-testid="help-video-first-visit-later"]')
    await page.waitForSelector('[data-testid="help-video-first-visit"]', { state: 'detached', timeout: 30000 })
    // The window saves without waiting for the answer; give the request time to land.
    let stored = []
    for (let i = 0; i < 30 && !stored.includes('boards'); i++) {
      if (i) await page.waitForTimeout(500)
      stored = (await api('manager', '/api/v1/users/me/preferences')).json?.data?.helpVideoSeen ?? []
    }
    assert.deepEqual(stored, ['boards'])
    await page.reload({ timeout: 180000 })
    await page.waitForFunction(() => /\d+ nəticə/.test(document.body.innerText), null, { timeout: 180000 })
    await page.waitForTimeout(3000)
    assert.equal(await page.$('[data-testid="help-video-first-visit"]'), null, 'offered again after a reload')
    await page.close()
    return { offered: 'once' }
  })

  const adminPage = await sessions.admin.newPage()
  await step('admin: a board opens as the table with its own tasks, folders in the sidebar, tabs out of the way', async () => {
    await openBoard(adminPage, 'DPHARMA')
    assert.equal(await resultCount(adminPage), 3)
    assert.deepEqual(await folders(adminPage), ['Digital Marketing', 'Traditional Marketing', 'Cust-Serv / 2026'])
    const tabs = await adminPage.$$eval('[data-board-tabs]', (els) => els.map((el) => getComputedStyle(el).display))
    assert.ok(tabs.every((display) => display === 'none'), `tabs shown: ${tabs}`)
    assert.ok(!(await adminPage.innerText('body')).includes('tasks.noTasks'))
  })
  await step('admin: another board of the folder is one click in the sidebar; a folder only folds', async () => {
    await adminPage.click(`[data-testid="sidebar-board-link"][href="/boards/${f.boards.DZEYTUN.id}"]`)
    await adminPage.waitForURL(`**/boards/${f.boards.DZEYTUN.id}`, { timeout: 120000 })
    await adminPage.waitForFunction(() => /2 nəticə/.test(document.body.innerText), null, { timeout: 120000 })
    const before = adminPage.url()
    const trad = adminPage.locator('[data-testid="sidebar-board-folder-toggle"]', { hasText: 'Traditional Marketing' })
    await trad.click()
    assert.equal(await trad.getAttribute('aria-expanded'), 'true')
    assert.equal(adminPage.url(), before, 'a folder opened a page')
    await adminPage.click(`[data-testid="sidebar-board-link"][href="/boards/${f.boards.TZEYTUN.id}"]`)
    await adminPage.waitForFunction(() => /1 nəticə/.test(document.body.innerText), null, { timeout: 120000 })
  })

  const marketerPage = await sessions.marketer.newPage()
  await step('marketer: sees the two marketing folders and not Cust-Serv', async () => {
    await openBoard(marketerPage, 'DPHARMA')
    assert.equal(await resultCount(marketerPage), 3)
    assert.deepEqual(await folders(marketerPage), ['Digital Marketing', 'Traditional Marketing'])
  })
  await step('marketer: a Cust-Serv board by its link says no access, its tasks stay hidden', async () => {
    await openBoard(marketerPage, 'MX2611')
    assert.ok((await marketerPage.innerText('body')).includes(az.board.noAccessTitle))
    const list = await api('marketer', `/api/v1/tasks?divisionId=${f.boards.MX2611.id}`)
    assert.equal(list.status, 200)
    assert.equal(list.json.data.total, 0)
    const one = await api('marketer', `/api/v1/tasks/${f.tasks.mxOne.id}`)
    assert.ok([403, 404].includes(one.status), `opened a Cust-Serv task: ${one.status}`)
  })
  await step('nobody reaches another organization\'s board or task', async () => {
    for (const key of ['admin', 'marketer']) {
      const list = await api(key, `/api/v1/tasks?divisionId=${f.boards.FOREIGN.id}`)
      assert.equal(list.json?.data?.total ?? 0, 0, `${key} listed a foreign board`)
      const one = await api(key, `/api/v1/tasks/${f.tasks.foreignOne.id}`)
      assert.ok([403, 404].includes(one.status), `${key} opened a foreign task: ${one.status}`)
    }
    const theirs = await api('foreign', `/api/v1/tasks?divisionId=${f.boards.DPHARMA.id}`)
    assert.equal(theirs.json?.data?.total ?? 0, 0)
  })

  let created
  await step('marketer: creates a task with a deadline; it is the end of that day in Baku and shows on the board', async () => {
    const res = await api('marketer', '/api/v1/tasks', { method: 'POST', body: { title: 'Fixture 20.11 Diabet günü', divisionId: f.boards.DPHARMA.id, status: 'todo', dueDate: '2026-11-20T19:59:59.000Z', assignedTo: f.users.marketer.id } })
    assert.equal(res.status, 201, JSON.stringify(res.json))
    created = res.json.data
    const read = await api('marketer', `/api/v1/tasks/${created.id}`)
    assert.equal(read.json.data.dueDate, '2026-11-20T19:59:59.000Z')
    await openBoard(marketerPage, 'DPHARMA')
    assert.equal(await resultCount(marketerPage), 4)
    const row = marketerPage.locator('tr', { hasText: 'Fixture 20.11 Diabet günü' }).first()
    await row.waitFor({ timeout: 60000 })
    assert.match(await row.innerText(), /20/u)
  })
  await step('marketer: moves the task through the columns and finishes it, as in Bordio', async () => {
    for (const status of ['in_progress', 'done']) {
      const res = await api('marketer', `/api/v1/tasks/${created.id}`, { method: 'PATCH', body: { status } })
      assert.equal(res.status, 200, `${status}: ${JSON.stringify(res.json)}`)
    }
    const read = await api('marketer', `/api/v1/tasks/${created.id}`)
    assert.equal(read.json.data.status, 'done')
    assert.ok(read.json.data.completedAt)
  })
  await step('a grant made before members could finish moves a task but cannot finish it', async () => {
    const work = await api('marketerOld', `/api/v1/tasks/${f.tasks.pharmaOpen.id}`, { method: 'PATCH', body: { status: 'in_progress' } })
    assert.equal(work.status, 200, JSON.stringify(work.json))
    const finish = await api('marketerOld', `/api/v1/tasks/${f.tasks.pharmaOpen.id}`, { method: 'PATCH', body: { status: 'done' } })
    assert.equal(finish.status, 403)
  })
  await step('manager finishes a task on a marketing board', async () => {
    const res = await api('manager', `/api/v1/tasks/${f.tasks.pharmaWork.id}`, { method: 'PATCH', body: { status: 'done' } })
    assert.equal(res.status, 200, JSON.stringify(res.json))
  })
  await step('Cust-Serv clerk: sees only Cust-Serv, works there, cannot touch marketing', async () => {
    const page = await sessions.clerk.newPage()
    await openBoard(page, 'MX2611')
    assert.equal(await resultCount(page), 2)
    assert.deepEqual(await folders(page), ['Cust-Serv / 2026'])
    const own = await api('clerk', `/api/v1/tasks/${f.tasks.mxOne.id}`, { method: 'PATCH', body: { status: 'done' } })
    assert.equal(own.status, 200, JSON.stringify(own.json))
    const theirs = await api('clerk', `/api/v1/tasks/${f.tasks.zeytunOne.id}`, { method: 'PATCH', body: { status: 'in_progress' } })
    assert.ok([403, 404].includes(theirs.status), `moved a marketing task: ${theirs.status}`)
    const make = await api('clerk', '/api/v1/tasks', { method: 'POST', body: { title: 'Fixture not hers', divisionId: f.boards.DZEYTUN.id } })
    assert.ok(make.status >= 400, `created on a marketing board: ${make.status}`)
  })
  await step('viewer: no boards, no changes', async () => {
    const divisions = await api('viewer', '/api/v1/divisions')
    assert.deepEqual(divisions.json?.data?.divisions ?? [], [])
    const move = await api('viewer', `/api/v1/tasks/${f.tasks.zeytunTwo.id}`, { method: 'PATCH', body: { status: 'done' } })
    assert.ok([403, 404].includes(move.status), `viewer moved a task: ${move.status}`)
  })
  await step('boards-only marketer: the CRM home sends them to the boards, the menu holds the boards alone', async () => {
    const page = await sessions.boardsOnly.newPage()
    await page.goto('/dashboard', { timeout: 180000 })
    await page.waitForURL('**/boards', { timeout: 120000 })
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 120000 })
    const groups = await page.$$eval('[data-testid="sidebar-group-toggle"]', (els) => els.map((el) => el.getAttribute('data-group')))
    assert.ok(groups.includes('Boards'), `groups: ${groups}`)
    assert.ok(groups.every((group) => group === 'Boards' || group === 'Settings'), `groups: ${groups}`)
    await openBoard(page, 'DZEYTUN')
    assert.deepEqual(await folders(page), ['Digital Marketing'])
  })
  await step('a message with an @-mention reaches the person, the author is not told', async () => {
    const res = await api('marketer', `/api/v1/tasks/${f.tasks.zeytunOne.id}/comments`, { method: 'POST', body: { content: `bax @${f.users.manager.name}`, mentions: [f.users.manager.id] } })
    assert.ok([200, 201].includes(res.status), JSON.stringify(res.json))
    const told = await api('manager', '/api/v1/notifications')
    assert.ok(JSON.stringify(told.json).includes(f.tasks.zeytunOne.id), 'manager not told')
    const author = await api('marketer', '/api/v1/notifications')
    assert.ok(!JSON.stringify(author.json ?? {}).includes(`${f.tasks.zeytunOne.id}`), 'author told about own message')
  })

  await step('a tenant with the boards and no CRM: boards work, CRM is closed', async () => {
    const page = await sessions.boardsTenantAdmin.newPage()
    await openBoard(page, 'SOLO')
    assert.equal(await resultCount(page), 1)
    const made = await api('boardsTenantAdmin', '/api/v1/tasks', { method: 'POST', body: { title: 'Fixture solo task', divisionId: f.boards.SOLO.id, status: 'todo' } })
    assert.equal(made.status, 201, JSON.stringify(made.json))
    const done = await api('boardsTenantAdmin', `/api/v1/tasks/${made.json.data.id}`, { method: 'PATCH', body: { status: 'done' } })
    assert.equal(done.status, 200, JSON.stringify(done.json))
    const companies = await api('boardsTenantAdmin', '/api/v1/companies')
    assert.equal(companies.status, 403, `companies answered ${companies.status}`)
    const groups = await page.$$eval('[data-testid="sidebar-group-toggle"]', (els) => els.map((el) => el.getAttribute('data-group')))
    assert.ok(groups.includes('Boards') && !groups.includes('CRM'), `groups: ${groups}`)
  })

  await browser.close()
  writeFileSync(`${OUT}/result.json`, `${JSON.stringify({ failed, passed: results.length - failed, results, productionMutation: false }, null, 2)}\n`)
  console.log(`\n${results.length - failed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

if (process.argv[2] === 'prepare') prepare()
else await main()
