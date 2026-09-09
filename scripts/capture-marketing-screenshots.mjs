import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { requireScreenshotAuth } from "./screenshot-auth-config.mjs";
import { requireDemoTenant, assertDemoTenant } from "./screenshot-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "marketing");

const { baseUrl: BASE, email: EMAIL, password: PASSWORD } = requireScreenshotAuth();
const DEMO_ORG = requireDemoTenant();

// FINAL 20: AI pages first, then best non-AI
const pages = [
  // --- AI PAGES (1-9) ---
  { name: "ai-lead-scoring", path: "/lead-scoring" },
  { name: "ai-lead-detail", path: "/leads", detail: true },
  { name: "ai-ticket-detail", path: "/tickets", detail: true },
  { name: "ai-deal-detail", path: "/deals", detail: true },
  { name: "ai-contact-detail", path: "/contacts", detail: true },
  { name: "ai-profitability", path: "/profitability" },
  { name: "ai-budgeting", path: "/budgeting" },
  { name: "ai-portal-chat", path: "/portal/chat", special: "portal" },
  { name: "ai-assistant-panel", path: "/", special: "open-ai-panel" },
  // --- NON-AI PAGES (10-20) ---
  { name: "crm-dashboard", path: "/" },
  { name: "deals-pipeline", path: "/deals" },
  { name: "inbox-channels", path: "/inbox" },
  { name: "companies-list", path: "/companies" },
  { name: "finance-treasury", path: "/finance" },
  { name: "reports-analytics", path: "/reports" },
  { name: "invoices-billing", path: "/invoices" },
  { name: "marketing-campaigns", path: "/campaigns" },
  { name: "support-tickets", path: "/tickets" },
  { name: "agent-desktop", path: "/support/agent-desktop" },
  { name: "events-management", path: "/events" },
  { name: "tasks-management", path: "/tasks" },
  { name: "ai-command-center", path: "/ai/command-center" },
  { name: "ai-agent-desktop", path: "/support/agent-desktop" },
  { name: "ai-scoring-grades", path: "/lead-scoring" },
  { name: "ai-email-generation", path: "/leads", detail: true, special: "ai-email" },
  { name: "analytics-profitability", path: "/profitability" },
  { name: "budgeting-pnl", path: "/budgeting" },
  { name: "erp-projects", path: "/projects" },
  { name: "platform-settings", path: "/settings" },
];

async function run() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // Retina 2x for crisp screenshots
    colorScheme: "light",
  });
  const page = await context.newPage();

  // Set AZ locale
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: "az",
    url: BASE,
  }]);

  // Get CSRF token
  console.log("Getting CSRF token...");
  await page.goto(`${BASE}/api/auth/csrf`, { waitUntil: "domcontentloaded" });
  const csrfBody = await page.textContent("body");
  const csrfToken = JSON.parse(csrfBody).csrfToken;

  // Login
  console.log("Logging in...");
  await page.evaluate(async ({ base, csrf, email, password }) => {
    await fetch(`${base}/api/auth/callback/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email,
        password,
        csrfToken: csrf,
        callbackUrl: `${base}/`,
        json: "true",
      }),
      redirect: "follow",
    });
  }, { base: BASE, csrf: csrfToken, email: EMAIL, password: PASSWORD });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);

  if (page.url().includes("/login")) {
    console.error("Login failed!");
    await browser.close();
    return;
  }
  console.log("Logged in!\n");

  // Force light theme
  await page.evaluate(() => localStorage.setItem("theme", "light"));

  for (let i = 0; i < pages.length; i++) {
    const { name, path: pagePath, detail, special } = pages[i];
    console.log(`[${i + 1}/${pages.length}] ${name}...`);

    try {
      if (special === "open-ai-panel") {
        // Navigate to dashboard and open floating AI assistant
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
        // Click the floating Brain button (bottom-right)
        const fabButton = page.locator('button:has(svg.lucide-brain), [class*="fixed"][class*="bottom"]').last();
        if (await fabButton.count() > 0) {
          await fabButton.click();
          await page.waitForTimeout(2000);
        }
      } else if (special === "portal") {
        // Portal has different auth — just navigate and hope session works
        await page.goto(`${BASE}${pagePath}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
      } else if (detail) {
        // Navigate to list, then click first item to get detail page
        await page.goto(`${BASE}${pagePath}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);

        // Try to find and click first detail link
        const detailLink = page.locator(`a[href*="${pagePath}/"]`).first();
        if (await detailLink.count() > 0) {
          await detailLink.click();
          await page.waitForTimeout(3000);
        } else {
          // Try clickable rows
          const row = page.locator("tr.cursor-pointer, [data-row-key], .cursor-grab").first();
          if (await row.count() > 0) {
            await row.click();
            await page.waitForTimeout(3000);
          }
        }
      } else {
        await page.goto(`${BASE}${pagePath}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
      }
    } catch (e) {
      console.log(`  Navigation error: ${e.message}`);
      await page.waitForTimeout(2000);
    }

    if (page.url().includes("/login")) {
      console.log(`  SKIPPED (login redirect)`);
      continue;
    }

    // Force light theme
    await page.evaluate(() => {
      localStorage.setItem("theme", "light");
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
      document.documentElement.style.colorScheme = "light";
    });

    await page.waitForTimeout(2000);

    // Fail-closed: prove this is the demo tenant BEFORE anything is written to
    // public/, which Next.js serves anonymously. Throwing aborts the whole run
    // rather than skipping one file — a tenant mismatch is never local to a
    // single page, and a partial run would leave real and demo captures mixed
    // in the same directory with no way to tell them apart afterwards.
    assertDemoTenant(await page.innerText("body"), DEMO_ORG, `${name} (${page.url()})`);

    const filePath = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: filePath, type: "png" });
    const url = page.url();
    console.log(`  OK -> ${name}.png (${url})`);

    // Close AI panel if opened
    if (special === "open-ai-panel") {
      const closeBtn = page.locator('button:has(svg.lucide-x)').first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
        await page.waitForTimeout(500);
      }
    }
  }

  await browser.close();
  console.log(`\nDone! ${pages.length} screenshots captured in 2x retina.`);
}

run().catch(console.error);
