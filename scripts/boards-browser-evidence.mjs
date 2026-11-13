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
  await board('TARCHIVE', 'Arxiv', 2, 'TRADITIONAL')
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
  // 35 tasks finished 40 days ago: the DONE column used to show only the last 14 days.
  for (let i = 1; i <= 35; i += 1) {
    await task(`old${i}`, 'TARCHIVE', 'done', { title: `Fixture old-${String(i).padStart(2, '0')}`, completedAt: new Date(Date.now() - (40 + i) * 86_400_000) })
  }
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
    const context = await browser.newContext({ baseURL: origin.origin, viewport: { width: 1440, height: 1000 }, locale: 'az-AZ', timezoneId: 'Asia/Baku' })
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
  await step('boards-only marketer: a task template fills the board\'s new-task form, its subtasks come along', async () => {
    const made = await api('boardsOnly', '/api/v1/task-templates', { method: 'POST', body: {
      name: 'Həftəlik story', taskTitle: 'Story {{week}}', priority: 'high', dueDateOffsetDays: 2, checklist: [{ title: 'Mətn' }, { title: 'Dizayn' }],
    } })
    assert.ok([200, 201].includes(made.status), JSON.stringify(made.json))
    const page = await sessions.boardsOnly.newPage()
    await openBoard(page, 'DZEYTUN')
    await page.getByRole('button', { name: 'Yeni Tapşırıq' }).click()
    await page.waitForSelector('[data-testid="board-create-template"]', { timeout: 60000 })
    await page.selectOption('[data-testid="board-create-template"]', { label: 'Həftəlik story' })
    const title = await page.inputValue('[data-testid="board-create-title"]')
    assert.match(title, /^Story \d+$/)
    await page.getByRole('button', { name: 'Yarat', exact: true }).click()
    let task = null
    for (let i = 0; i < 30 && !task; i++) {
      if (i) await page.waitForTimeout(500)
      const list = await api('boardsOnly', `/api/v1/tasks?divisionId=${f.boards.DZEYTUN.id}&limit=1000`)
      task = (list.json?.data?.tasks ?? []).find((t) => t.title === title) ?? null
    }
    assert.ok(task, `no task «${title}» on the board`)
    assert.equal(task.priority, 'high')
    // The due day ends at 23:59:59 in Baku (UTC+4) — not at midnight UTC, which
    // made a task overdue from 04:00 on its own due day.
    assert.match(task.dueDate ?? '', /T19:59:59\.000Z$/, `dueDate ${task.dueDate}`)
    let checklist = []
    for (let i = 0; i < 20 && checklist.length < 2; i++) {
      if (i) await page.waitForTimeout(500)
      checklist = (await api('boardsOnly', `/api/v1/tasks/${task.id}`)).json?.data?.checklist ?? []
    }
    assert.deepEqual(checklist.map((c) => c.title).sort(), ['Dizayn', 'Mətn'])
    await page.close()
    return { title, subtasks: checklist.length }
  })
  // Xayala, 2026-11-12: «sadece oz tasklarimi gorende bura task elave etmek isdeyirem» —
  // a new task made while the board shows one person's tasks was nobody's and vanished.
  await step('a board showing only my tasks gives a new task to me; showing someone else\'s, to them', async () => {
    const page = await sessions.boardsOnly.newPage()
    // The select takes its value once the people have loaded: wait for it, do not read it at once.
    const assigneeOfNewTask = async (query, expected) => {
      await page.goto(`/boards/${f.boards.DZEYTUN.id}${query}`, { timeout: 180000 })
      await page.getByRole('button', { name: 'Yeni Tapşırıq' }).click()
      await page.waitForSelector('[data-testid="board-create-assignee"] option + option', { state: 'attached', timeout: 60000 })
      await page.waitForFunction((want) => document.querySelector('[data-testid="board-create-assignee"]')?.value === want, expected, { timeout: 30000 })
        .catch(async () => assert.fail(`new task from ${query || 'the whole board'}: assignee «${await page.inputValue('[data-testid="board-create-assignee"]')}», expected «${expected}»`))
    }
    await assigneeOfNewTask('?mine=1', f.users.boardsOnly.id)
    await assigneeOfNewTask(`?assignee=${f.users.marketer.id}`, f.users.marketer.id)
    await assigneeOfNewTask('', '')
    await page.close()
  })

  // Owner, 2026-11-12: «завершённые задачи не только за 14 дней… все… как в бордио».
  await step('the kanban\'s done column shows every finished task, newest first, 30 at a time', async () => {
    const page = await sessions.admin.newPage()
    await page.goto(`/boards/${f.boards.TARCHIVE.id}`, { timeout: 180000 })
    await page.getByRole('button', { name: 'Lövhə', exact: true }).click()
    const cards = page.locator('[aria-label^="Fixture old-"]')
    await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Fixture old-"]').length > 0, null, { timeout: 120000 })
    assert.equal(await cards.count(), 30)
    assert.equal(await cards.first().getAttribute('aria-label'), 'Fixture old-01')
    const more = page.locator('[data-testid="board-done-more"]')
    assert.match(await more.innerText(), /5/u)
    await more.click()
    await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Fixture old-"]').length === 35, null, { timeout: 30000 })
    assert.equal(await more.count(), 0)
    await page.close()
  })

  await step('a folder opens as the list of its boards\' tasks, each row naming its board; the kanban is the second tab', async () => {
    const page = await sessions.clerk.newPage()
    await page.goto(`/boards/${f.boards.CUSTSERV.id}`, { timeout: 180000 })
    await page.waitForSelector('[data-testid="task-row-board"]', { timeout: 180000 })
    const tabs = await page.$$eval('[data-crm-tab]', (els) => els.map((el) => `${el.textContent.trim()}:${el.getAttribute('data-state')}`))
    assert.deepEqual(tabs, ['Siyahı:active', 'Lövhə:inactive', 'Hesabatlar:inactive'])
    const text = await page.innerText('body')
    assert.ok(text.includes(f.tasks.mxOne.title) && text.includes(f.tasks.mxTwo.title), 'a task of the folder is missing from its list')
    const named = await page.$$eval('[data-testid="task-row-board"]', (els) => els.map((el) => el.textContent.trim()))
    assert.deepEqual([...new Set(named)], ['11. NOYABR 26 MX'])
    await page.close()
  })
  await step('a board link carrying ?q= opens its list already searched, under the board\'s own name', async () => {
    const page = await sessions.boardsOnly.newPage()
    await page.goto(`/boards/${f.boards.DZEYTUN.id}?q=${encodeURIComponent(f.tasks.zeytunOne.title)}`, { timeout: 180000 })
    await page.waitForFunction(() => /\d+ nəticə/.test(document.body.innerText), null, { timeout: 180000 })
    assert.equal(await resultCount(page), 1)
    assert.equal(await page.getByPlaceholder('Tapşırıq axtar...').inputValue(), f.tasks.zeytunOne.title)
    assert.equal((await page.innerText('h1')).trim(), 'Zeytun')
    await page.close()
  })
  await step('the board list shows only my tasks at one click, and opens that way again next time (Zeytun, 2026-11-12: «Pharmastore qarışıqdı»)', async () => {
    const page = await sessions.marketer.newPage()
    await page.goto(`/boards/${f.boards.DPHARMA.id}`, { timeout: 180000 })
    await page.waitForFunction(() => /\d+ nəticə/.test(document.body.innerText), null, { timeout: 180000 })
    const body = async () => page.innerText('body')
    assert.ok((await body()).includes(f.tasks.pharmaWork.title), 'everyone\'s tasks before the filter')
    await page.click('[data-testid="board-list-mine"]')
    await page.waitForFunction((title) => !document.body.innerText.includes(title), f.tasks.pharmaWork.title, { timeout: 30000 })
    assert.ok((await body()).includes(f.tasks.pharmaOpen.title), 'her own task is missing')
    await page.reload({ timeout: 180000 })
    await page.waitForFunction(() => /\d+ nəticə/.test(document.body.innerText), null, { timeout: 180000 })
    await page.waitForFunction(() => document.querySelector('[data-testid="board-list-mine"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 30000 })
    assert.ok(!(await body()).includes(f.tasks.pharmaWork.title), 'the filter was not kept')
    await page.click('[data-testid="board-list-mine"]')
    await page.waitForFunction((title) => document.body.innerText.includes(title), f.tasks.pharmaWork.title, { timeout: 30000 })
    await page.close()
  })
  await step('«Mənim işlərim»: the person\'s own open tasks from every board, ticked into the board\'s done column and back', async () => {
    // What the server says is hers — on a real database, so the filter itself is proven, not a mock.
    const mine = await api('marketer', '/api/v1/tasks?mine=1&open=1&limit=1000')
    assert.equal(mine.status, 200, JSON.stringify(mine.json))
    const ids = mine.json.data.tasks.map((t) => t.id)
    assert.ok(ids.includes(f.tasks.pharmaOpen.id), 'her own task is missing')
    assert.ok(!ids.includes(f.tasks.pharmaWork.id), 'someone else\'s task is listed')
    assert.ok(!ids.includes(f.tasks.pharmaDone.id), 'a finished task is listed')
    const page = await sessions.marketer.newPage()
    await page.goto('/boards/mine', { timeout: 180000 })
    await page.waitForSelector('[data-testid="my-work-row"]', { timeout: 120000 })
    const rows = await page.$$eval('[data-testid="my-work-row"]', (els) => els.map((el) => el.getAttribute('data-task-id')))
    assert.deepEqual([...rows].sort(), [...ids].sort())
    const link = page.locator('[data-testid="sidebar-my-work-link"]')
    await link.waitFor({ timeout: 60000 })
    assert.match(await link.innerText(), new RegExp(`Mənim işlərim\\s*${ids.length}$`))
    const row = `[data-testid="my-work-row"][data-task-id="${f.tasks.pharmaOpen.id}"]`
    assert.equal(await page.innerText(`${row} [data-testid="my-work-board"]`), 'Pharmastore')
    const read = async () => (await api('marketer', `/api/v1/tasks/${f.tasks.pharmaOpen.id}`)).json.data
    const before = await read()
    await page.click(`${row} [data-testid="my-work-tick"]`)
    let after = before
    for (let i = 0; i < 20 && after.status === before.status; i++) { await page.waitForTimeout(500); after = await read() }
    assert.equal(after.status, 'done')
    assert.equal(after.boardColumnKey, 'c_done')
    // The same wait, but a failure says what the tick showed instead of only
    // «timed out»: a tick wiped by a list read that was still under way looked
    // exactly like a hung request here (2026-11-10).
    await page.waitForSelector(`${row} [data-testid="my-work-tick"][aria-pressed="true"]:not([disabled])`, { timeout: 30000 }).catch(async (error) => {
      const seen = await page.$eval(`${row} [data-testid="my-work-tick"]`, (el) => ({ pressed: el.getAttribute('aria-pressed'), busy: el.hasAttribute('disabled') })).catch(() => 'the row is gone')
      throw new Error(`${error.message}\n     the server has the task done; the tick showed ${JSON.stringify(seen)}`)
    })
    await page.click(`${row} [data-testid="my-work-tick"]`)
    let back = after
    for (let i = 0; i < 20 && back.status === 'done'; i++) { await page.waitForTimeout(500); back = await read() }
    assert.equal(back.status, before.status)
    // Its column comes back too — unless it never matched its status (an older
    // status-only edit left it so), and then the board places it by status.
    assert.equal(back.boardColumnKey, before.boardColumnKey === `c_${before.status}` ? before.boardColumnKey : null)
    await page.close()
    return { tasks: ids.length }
  })
  await step('«Mənim işlərim → Təqvim»: a task dragged from the waiting list onto today is planned for today — for her only; dragged back it has no day; the task itself stays', async () => {
    const id = f.tasks.pharmaOpen.id
    const read = async () => (await api('marketer', `/api/v1/tasks/${id}`)).json.data
    const myPlan = async () => ((await api('marketer', '/api/v1/tasks?mine=1&open=1&limit=1000')).json.data.tasks.find((t) => t.id === id)?.plans ?? [])
    const before = await read()
    // Said in one line: the step before puts this task back as it was. Without
    // it, its leftovers only show up as two blind minutes on the wait below.
    assert.ok(!['done', 'completed', 'cancelled'].includes(before.status), `the fixture task is ${before.status}, not open — the step before left it finished`)
    assert.deepEqual(await myPlan(), [], 'the fixture task is already planned')
    const page = await sessions.marketer.newPage()
    await page.goto('/boards/mine?view=calendar', { timeout: 180000 })
    const card = `[data-testid="my-work-card"][data-task-id="${id}"]`
    await page.waitForSelector(`[data-testid="my-work-waiting"] ${card}`, { timeout: 120000 })
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
    const drag = async (from, to) => {
      const a = await page.locator(from).boundingBox()
      const b = await page.locator(to).boundingBox()
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 })
      await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 80), { steps: 20 })
      await page.mouse.up()
    }
    await drag(card, `[data-testid="my-work-day"][data-day="${today}"]`)
    let planned = []
    for (let i = 0; i < 20 && planned.length === 0; i++) { await page.waitForTimeout(500); planned = await myPlan() }
    assert.equal(planned.length, 1)
    assert.equal(planned[0].day, `${today}T00:00:00.000Z`)
    assert.equal(typeof planned[0].rank, 'number') // its place in her day
    const during = await read()
    assert.equal(during.startDate ?? null, before.startDate ?? null)
    assert.equal(during.dueDate, before.dueDate)
    await page.waitForSelector(`[data-testid="my-work-day"][data-day="${today}"] ${card}`, { timeout: 30000 })
    await drag(card, '[data-testid="my-work-waiting"] h2')
    let back = planned
    for (let i = 0; i < 20 && back.length > 0; i++) { await page.waitForTimeout(500); back = await myPlan() }
    assert.deepEqual(back, [])
    await page.close()
  })
  await step('a message with an @-mention reaches the person, the author is not told', async () => {
    const res = await api('marketer', `/api/v1/tasks/${f.tasks.zeytunOne.id}/comments`, { method: 'POST', body: { content: `bax @${f.users.manager.name}`, mentions: [f.users.manager.id] } })
    assert.ok([200, 201].includes(res.status), JSON.stringify(res.json))
    const told = await api('manager', '/api/v1/notifications')
    assert.ok(JSON.stringify(told.json).includes(f.tasks.zeytunOne.id), 'manager not told')
    const author = await api('marketer', '/api/v1/notifications')
    assert.ok(!JSON.stringify(author.json ?? {}).includes(`${f.tasks.zeytunOne.id}`), 'author told about own message')
  })

  // Owner, 2026-11-13: Bordio's «Teams & Users».
  await step('teams: the admin makes a team and puts a person in it; the team page lists that person\'s open tasks, the sidebar names the team', async () => {
    const made = await api('admin', '/api/v1/tasks/teams', { method: 'POST', body: { name: 'Digital Marketing TEAM' } })
    assert.equal(made.status, 201, JSON.stringify(made.json))
    const teamId = made.json.data.id
    assert.equal((await api('marketer', '/api/v1/tasks/teams', { method: 'POST', body: { name: 'Öz komandam' } })).status, 403)
    const placed = await api('admin', '/api/v1/tasks/teams/members', { method: 'PUT', body: { userId: f.users.marketer.id, teamId, role: 'leader' } })
    assert.equal(placed.status, 200, JSON.stringify(placed.json))
    const task = await api('marketer', '/api/v1/tasks', { method: 'POST', body: { title: 'Fixture komanda işi', divisionId: f.boards.DPHARMA.id, status: 'todo', assignedTo: f.users.marketer.id } })
    assert.equal(task.status, 201, JSON.stringify(task.json))
    const page = await sessions.marketer.newPage()
    await page.goto(`/boards/team/${teamId}`, { timeout: 180000 })
    await page.waitForSelector('[data-testid="team-page"]', { timeout: 120000 })
    await page.locator('tr[data-row]', { hasText: 'Fixture komanda işi' }).first().waitFor({ timeout: 60000 })
    // The clerk's Cust-Serv work is not this team's.
    assert.equal(await page.locator('tr[data-row]', { hasText: 'Fixture mxOne' }).count(), 0)
    await page.waitForSelector(`[data-testid="sidebar-team-link"][href="/boards/team/${teamId}"]`, { timeout: 60000 })
    await page.click('[data-testid="team-tab-members"]')
    assert.match(await page.innerText('[data-testid="team-members"]'), /Fixture marketer[\s\S]*Rəhbər/u)
    await page.close()
    // The admin's page: the team with its one person.
    const adminTeams = await sessions.admin.newPage()
    await adminTeams.goto('/boards/teams', { timeout: 180000 })
    await adminTeams.waitForSelector(`[data-testid="teams-team"][data-team="${teamId}"]`, { timeout: 120000 })
    assert.match(await adminTeams.innerText(`[data-testid="teams-team"][data-team="${teamId}"]`), /Digital Marketing TEAM\s*1/u)
    await adminTeams.close()
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
