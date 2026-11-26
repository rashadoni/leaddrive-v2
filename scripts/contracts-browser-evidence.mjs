/**
 * The contract's whole path in a real browser, with a UI audit of every
 * screen on the way (owner, 2026-11-26: «сделай UI, UX? E2E? аудиты на сайте»).
 *
 * Runs ONLY in GitHub Actions on an empty disposable Postgres
 * (.github/workflows/contracts-e2e.yml): never against production, never with
 * a real person's account. Every company, person and password is made up.
 *
 *   node scripts/contracts-browser-evidence.mjs prepare   restricted app role + tenant RLS
 *   node scripts/contracts-browser-evidence.mjs           seed, walk the path, audit the screens
 *
 * The path: the wizard (template → parties → terms → check → draft), approval,
 * e-sign by link (our signer on the public page, the counterparty from the
 * client portal's «İmzala»), the signature sheet and the signed PDF, a price
 * protocol and an acceptance act signed the same way, an invoice, and the
 * counterparty's «Sənədlər» with the whole chain.
 *
 * Every screen is shot at 1440 px and at 390 px (a phone) and measured: does
 * the page scroll sideways and which element sticks out, raw translation keys
 * on screen, console errors, 5xx answers. A broken step fails the run; what the
 * audit finds is reported (audit.md, the job summary) for a person to judge.
 * A step done through its screen falls back to the API when the screen fails,
 * so one broken button does not hide the rest of the path — the failure stays
 * recorded.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { chromium } from 'playwright'
import { makeRlsTestPrisma } from './_rls.mjs'

const DATABASE = 'contracts_e2e'
const ROLE = 'contracts_e2e'
const OUT = process.env.CONTRACTS_E2E_OUTPUT || 'artifacts/contracts-e2e'
const DESKTOP = { width: 1440, height: 1000 }
const PHONE = { width: 390, height: 844 }

function guard() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'GitHub Actions only')
  assert.equal(process.env.CI, 'true')
  assert.equal(process.env.CONTRACTS_E2E, '1')
  assert.notEqual(process.env.NODE_ENV, 'production')
  const [admin, app] = [process.env.ADMIN_DATABASE_URL, process.env.DATABASE_URL].map((value) => new URL(value))
  for (const url of [admin, app]) {
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'loopback database only')
    assert.equal(url.pathname, `/${DATABASE}`)
  }
  assert.equal(admin.username, 'postgres')
  assert.equal(app.username, ROLE)
  assert.equal(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, admin.href)
  return { adminURL: admin.href }
}

function prepare() {
  const { adminURL } = guard()
  const sql = (value) => execFileSync('psql', [adminURL, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: value, stdio: ['pipe', 'pipe', 'pipe'] })
  sql(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM organizations) THEN RAISE EXCEPTION 'contracts fixture must be empty'; END IF; END $$;`)
  const password = process.env.CONTRACTS_E2E_DATABASE_PASSWORD
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
      EXECUTE format('CREATE POLICY contracts_e2e_tenant ON public.%I USING ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'') WITH CHECK ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'')',t.relname);
    END LOOP; END $$;`)
}

async function seed() {
  const { adminURL } = guard()
  const db = makeRlsTestPrisma(adminURL)
  await db.$executeRaw`SELECT set_config('app.rls_bypass', 'on', false)`
  const password = `Fixture!${randomUUID()}`
  const passwordHash = await bcrypt.hash(password, 4)
  const slug = `contracts-e2e-${randomUUID().slice(0, 8)}`
  const org = await db.organization.create({ data: {
    name: 'Nümunə Texnologiya MMC', slug, plan: 'enterprise',
    modules: { crm: true, contracts: true, finance: true, sales: true },
    settings: { fixtureOnly: true, invoice: {
      companyName: 'Nümunə Texnologiya MMC', companyVoen: '1700000001', companyAddress: 'Bakı, Nizami küç. 10', directorName: 'Rəşad Nümunəli',
      bankName: 'Nümunə Bank ASC', bankCode: '200001', bankSwift: 'NUMUAZ22', bankAccount: 'AZ00NUMU00000000000000000001', bankVoen: '1700000002', bankCorrAccount: 'AZ00NABZ01350100000000001944',
    } } } })
  const admin = await db.user.create({ data: { organizationId: org.id, name: 'Rəşad Nümunəli', email: `admin-${slug}@example.invalid`, passwordHash, role: 'admin', preferredLanguage: 'az' } })
  const company = await db.company.create({ data: { organizationId: org.id, name: 'Kaspi Ticarət MMC', voen: '1400000003', address: 'Bakı, Neftçilər pr. 5' } })
  const contact = await db.contact.create({ data: {
    organizationId: org.id, companyId: company.id, fullName: 'Fərid Kaspiyev', email: `farid-${slug}@example.invalid`, isActive: true,
    portalAccessEnabled: true, portalPasswordHash: passwordHash, portalDocumentsEnabled: true,
  } })
  // A template the way a lawyer writes one: the parties come from the cards, the subject is typed in step 3.
  const template = await db.contractTemplate.create({ data: {
    organizationId: org.id, slug: 'alqi-satqi', name: 'Alğı-satqı müqaviləsi', isActive: true, defaultDurationMonths: 12,
    clauses: [
      { id: 'parties', title: '1. Tərəflər', body: '{{our_name}} (VÖEN {{our_voen}}) və {{counterparty_name}} (VÖEN {{counterparty_voen}}) {{contract_date}} tarixində bu müqaviləni bağladılar.' },
      { id: 'subject', title: '2. Müqavilənin predmeti', body: 'Satıcı alıcıya {{subject}} təhvil verir, alıcı isə qəbul edib haqqını ödəyir.' },
    ],
    variables: [
      { name: 'our_name', type: 'string', required: true },
      { name: 'our_voen', type: 'string', required: true },
      { name: 'counterparty_name', type: 'string', required: true },
      { name: 'counterparty_voen', type: 'string', required: true },
      { name: 'contract_date', type: 'string', required: true },
      { name: 'subject', type: 'string', required: true },
    ],
  } })
  await db.$disconnect()
  return { org, slug, password, admin, company, contact, template }
}

// ── the audit ──────────────────────────────────────────────────────────────
const results = []
const screens = []
const consoleErrors = []
const serverErrors = []
let failed = 0
let current = 'setup'

async function step(name, fn) {
  current = name
  const started = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) })
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error).slice(0, 700) })
    console.log(`FAIL ${name}\n     ${String(error?.message ?? error).slice(0, 700)}`)
  }
}

/** A screen-level failure that the API then works around: recorded, never hidden. */
function uiFallback(name, error) {
  failed += 1
  results.push({ name: `${name} (screen)`, ok: false, error: String(error?.message ?? error).slice(0, 700), fellBackToApi: true })
  console.log(`FAIL ${name} (screen) — continuing through the API\n     ${String(error?.message ?? error).slice(0, 400)}`)
}

function watch(page) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // A font the sign page imports from Google cannot load in CI; it is not the page's error.
    if (/fonts\.googleapis|fonts\.gstatic|ERR_NAME_NOT_RESOLVED|Failed to load resource: net::/.test(text)) return
    consoleErrors.push({ step: current, url: page.url().replace(/\/sign\/[^/?#]+/, '/sign/<token>'), text: text.slice(0, 300) })
  })
  page.on('response', (response) => {
    if (response.status() >= 500) serverErrors.push({ step: current, status: response.status(), url: new URL(response.url()).pathname.replace(/\/sign\/[^/?#]+/, '/sign/<token>') })
  })
  return page
}

/** Shoot the screen at desktop and phone width and measure what a person would trip over. */
async function shoot(page, name) {
  const entry = { name, path: new URL(page.url()).pathname.replace(/\/sign\/[^/?#]+/, '/sign/<token>') }
  for (const [label, size] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(600)
    entry[label] = await page.evaluate(() => {
      const width = document.documentElement.clientWidth
      const sideways = Math.max(0, document.documentElement.scrollWidth - width)
      const sticking = []
      for (const el of document.querySelectorAll('body *')) {
        const box = el.getBoundingClientRect()
        if (!box.width || !box.height || (box.right <= width + 1 && box.left >= -1)) continue
        let scroller = el.parentElement
        let contained = false
        while (scroller && scroller !== document.body) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(scroller).overflowX)) { contained = true; break }
          scroller = scroller.parentElement
        }
        if (contained) continue
        const id = el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : el.id ? `#${el.id}` : ''
        sticking.push(`${el.tagName.toLowerCase()}${id} +${Math.round(box.right - width)}px «${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)}»`)
        if (sticking.length >= 6) break
      }
      const text = document.body.innerText
      const rawKeys = [...new Set(text.match(/\b[a-z][a-zA-Z]+\.[a-z][a-zA-Z0-9]+[A-Z_][a-zA-Z0-9_]*\b/g) || [])].slice(0, 10)
      const truncated = [...document.querySelectorAll('button, a, th, label')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && el.getBoundingClientRect().width > 0)
        .map((el) => (el.textContent || '').trim().slice(0, 40)).slice(0, 6)
      return { sideways, sticking, rawKeys, truncated, height: document.documentElement.scrollHeight }
    })
    await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: true })
  }
  await page.setViewportSize(DESKTOP)
  screens.push(entry)
  return entry
}

const az = JSON.parse(readFileSync('messages/az.json', 'utf8'))
const say = (key) => key.split('.').reduce((node, part) => node?.[part], az) ?? (() => { throw new Error(`no az text for ${key}`) })()

async function main() {
  mkdirSync(OUT, { recursive: true })
  const origin = new URL(process.env.CONTRACTS_E2E_BASE_URL)
  const f = await seed()
  const browser = await chromium.launch()
  const newContext = async () => {
    const context = await browser.newContext({ baseURL: origin.origin, viewport: DESKTOP, locale: 'az-AZ', timezoneId: 'Asia/Baku' })
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'az', url: origin.origin }])
    return context
  }

  const crm = await newContext()
  const api = async (path, { method = 'GET', body } = {}) => {
    const response = await crm.request.fetch(path, { method, timeout: 180000, ...(body !== undefined ? { data: body } : {}) })
    let json = null
    try { json = await response.json() } catch { /* not JSON */ }
    return { status: response.status(), json, response }
  }
  const signOnPage = async (link, name) => {
    const context = await newContext()
    const page = watch(await context.newPage())
    await page.goto(new URL(link, origin).pathname, { timeout: 180000 })
    await page.getByRole('button', { name: say('signPortal.signButton') }).waitFor({ timeout: 180000 })
    if (name) await shoot(page, name)
    await page.getByRole('button', { name: say('signPortal.signButton') }).click()
    await page.getByText(say('signPortal.successTitle')).waitFor({ timeout: 120000 })
    if (name) await shoot(page, `${name}-done`)
    await context.close()
  }
  const state = {}

  await step('the administrator logs in', async () => {
    const { csrfToken } = await (await crm.request.get('/api/auth/csrf', { timeout: 180000 })).json()
    const response = await crm.request.post('/api/auth/callback/credentials', { timeout: 180000,
      headers: { 'X-Auth-Return-Redirect': '1' },
      form: { csrfToken, email: f.admin.email, password: f.password, organizationSlug: f.slug, callbackUrl: `${origin.origin}/contracts` } })
    assert.equal(response.status(), 200)
    const session = await (await crm.request.get('/api/auth/session')).json()
    assert.equal(session.user.id, f.admin.id)
    // Every page's «watch the video?» window already offered, as the prompt itself records it — so it does not stand over the clicks.
    const slugs = [...readFileSync('src/content/help/video-assets.ts', 'utf8').matchAll(/slug: "([a-z0-9-]+)"/g)].map((m) => m[1])
    const seen = await api('/api/v1/users/me/preferences', { method: 'PUT', body: { helpVideoSeen: slugs } })
    assert.equal(seen.status, 200, JSON.stringify(seen.json))
  })
  const page = watch(await crm.newPage())

  await step('the contracts list opens', async () => {
    await page.goto('/contracts', { timeout: 180000 })
    await page.waitForLoadState('networkidle', { timeout: 180000 })
    await shoot(page, '01-contracts-list')
  })

  await step('the wizard makes a draft from the template', async () => {
    await page.goto('/contracts/new', { timeout: 180000 })
    await page.getByTestId(`wizard-template-${f.template.id}`).waitFor({ timeout: 180000 })
    await shoot(page, '02-wizard-template')
    await page.getByTestId(`wizard-template-${f.template.id}`).click()
    await page.getByRole('button', { name: say('contractWizard.next') }).click()
    await page.locator('#wizard-voen').fill(f.company.voen)
    await page.locator('#wizard-name').fill(f.company.name)
    await page.locator('#wizard-address').fill('Bakı, Neftçilər pr. 5')
    await page.locator('#wizard-director').fill('Fərid Kaspiyev')
    await shoot(page, '03-wizard-parties')
    await page.getByRole('button', { name: say('contractWizard.next') }).click()
    await page.locator('#wizard-var-subject').fill('ofis avadanlığı')
    await shoot(page, '04-wizard-terms')
    await page.getByRole('button', { name: say('contractWizard.check') }).click()
    await page.getByTestId('wizard-document').waitFor({ timeout: 120000 })
    const text = await page.getByTestId('wizard-document').innerText()
    assert.match(text, /Kaspi Ticarət MMC/)
    assert.match(text, /1400000003/)
    assert.match(text, /ofis avadanlığı/)
    await shoot(page, '05-wizard-check')
    await page.getByTestId('wizard-save-draft').click()
    await page.waitForURL(/\/contracts\/[^/]+$/, { timeout: 180000 })
    state.contractId = new URL(page.url()).pathname.split('/').pop()
    await page.waitForLoadState('networkidle', { timeout: 180000 })
    await shoot(page, '06-contract-draft')
    return { contractId: state.contractId }
  })
  assert.ok(state.contractId, 'no contract: the rest of the path has nothing to work on')
  const C = `/api/v1/contracts/${state.contractId}`
  const contract = async () => (await api(C)).json?.data ?? (await api(C)).json

  await step('approval: sent with one stage, approved', async () => {
    try {
      await page.getByRole('button', { name: say('contracts.submitForApproval') }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByPlaceholder(say('contracts.approvalStagePlaceholder')).first().fill('Hüquqşünas')
      await shoot(page, '07-approval-dialog')
      await dialog.getByRole('button', { name: say('contracts.submitForApproval') }).click()
      await page.getByRole('button', { name: say('contracts.approvalApproveAction') }).first().waitFor({ timeout: 120000 })
      await page.getByRole('button', { name: say('contracts.approvalApproveAction') }).first().click()
      await page.waitForTimeout(1500)
    } catch (error) {
      uiFallback('approval', error)
      const submit = await api(`${C}/submit-for-approval`, { method: 'POST', body: { stages: [{ label: 'Hüquqşünas', approvers: [{}], mode: 'all' }] } })
      assert.ok(submit.status < 300, `submit ${submit.status} ${JSON.stringify(submit.json)}`)
    }
    let c = await contract()
    if (c.status === 'pending_approval') {
      if (!results.some((r) => r.name === 'approval (screen)')) uiFallback('approval', new Error('«Təsdiqlə» did not approve the contract'))
      const approved = await api(`${C}/approvals/1`, { method: 'POST', body: { decision: 'approve' } })
      assert.ok(approved.status < 300, `approve ${approved.status} ${JSON.stringify(approved.json)}`)
      c = await contract()
    }
    assert.equal(c.status, 'approved')
    await page.reload({ timeout: 180000 })
    await page.waitForLoadState('networkidle', { timeout: 180000 })
    await shoot(page, '08-contract-approved')
  })

  await step('the contract goes out for signing to us and to the counterparty', async () => {
    const signers = [
      { fullName: f.admin.name, email: f.admin.email },
      { fullName: f.contact.fullName, email: f.contact.email },
    ]
    const sent = page.waitForResponse((r) => /\/esign\/[^/]+\/send$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 120000 }).catch(() => null)
    try {
      await page.getByRole('button', { name: say('contracts.esignSendForSignature') }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: say('contracts.esignAddSigner') }).click()
      const names = dialog.getByPlaceholder(say('contracts.esignSignerFullName'))
      const emails = dialog.getByPlaceholder(say('contracts.esignSignerEmail'))
      for (let i = 0; i < signers.length; i++) {
        await names.nth(i).fill(signers[i].fullName)
        await emails.nth(i).fill(signers[i].email)
      }
      await shoot(page, '09-esign-dialog')
      await dialog.getByRole('button', { name: say('contracts.esignSendForSignature') }).click()
      const response = await sent
      assert.ok(response, 'no send request left the page')
      state.contractLinks = (await response.json()).data.signingLinks
      await page.waitForTimeout(800)
      await shoot(page, '10-esign-links')
    } catch (error) {
      uiFallback('send for signing', error)
      await page.keyboard.press('Escape').catch(() => {})
      const created = await api(`${C}/esign`, { method: 'POST', body: { subject: 'Zəhmət olmasa imzalayın', signers: signers.map((s, i) => ({ ...s, role: 'signer', order: i + 1 })) } })
      assert.ok(created.status < 300, `esign ${created.status} ${JSON.stringify(created.json)}`)
      const envelopeId = created.json?.data?.envelope?.id
      const send = await api(`${C}/esign/${envelopeId}/send`, { method: 'POST', body: {} })
      assert.ok(send.status < 300, `send ${send.status} ${JSON.stringify(send.json)}`)
      state.contractLinks = send.json.data.signingLinks
    }
    assert.equal(state.contractLinks.length, 2)
  })

  await step('our signer signs on the public page', async () => {
    await signOnPage(state.contractLinks[0].signingLink, '11-sign-page')
  })

  const portal = await newContext()
  const portalPage = watch(await portal.newPage())
  await step('the counterparty logs in to the portal and sees what waits for them', async () => {
    await portalPage.goto('/portal/login', { timeout: 180000 })
    await portalPage.locator('input[type=email]').fill(f.contact.email)
    await portalPage.locator('input[type=password]').fill(f.password)
    await shoot(portalPage, '12-portal-login')
    await portalPage.getByRole('button', { name: say('portal.signIn') }).click()
    await portalPage.waitForURL(/\/portal\/(?!login)/, { timeout: 120000 })
    await portalPage.goto('/portal/documents', { timeout: 180000 })
    await portalPage.getByTestId('portal-documents').waitFor({ timeout: 120000 })
    await portalPage.getByTestId('portal-documents-waiting').waitFor({ timeout: 60000 })
    await shoot(portalPage, '13-portal-documents')
  })

  await step('«İmzala» in the portal opens the signing page, and the contract is signed', async () => {
    const signerId = state.contractLinks[1].signerId
    await portalPage.getByTestId(`portal-sign-${signerId}`).click()
    await portalPage.waitForURL(/\/sign\//, { timeout: 120000 })
    await portalPage.getByRole('button', { name: say('signPortal.signButton') }).waitFor({ timeout: 180000 })
    await portalPage.getByRole('button', { name: say('signPortal.signButton') }).click()
    await portalPage.getByText(say('signPortal.successTitle')).waitFor({ timeout: 120000 })
    await shoot(portalPage, '14-portal-signed')
    const c = await contract()
    assert.equal(c.status, 'active')
    assert.ok(c.signedAt)
  })

  await step('the card shows the signature sheet; the signed PDF is a PDF', async () => {
    await page.goto(`/contracts/${state.contractId}`, { timeout: 180000 })
    await page.getByTestId('esign-signature-sheet').waitFor({ timeout: 120000 })
    await shoot(page, '15-contract-signed')
    const pdf = await crm.request.get(`${C}/pdf?lang=az&signed=1&tz=Asia%2FBaku`, { timeout: 180000 })
    assert.equal(pdf.status(), 200)
    assert.match(pdf.headers()['content-type'] ?? '', /application\/pdf/)
    assert.equal((await pdf.body()).subarray(0, 4).toString(), '%PDF')
  })

  async function makeDocument(kind, testId, label) {
    await page.goto(`/contracts/${state.contractId}`, { timeout: 180000 })
    await page.getByTestId('contract-documents-chain').waitFor({ timeout: 120000 })
    await page.getByTestId(testId).click()
    await page.waitForURL(/\/documents\/[^/]+$/, { timeout: 120000 })
    const docId = new URL(page.url()).pathname.split('/').pop()
    await page.getByTestId('document-status').waitFor({ timeout: 120000 })
    if (kind === 'price_protocol') {
      await page.getByTestId('add-line').click()
      await page.getByLabel(say('contractDocuments.colName')).last().fill('Ofis kreslosu')
      await page.getByLabel(say('contractDocuments.colUnit')).last().fill('ədəd')
      await page.getByLabel(say('contractDocuments.colPrice')).last().fill('250')
    }
    await shoot(page, `${label}-editor`)
    const save = page.getByTestId('document-save')
    if (await save.isEnabled()) {
      const saved = page.waitForResponse((r) => r.url().includes(`/documents/${docId}`) && r.request().method() === 'PUT', { timeout: 120000 })
      await save.click()
      assert.ok((await saved).ok(), 'save refused')
    }
    await page.getByTestId('document-send-open').click()
    await page.getByTestId('document-send-form').waitFor({ timeout: 60000 })
    assert.equal(await page.locator('#signer-email-1').inputValue(), f.contact.email, 'the contract signers are offered first')
    const sent = page.waitForResponse((r) => r.url().includes(`/documents/${docId}/esign`) && r.request().method() === 'POST', { timeout: 120000 })
    await page.getByTestId('document-send').click()
    const links = (await (await sent).json()).data.signingLinks
    await page.getByTestId('document-signing-links').waitFor({ timeout: 60000 })
    await shoot(page, `${label}-links`)
    return { docId, links }
  }

  await step('a price protocol is made, sent and signed by both sides', async () => {
    const { docId, links } = await makeDocument('price_protocol', 'chain-make-protocol', '16-protocol')
    state.protocolId = docId
    await signOnPage(links[0].signingLink)
    await signOnPage(links[1].signingLink)
    await page.reload({ timeout: 180000 })
    await page.getByTestId('esign-signature-sheet').waitFor({ timeout: 120000 })
    await shoot(page, '17-protocol-signed')
  })

  await step('an invoice is made from the contract at the protocol price, and issued', async () => {
    await page.goto(`/contracts/${state.contractId}`, { timeout: 180000 })
    await page.getByTestId('contract-documents-chain').waitFor({ timeout: 120000 })
    const made = page.waitForResponse((r) => r.url().endsWith('/create-invoice') && r.request().method() === 'POST', { timeout: 120000 })
    await page.getByTestId('chain-make-invoice').click()
    const json = await (await made).json()
    state.invoiceId = json.data?.id
    assert.ok(state.invoiceId, JSON.stringify(json).slice(0, 300))
    const issued = await api(`/api/v1/invoices/${state.invoiceId}`, { method: 'PUT', body: { status: 'sent' } })
    assert.ok(issued.status < 300, `issue ${issued.status} ${JSON.stringify(issued.json).slice(0, 300)}`)
    await page.goto(`/invoices/${state.invoiceId}`, { timeout: 180000 })
    await page.waitForLoadState('networkidle', { timeout: 180000 })
    await shoot(page, '18-invoice')
    const invoice = (await api(`/api/v1/invoices/${state.invoiceId}`)).json
    const total = Number(invoice?.data?.totalAmount ?? invoice?.totalAmount)
    assert.ok(total > 0, `invoice total ${total}`)
  })

  await step('an acceptance act for the invoice is made, sent and signed by both sides', async () => {
    const { links } = await makeDocument('acceptance_act', `chain-make-act-${state.invoiceId}`, '19-act')
    await signOnPage(links[0].signingLink)
    await signOnPage(links[1].signingLink)
    await page.reload({ timeout: 180000 })
    await page.getByTestId('esign-signature-sheet').waitFor({ timeout: 120000 })
    await shoot(page, '20-act-signed')
    await page.goto(`/contracts/${state.contractId}`, { timeout: 180000 })
    await page.getByTestId('contract-documents-chain').waitFor({ timeout: 120000 })
    await shoot(page, '21-contract-chain')
  })

  await step('the counterparty sees the whole chain in «Sənədlər», and its PDFs open', async () => {
    await portalPage.goto(`/portal/documents/${state.contractId}`, { timeout: 180000 })
    await portalPage.getByTestId('portal-contract').waitFor({ timeout: 120000 })
    await shoot(portalPage, '22-portal-contract')
    for (const part of ['protocols', 'invoices', 'acts']) {
      const text = await portalPage.getByTestId(`portal-chain-${part}`).innerText()
      assert.doesNotMatch(text, new RegExp(say('portal.documents.none')), `${part} is empty in the portal`)
    }
    const hrefs = await portalPage.$$eval('[data-testid=portal-contract] a[href*="/pdf"]', (as) => as.map((a) => a.getAttribute('href')))
    assert.ok(hrefs.length >= 3, `PDF links: ${hrefs.length}`)
    for (const href of hrefs) {
      const pdf = await portal.request.get(href, { timeout: 180000 })
      assert.equal(pdf.status(), 200, href)
      assert.equal((await pdf.body()).subarray(0, 4).toString(), '%PDF', href)
    }
    const invoiceHref = await portalPage.getByTestId('portal-chain-invoices').locator('a').first().getAttribute('href')
    await portalPage.goto(invoiceHref, { timeout: 180000 })
    await portalPage.waitForLoadState('networkidle', { timeout: 180000 })
    await shoot(portalPage, '23-portal-invoice')
    return { pdfs: hrefs.length }
  })

  await browser.close()
  report()
  process.exit(failed ? 1 : 0)
}

function report() {
  const findings = screens.flatMap((s) => ['desktop', 'phone'].flatMap((w) => {
    const m = s[w]
    const out = []
    if (m.sideways > 0) out.push(`${s.name} · ${w}: the page scrolls sideways by ${m.sideways}px — ${m.sticking.join('; ') || 'element not found'}`)
    if (m.rawKeys.length) out.push(`${s.name} · ${w}: raw translation keys on screen — ${m.rawKeys.join(', ')}`)
    if (m.truncated.length) out.push(`${s.name} · ${w}: text cut off in — ${m.truncated.join(' | ')}`)
    return out
  }))
  const lines = [
    '# Contracts E2E and UI audit',
    '',
    `Steps: ${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed.`,
    '',
    ...results.map((r) => `- ${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`),
    '',
    `## Screens (${screens.length}, each at 1440 and 390 px)`,
    '',
    ...(findings.length ? findings.map((x) => `- ${x}`) : ['- no sideways scroll, raw keys or cut-off labels found']),
    '',
    `## Console errors (${consoleErrors.length})`,
    '',
    ...[...new Map(consoleErrors.map((e) => [`${e.url} ${e.text}`, e])).values()].slice(0, 40).map((e) => `- [${e.step}] ${e.url}: ${e.text}`),
    '',
    `## Server errors (${serverErrors.length})`,
    '',
    ...serverErrors.slice(0, 40).map((e) => `- [${e.step}] ${e.status} ${e.url}`),
  ]
  writeFileSync(`${OUT}/audit.md`, `${lines.join('\n')}\n`)
  writeFileSync(`${OUT}/audit.json`, `${JSON.stringify({ results, screens, consoleErrors, serverErrors }, null, 2)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
}

if (process.argv[2] === 'prepare') prepare()
else main().catch((error) => { console.error(error); try { report() } catch { /* nothing to report */ } process.exit(1) })
