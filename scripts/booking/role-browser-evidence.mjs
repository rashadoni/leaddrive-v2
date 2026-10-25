import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';
import { makeRlsTestPrisma } from '../_rls.mjs';
import { sandboxContract } from './role-browser-contract.mjs';

const { base, admin: adminURL, app: appURL } = sandboxContract(process.env);
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), process.env.GITHUB_SHA);
const output = 'artifacts/booking-role-sandbox';
await mkdir(output, { recursive: true });
const admin = makeRlsTestPrisma(adminURL.href);
const app = makeRlsTestPrisma(appURL.href);
const password = `Sandbox!9-${randomUUID()}`;
const suffix = randomUUID().slice(0, 8);
const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const nextDay = new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
const copy = JSON.parse(await readFile('messages/en.json', 'utf8')).booking;
const receipt = { version: 1, status: 'RUNNING', startedAt: new Date().toISOString(),
  headSha: process.env.BOOKING_ROLE_HEAD_SHA, checkedSha: process.env.GITHUB_SHA,
  environment: 'ephemeral hosted PostgreSQL16 / production Next bundle / real credentials and native Chromium',
  syntheticDataOnly: true, productionMutation: false, authenticationMocked: false,
  cases: [], blockedNetwork: [], blockedPublicFontAssets: 0, limitations: [
    'Disposable stand proof, not live production employee/coordinator acceptance',
    'Login uses real CSRF/credentials callback, not visual login-form testing',
    'Synthetic pre-cutover Booking rows; read-only UI, not public create/provider delivery acceptance',
    'Session switch checked after navigation, not cross-tab in-place broadcast invalidation',
    'No full accessibility, load or disaster-recovery certification; service worker disabled in stand',
    'External public font assets are blocked; screenshots may use fallback fonts',
  ] };
const bindings = ['scripts/booking/role-browser-evidence.mjs', 'scripts/booking/role-browser-contract.mjs',
  'scripts/ci/fixtures/booking-role-sandbox.sql', '.github/workflows/booking-role-sandbox.yml',
  'src/lib/booking/access.ts', 'src/lib/booking/queries.ts', 'src/lib/booking/task-reference.ts',
  'src/components/booking/booking-workspace.tsx', 'src/components/tasks/task-meeting-notice.tsx',
  'src/components/tasks/task-detail-view.tsx', 'src/lib/auth.ts', 'src/lib/with-rls.ts', 'prisma/schema.prisma'];
receipt.sourceBindings = await Promise.all(bindings.map(async path => ({ path,
  sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
let browser;
let stage = 'seed';
const contexts = [];
const pass = (name, evidence = {}) => receipt.cases.push({ name, status: 'PASS', ...evidence });
const rows = page => page.getByRole('region', { name: copy.workspaceMeetings, exact: true }).locator(':scope > button');
async function waitRows(page, count) {
  await page.waitForFunction(({ label, count }) => {
    const region = [...document.querySelectorAll('section[aria-label]')].find(el => el.getAttribute('aria-label') === label);
    return region?.getAttribute('aria-busy') === 'false' && region.querySelectorAll(':scope > button').length === count;
  }, { label: copy.workspaceMeetings, count });
}
async function api(context, path, status = 200) {
  assert.ok(path.startsWith('/api/'));
  const response = await context.request.get(path, { timeout: 60000 });
  assert.equal(response.status(), status, `Unexpected status for ${path.split('?')[0]}`);
  return response.json();
}
async function authenticate(context, user) {
  const { csrfToken } = await api(context, '/api/auth/csrf');
  assert.equal(typeof csrfToken, 'string');
  const response = await context.request.post('/api/auth/callback/credentials', {
    timeout: 60000, headers: { 'X-Auth-Return-Redirect': '1' },
    form: { csrfToken, email: user.email, password, organizationSlug: user.slug, callbackUrl: `${base.origin}/meetings` },
  });
  assert.equal(response.status(), 200, 'Credentials callback failed');
  const redirect = new URL((await response.json()).url, base);
  assert.equal(redirect.origin, base.origin);
  assert.equal(redirect.searchParams.get('error'), null, 'Credentials login rejected');
  const session = await api(context, '/api/auth/session');
  assert.equal(session.user.id, user.id);
  assert.equal(session.user.role, user.role);
  assert.equal(session.user.organizationId, user.organizationId);
}
async function seed() {
  const hash = await bcrypt.hash(password, 4);
  const orgs = [];
  for (const key of ['a', 'b']) orgs.push(await admin.organization.create({ data: {
    name: `Booking sandbox ${key}`, slug: `booking-sandbox-${suffix}-${key}`, plan: 'enterprise',
    modules: { crm: true, sales: true, settings: true }, settings: { timezone: 'UTC' },
  } }));
  const people = {};
  for (const [key, role, org] of [['employee', 'sales', orgs[0]], ['coordinator', 'manager', orgs[0]],
    ['assigned', 'sales', orgs[0]], ['excluded', 'manager', orgs[0]], ['foreign', 'sales', orgs[1]]]) {
    people[key] = { ...await admin.user.create({ data: { organizationId: org.id,
      name: `Sandbox ${key}`, email: `sandbox-${suffix}-${key}@example.test`, passwordHash: hash,
      role, preferredLanguage: 'en', require2fa: false, totpEnabled: false, smsAuthEnabled: false,
    } }), slug: org.slug };
  }
  await admin.bookingCoordinatorGrant.create({ data: { organizationId: orgs[0].id,
    coordinatorUserId: people.coordinator.id, hostUserId: people.assigned.id,
    canManage: false, createdBy: people.coordinator.id } });
  const pages = [];
  for (let i = 0; i < orgs.length; i++) pages.push(await admin.bookingPage.create({ data: {
    organizationId: orgs[i].id, slug: `booking-sandbox-${suffix}-page-${i}`, title: `Sandbox page ${i}`,
    hostIds: Object.values(people).filter(p => p.organizationId === orgs[i].id).map(p => p.id), weekly: {},
  } }));
  const meetings = {};
  for (const [index, [key, user]] of Object.entries(people).entries()) {
    const task = await admin.task.create({ data: { organizationId: user.organizationId,
      title: `Sandbox ${key} task`, assignedTo: user.id, createdBy: user.id } });
    meetings[key] = await admin.booking.create({ data: { organizationId: user.organizationId,
      bookingPageId: pages[user.organizationId === orgs[0].id ? 0 : 1].id, hostUserId: user.id,
      name: `Sandbox ${key} meeting`, phone: '+00000000000',
      startsAt: new Date(`${day}T${String(10 + index).padStart(2, '0')}:00:00Z`),
      endsAt: new Date(`${day}T${String(10 + index).padStart(2, '0')}:30:00Z`),
      cancelTokenHash: createHash('sha256').update(randomUUID()).digest('hex'), taskId: task.id } });
  }
  const activation = await readFile('scripts/booking/activate-workspace.sql', 'utf8');
  execFileSync('psql', [adminURL.href, '-X', '-v', 'ON_ERROR_STOP=1'], {
    input: `BEGIN; SET LOCAL app.booking_workspace_artifact_sha='${process.env.GITHUB_SHA}';\n${activation}\nCOMMIT;`, stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { people, meetings, orgs };
}
async function snapshot() {
  const result = [];
  for (const table of ['organizations', 'bookings', 'booking_pages', 'booking_coordinator_grants', 'tasks', 'domain_events', 'effect_outbox']) {
    const data = await admin.$queryRawUnsafe(`SELECT row_to_json(t) AS document FROM public."${table}" t ORDER BY id`);
    result.push({ table, count: data.length, sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex') });
  }
  return result;
}
async function fixtureFence() {
  const [role] = await app.$queryRawUnsafe(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole FROM pg_roles r WHERE r.rolname=current_user`);
  assert.ok(role && Object.values(role).every(value => value === false));
  assert.equal(await app.booking.count(), 0, 'Unscoped app connection must see no tenant bookings');
  assert.equal(await app.user.count(), 0, 'Unscoped app connection must see no tenant users');
  pass('restricted-database-role-and-forced-tenant-RLS');
}
async function view(user) {
  const context = await browser.newContext({ baseURL: base.origin, viewport: { width: 1440, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  contexts.push(context);
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: base.origin }]);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname) && request.method() === 'GET'
      && ['stylesheet', 'font'].includes(request.resourceType())) {
      receipt.blockedPublicFontAssets++;
      return route.abort();
    }
    if (url.origin !== base.origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      receipt.blockedNetwork.push({ external: url.origin !== base.origin, path: url.origin === base.origin ? url.pathname : '[external]', method: request.method() });
      return route.abort();
    }
    return route.continue();
  });
  await authenticate(context, user);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto('/meetings', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: copy.workspaceTitle, exact: true }).waitFor();
  await page.locator('#meeting-period').selectOption('all');
  return { context, page };
}
async function scopeCase(fixture, key, expectedKeys) {
  stage = `scope-${key}`;
  const user = fixture.people[key];
  const v = await view(user);
  const context = (await api(v.context, '/api/v1/bookings/context')).data;
  assert.equal(context.canConfigure, false);
  assert.equal(context.canCoordinate, key === 'coordinator');
  const list = (await api(v.context, '/api/v1/bookings?status=all&limit=50')).data.items;
  const expected = expectedKeys.map(k => fixture.meetings[k].id).sort();
  assert.deepEqual(list.map(item => item.id).sort(), expected);
  await waitRows(v.page, expected.length);
  assert.equal(await rows(v.page).count(), expected.length);
  for (const [other, meeting] of Object.entries(fixture.meetings)) {
    assert.equal(await rows(v.page).filter({ hasText: meeting.name }).count(), expectedKeys.includes(other) ? 1 : 0);
  }
  for (const tab of [copy.workspacePages, copy.workspaceTeam]) assert.equal(await v.page.getByRole('button', { name: tab, exact: true }).count(), 0);
  for (const tab of ['pages', 'team']) {
    await v.page.goto(`/meetings?tab=${tab}`);
    await v.page.getByText(copy.workspaceForbidden, { exact: true }).waitFor();
  }
  await v.page.goto('/meetings');
  await v.page.locator('#meeting-period').selectOption('all');
  await rows(v.page).first().waitFor();
  pass(`${key}-actual-role-populated-scope-and-configuration-denial`, { role: user.role, visibleCount: expected.length });
  return v;
}
try {
  const fixture = await seed();
  await fixtureFence();
  const before = await snapshot();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  receipt.browserVersion = browser.version();
  const employee = await scopeCase(fixture, 'employee', ['employee']);
  assert.equal((await api(employee.context, '/api/v1/public/build-info')).artifactSha, process.env.GITHUB_SHA);
  pass('actual-production-bundle-matches-checked-source');
  const coordinator = await scopeCase(fixture, 'coordinator', ['coordinator', 'assigned']);
  await scopeCase(fixture, 'excluded', ['excluded']);
  pass('manager-role-alone-does-not-grant-team-scope');
  stage = 'positive-menu';
  await employee.page.goto('/dashboard');
  const menu = employee.page.getByRole('link', { name: copy.workspaceTitle, exact: true });
  const sales = employee.page.locator('button[data-group="Sales"]');
  await sales.waitFor();
  if (await sales.getAttribute('aria-expanded') !== 'true') await sales.click();
  await menu.click();
  await employee.page.waitForURL(url => url.pathname === '/meetings');
  await employee.page.locator('#meeting-period').selectOption('all');
  await waitRows(employee.page, 1);
  pass('sales-menu-opens-meetings');
  stage = 'populated-parity';
  const params = new URLSearchParams({ from: `${day}T00:00:00Z`, to: `${nextDay}T00:00:00Z`, status: 'all' });
  for (const v of [employee, coordinator]) {
    const list = (await api(v.context, `/api/v1/bookings?${params}`)).data.items;
    const calendar = (await api(v.context, `/api/v1/bookings/calendar?${params}`)).data.days;
    assert.equal(calendar.find(item => item.day === day)?.count, list.length);
  }
  await coordinator.page.getByRole('button', { name: copy.viewCalendar, exact: true }).click();
  await coordinator.page.locator('#meeting-month').fill(day.slice(0, 7));
  const dayLabel = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const selectedCell = coordinator.page.locator('.grid-cols-7 button').filter({ has: coordinator.page.getByText(dayLabel, { exact: true }) });
  await selectedCell.click();
  await waitRows(coordinator.page, 2);
  await coordinator.page.waitForFunction(label => [...document.querySelectorAll('section[aria-label]')].some(el => el.getAttribute('aria-label') === label && el.getAttribute('aria-busy') === 'false'), copy.viewCalendar);
  assert.equal(await selectedCell.getAttribute('aria-pressed'), 'true');
  assert.match(await selectedCell.locator('span').nth(1).innerText(), /\b2\b/);
  assert.equal(await rows(coordinator.page).count(), 2);
  await coordinator.page.screenshot({ path: `${output}/coordinator-calendar.png` });
  await coordinator.page.getByRole('button', { name: copy.viewList, exact: true }).click();
  assert.equal(await coordinator.page.locator('#meeting-period').inputValue(), 'all');
  pass('populated-list-calendar-day-parity-and-period-preservation', { employeeCount: 1, coordinatorCount: 2 });
  stage = 'detail-and-task';
  await rows(employee.page).filter({ hasText: fixture.meetings.employee.name }).click();
  const dialog = employee.page.getByRole('dialog');
  await dialog.getByText(fixture.meetings.employee.name, { exact: true }).waitFor();
  await dialog.getByRole('button', { name: copy.close, exact: true }).click();
  assert.equal(await employee.page.locator('#meeting-period').inputValue(), 'all');
  await rows(employee.page).filter({ hasText: fixture.meetings.employee.name }).click();
  await dialog.getByRole('link', { name: copy.openTask, exact: true }).click();
  const open = employee.page.getByRole('link', { name: copy.taskOpenMeeting, exact: true });
  await open.waitFor();
  assert.equal(await open.getAttribute('href'), `/meetings?booking=${fixture.meetings.employee.id}`);
  await employee.page.screenshot({ path: `${output}/employee-task-link.png` });
  await open.click();
  await employee.page.getByRole('dialog').getByText(fixture.meetings.employee.name, { exact: true }).waitFor();
  pass('meeting-detail-close-preserves-context-and-task-link-returns-exact-meeting');
  stage = 'negative-controls';
  for (const key of ['assigned', 'excluded', 'foreign']) {
    await api(employee.context, `/api/v1/bookings/${fixture.meetings[key].id}`, 404);
    const reference = await api(employee.context, `/api/v1/bookings/task-link?taskId=${fixture.meetings[key].taskId}`);
    assert.equal(reference.data, null);
  }
  await api(employee.context, `/api/v1/tasks/${fixture.meetings.assigned.taskId}`);
  await employee.page.goto(`/tasks/${fixture.meetings.assigned.taskId}`);
  await employee.page.getByText('Sandbox assigned task', { exact: true }).first().waitFor();
  assert.equal(await employee.page.getByRole('link', { name: copy.taskOpenMeeting, exact: true }).count(), 0);
  await api(coordinator.context, `/api/v1/bookings/${fixture.meetings.excluded.id}`, 404);
  await api(coordinator.context, `/api/v1/bookings/${fixture.meetings.foreign.id}`, 404);
  pass('known-existing-foreign-own-team-and-task-reference-boundaries');
  stage = 'coordinator-filter-and-readonly-grant';
  await coordinator.page.locator('#meeting-host').selectOption(fixture.people.coordinator.id);
  await waitRows(coordinator.page, 1);
  assert.equal(await rows(coordinator.page).count(), 1);
  assert.equal((await api(coordinator.context, `/api/v1/bookings/${fixture.meetings.assigned.id}`)).data.canManage, false);
  pass('coordinator-my-meetings-filter-and-readonly-team-grant');
  stage = 'session-switch';
  await authenticate(coordinator.context, fixture.people.employee);
  await coordinator.page.goto(`/meetings?booking=${fixture.meetings.assigned.id}`);
  await coordinator.page.getByText(copy.meetingUnavailable, { exact: true }).waitFor();
  const switched = (await api(coordinator.context, '/api/v1/bookings?status=all')).data.items;
  assert.deepEqual(switched.map(item => item.id), [fixture.meetings.employee.id]);
  pass('same-browser-session-switch-rechecks-scope-on-navigation');
  assert.deepEqual(await snapshot(), before, 'Read-only browser run changed business facts');
  receipt.factSnapshot = before;
  assert.equal(receipt.blockedNetwork.length, 0, 'Unexpected external or mutation request attempted');
  pass('business-facts-unchanged-and-no-browser-provider-or-mutation-requests');
  receipt.status = 'PASS_ISOLATED_ROLE_BROWSER_STAND';
} catch (error) {
  receipt.status = 'FAIL_ISOLATED_ROLE_BROWSER_STAND';
  receipt.failure = { stage, type: error?.name ?? 'Error', code: error?.code ?? null,
    operator: error?.operator ?? null,
    actualScalar: ['number', 'boolean'].includes(typeof error?.actual) ? error.actual : null,
    expectedScalar: ['number', 'boolean'].includes(typeof error?.expected) ? error.expected : null };
  // Raw SQL/auth errors may contain credentials; never publish their payload.
  console.error(`Booking sandbox failed at ${stage}: ${receipt.failure.type}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await admin.$disconnect();
  await app.$disconnect();
  receipt.finishedAt = new Date().toISOString();
  await writeFile(`${output}/result.json`, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: receipt.status, passedCases: receipt.cases.length, failureStage: receipt.failure?.stage ?? null }));
}
