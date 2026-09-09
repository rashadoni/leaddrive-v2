#!/usr/bin/env node
/**
 * Capture anonymized CRM screenshots via Chrome DevTools Protocol.
 * Prerequisites: Chrome running with --remote-debugging-port=9222 and logged
 * into SCREENSHOT_BASE_URL. For a remote target, set
 * CONFIRM_REMOTE_SCREENSHOT to its exact hostname.
 */
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireScreenshotTarget } from './screenshot-auth-config.mjs';
import { requireDemoTenant, assertDemoTenant } from './screenshot-safety.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'marketing');
const { baseUrl: BASE_URL } = requireScreenshotTarget();
const DEMO_ORG = requireDemoTenant();

// Ensure output dir exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Anonymization script to inject into every page
const ANON_SCRIPT = `
(function() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    let n = walker.currentNode;
    let t = n.textContent;
    let orig = t;
    // Org name
    t = t.replace(/Güv[əe]n Technology LLC/g, 'Acme Corp');
    // Currency
    t = t.replace(/₼/g, '$');
    // KPI numbers
    t = t.replace(/616[\\s\\u00a0,]?367/g, '847,520');
    t = t.replace(/90[\\s\\u00a0,]?784/g, '124,350');
    // Greeting & user name
    t = t.replace(/Good evening/g, 'Good morning');
    t = t.replace(/Good afternoon/g, 'Good morning');
    t = t.replace(/\\bAdmin\\b/g, 'Alex');
    t = t.replace(/Rashad Rahimov/g, 'Alex');
    t = t.replace(/Rashad/g, 'Alex');
    t = t.replace(/rashadrahimsoy@gmail\\.com/g, 'alex@acmecorp.com');
    t = t.replace(/admin@leaddrive\\.com/g, 'alex@acmecorp.com');
    // Fix broken AZ text leftovers
    t = t.replace(/taskslar/g, 'tasks');
    t = t.replace(/tapşırıqlar/g, 'tasks');
    // Service names (RU)
    t = t.replace(/Постоянное IT/g, 'Cloud Services');
    t = t.replace(/InfoSec/g, 'Consulting');
    t = t.replace(/HelpDesk/g, 'Support Plans');
    t = t.replace(/Облако/g, 'SaaS Platform');
    t = t.replace(/\\bGRC\\b/g, 'Analytics');
    t = t.replace(/\\bwaf\\b/gi, 'DevOps');
    // Pipeline labels (AZ)
    t = t.replace(/\\bLid\\b/g, 'Lead');
    t = t.replace(/Kvalif\\./g, 'Qualified');
    t = t.replace(/Təklif/g, 'Proposal');
    t = t.replace(/Danışıqlar/g, 'Negotiation');
    t = t.replace(/Qazanıldı/g, 'Won');
    t = t.replace(/İtirildi/g, 'Lost');
    // Alert messages (AZ)
    t = t.replace(/Aşağı marja/g, 'Low margin');
    t = t.replace(/Marjinallıq -4\\.9% — hədəf 15%-dən aşağı/g, 'Margin -4.9% — below 15% target');
    t = t.replace(/Zərərli müştərilər/g, 'Unprofitable clients');
    t = t.replace(/52 müştəridən 37 zərərli/g, '52 clients, 37 unprofitable');
    t = t.replace(/Gecikmiş tapşırıq/g, 'Overdue tasks');
    // Pipeline values
    t = t.replace(/2[\\s\\u00a0]500/g, '12,500');
    t = t.replace(/15[\\s\\u00a0]300/g, '45,800');
    t = t.replace(/34[\\s\\u00a0]484/g, '78,200');
    t = t.replace(/35[\\s\\u00a0]000/g, '92,400');
    t = t.replace(/8[\\s\\u00a0]000/g, '15,600');
    t = t.replace(/3[\\s\\u00a0]500/g, '3,500');
    // Company names from deals/companies
    t = t.replace(/"AAC" MMC/g, 'TechVision Inc');
    t = t.replace(/Nəqliyyat MMC/g, 'Pacific Logistics');
    t = t.replace(/Azərtexnika/g, 'NovaChem Ltd');
    t = t.replace(/Bakıtel/g, 'GreenLeaf Bio');
    t = t.replace(/AzInTelecom/g, 'Summit Valley');
    t = t.replace(/SOFTRAUM MMC/g, 'Harbor Tech Co');
    t = t.replace(/İdeal MMC/g, 'Apex Digital Inc');
    t = t.replace(/Data Plus/g, 'Quantum Systems');
    t = t.replace(/AzərFon/g, 'Pacific Solar');
    t = t.replace(/Kapital Bank/g, 'First Capital');
    t = t.replace(/PASHA Bank/g, 'Premier Bank');
    t = t.replace(/\\bABB\\b/g, 'Global Trust');
    t = t.replace(/Zyplus Pharma/g, 'NovaChem Ltd');
    t = t.replace(/Pharmasource/g, 'BioTech Solutions');
    t = t.replace(/Zovirpharm/g, 'MedTech Group');
    t = t.replace(/Finansal/g, 'FinCorp');
    t = t.replace(/Məqsəd/g, 'Pinnacle');
    t = t.replace(/TechDeal/g, 'CloudDeal');
    t = t.replace(/YeniSahə/g, 'NewField');
    t = t.replace(/Green Energy/g, 'Green Power');
    // Currency AZN → USD
    t = t.replace(/\\bAZN\\b/g, 'USD');
    t = t.replace(/\\bманат\\b/gi, 'USD');
    // Service names for profitability
    t = t.replace(/Daimi IT/g, 'Cloud Ops');
    t = t.replace(/Daimi/g, 'Managed');
    t = t.replace(/Layihələr/g, 'Projects');
    t = t.replace(/Buludl/g, 'Cloud');
    t = t.replace(/DevOps/g, 'DevOps');
    // More company names
    t = t.replace(/ZEYTUN PHARMACEUTICALS/gi, 'NOVA BIOTECH');
    t = t.replace(/AGRARGO/gi, 'GREENFIELD');
    t = t.replace(/Zeytun/gi, 'Nova');
    t = t.replace(/Menecer/g, 'Manager');
    t = t.replace(/yönləndir/g, 'assigned');
    t = t.replace(/yönldir/g, 'assigned');
    t = t.replace(/Эскалация/g, 'Escalation');
    t = t.replace(/yers aksiyalar/g, 'local promotions');
    t = t.replace(/ticket açın/g, 'ticket open');
    // Offer numbers
    t = t.replace(/GT-OFF/g, 'AC-OFF');
    // Deal descriptions in AZ
    t = t.replace(/Тест удержания/g, 'Retention test');
    t = t.replace(/Тестовая сделка/g, 'Test deal');
    t = t.replace(/Тест включения/g, 'Onboarding test');
    t = t.replace(/Тест отклонения/g, 'Rejection test');
    t = t.replace(/Тест просрочки/g, 'Overdue test');
    t = t.replace(/удержания/g, 'retention');
    t = t.replace(/включения/g, 'onboarding');
    t = t.replace(/отклонения/g, 'rejection');
    t = t.replace(/просрочки/g, 'overdue');
    // Budget/profitability
    t = t.replace(/646[\\s\\u00a0,]?755/g, '892,340');
    t = t.replace(/616[\\s\\u00a0,]?367/g, '847,520');
    t = t.replace(/464\\.3K/g, '564.3K');
    t = t.replace(/Sec G/g, 'Total');
    t = t.replace(/Sec F/g, 'OpEx');
    if (t !== orig) n.textContent = t;
  }
})();
`;

async function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const tabs = JSON.parse(data);
        const crm = tabs.find((tab) => {
          try {
            return new URL(tab.url).origin === BASE_URL;
          } catch {
            return false;
          }
        });
        if (crm) resolve(crm.webSocketDebuggerUrl);
        else reject(new Error('CRM tab not found'));
      });
    }).on('error', reject);
  });
}

async function connectCDP(wsUrl) {
  // Dynamic import of ws if available, otherwise use built-in
  // Node 22+ has WebSocket built-in
  const WS = globalThis.WebSocket || (await import('ws')).default;
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    let id = 0;
    const pending = new Map();

    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      },
      close() { ws.close(); }
    });

    ws.onmessage = (evt) => {
      const msg = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };

    ws.onerror = (err) => reject(err);
  });
}

async function captureScreenshot(cdp, filename) {
  // Fail-closed: see scripts/screenshot-safety.mjs. public/ is served anonymously.
  const bodyText = await cdp.send('Runtime.evaluate', {
    expression: 'document.body.innerText', returnByValue: true,
  });
  assertDemoTenant(bodyText?.result?.value, DEMO_ORG, filename);

  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const buffer = Buffer.from(result.data, 'base64');
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  console.log(`  Saved: ${filepath} (${(buffer.length / 1024).toFixed(0)}KB)`);
  return filepath;
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  // Wait for load
  await new Promise(r => setTimeout(r, 3000));
}

async function injectAnonymization(cdp) {
  await cdp.send('Runtime.evaluate', { expression: ANON_SCRIPT });
  await new Promise(r => setTimeout(r, 500));
}

async function setEnLocale(cdp) {
  await cdp.send('Runtime.evaluate', {
    expression: `document.cookie = "NEXT_LOCALE=en;path=/;max-age=31536000"; "ok"`
  });
}

// Pages to capture
const PAGES = [
  { path: '/', filename: 'crm-dashboard.png', wait: 4000 },
  { path: '/deals', filename: 'deals-pipeline.png', wait: 3000 },
  { path: '/companies', filename: 'companies-list.png', wait: 3000 },
  { path: '/profitability', filename: 'analytics-profitability.png', wait: 4000 },
  { path: '/budgeting', filename: 'budgeting-pnl.png', wait: 4000 },
  { path: '/inbox', filename: 'inbox-channels.png', wait: 3000 },
  { path: '/campaigns', filename: 'marketing-campaigns.png', wait: 3000 },
  { path: '/tickets', filename: 'support-tickets.png', wait: 3000 },
  { path: '/projects', filename: 'erp-projects.png', wait: 3000 },
  { path: '/settings', filename: 'platform-settings.png', wait: 3000 },
];

async function main() {
  console.log('Finding CRM tab...');
  const wsUrl = await getWsUrl();
  console.log(`Connecting to: ${wsUrl}`);

  const cdp = await connectCDP(wsUrl);
  console.log('Connected to Chrome DevTools Protocol\n');

  // Set English locale
  await setEnLocale(cdp);

  for (const page of PAGES) {
    const pageUrl = new URL(page.path, `${BASE_URL}/`).toString();
    console.log(`Capturing: ${pageUrl}`);
    await navigate(cdp, pageUrl);
    await new Promise(r => setTimeout(r, page.wait || 3000));
    await injectAnonymization(cdp);
    await captureScreenshot(cdp, page.filename);
    console.log('');
  }

  cdp.close();
  console.log('Done! All screenshots saved to public/marketing/');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
