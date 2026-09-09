import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { requireScreenshotAuth } from "./screenshot-auth-config.mjs";
import { requireDemoTenant, assertDemoTenant } from "./screenshot-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "marketing");
const { baseUrl: BASE, email: EMAIL, password: PASSWORD } = requireScreenshotAuth();
const DEMO_ORG = requireDemoTenant();

async function login(page) {
  await page.goto(`${BASE}/api/auth/csrf`, { waitUntil: "domcontentloaded" });
  const csrf = JSON.parse(await page.textContent("body")).csrfToken;
  await page.evaluate(async ({ base, csrf, email, password }) => {
    await fetch(`${base}/api/auth/callback/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email, password,
        csrfToken: csrf, callbackUrl: `${base}/`, json: "true",
      }),
      redirect: "follow",
    });
  }, { base: BASE, csrf, email: EMAIL, password: PASSWORD });
}

async function forceLight(page) {
  await page.evaluate(() => {
    localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    document.documentElement.style.colorScheme = "light";
  });
}

async function save(page, name) {
  await forceLight(page);
  await page.waitForTimeout(2000);
  // Fail-closed: see scripts/screenshot-safety.mjs. public/ is served anonymously.
  assertDemoTenant(await page.innerText("body"), DEMO_ORG, `${name} (${page.url()})`);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), type: "png" });
  console.log(`  Saved: ${name}.png (${page.url()})`);
}

async function run() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  const page = await context.newPage();
  await context.addCookies([{ name: "NEXT_LOCALE", value: "az", url: BASE }]);

  await login(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  if (page.url().includes("/login")) { console.error("Login failed!"); await browser.close(); return; }
  console.log("Logged in!\n");
  await page.evaluate(() => localStorage.setItem("theme", "light"));

  // === FIX 1: ai-lead-scoring → use /ai-scoring instead ===
  console.log("[1] AI Scoring page...");
  await page.goto(`${BASE}/ai-scoring`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await save(page, "ai-lead-scoring");

  // === FIX 2: ai-email-generation → Lead detail → AI Text tab ===
  console.log("[2] AI Email Generation (Lead detail → AI Mətn tab)...");
  await page.goto(`${BASE}/leads`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  // Click first lead link
  const leadLink = page.locator('a[href*="/leads/"]').first();
  if (await leadLink.count() > 0) {
    await leadLink.click();
    await page.waitForTimeout(4000);
    console.log("  On lead:", page.url());

    // List all tab-like buttons
    const buttons = await page.locator('button').all();
    for (const btn of buttons) {
      const text = (await btn.textContent().catch(() => "")).trim();
      if (text && text.length < 30) {
        const cls = await btn.getAttribute("class").catch(() => "");
        if (cls && (cls.includes("tab") || cls.includes("border-b") || cls.includes("data-"))) {
          console.log(`    Button: "${text}"`);
        }
      }
    }

    // Try finding tab with text containing "Mətn", "Text", "Email", "Metn"
    const tabSelectors = [
      'button:has-text("AI Mətn")',
      'button:has-text("Mətn")',
      'button:has-text("Email")',
      'button:has-text("Text")',
      'button:has-text("Metn")',
      'button:has-text("AI Text")',
    ];
    let clicked = false;
    for (const sel of tabSelectors) {
      const tab = page.locator(sel).first();
      if (await tab.count() > 0) {
        await tab.click();
        await page.waitForTimeout(2000);
        console.log(`  Clicked tab: ${sel}`);
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      // Try all visible buttons with role or tab-like behavior
      const allBtns = page.locator('[role="tab"], button[class*="border"]');
      const cnt = await allBtns.count();
      console.log(`  Found ${cnt} tab-like buttons, listing all:`);
      for (let i = 0; i < cnt; i++) {
        const t = (await allBtns.nth(i).textContent().catch(() => "")).trim();
        console.log(`    [${i}] "${t}"`);
      }
      // AI text is typically the 5th or 6th tab in lead detail
      if (cnt >= 6) {
        await allBtns.nth(5).click();
        await page.waitForTimeout(2000);
        console.log("  Clicked tab index 5");
      }
    }
  }
  await save(page, "ai-email-generation");

  // === FIX 3: ai-portal-chat → take screenshot of portal login or public page ===
  console.log("[3] Portal Chat...");
  // Portal needs separate auth. Let's screenshot the portal login page which shows the AI chat widget
  await page.goto(`${BASE}/portal`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await save(page, "ai-portal-chat");

  // === FIX 4: ai-assistant-panel → find the floating button ===
  console.log("[4] AI Assistant Panel...");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await forceLight(page);

  // The floating AI button is typically a fixed positioned button with Brain/accessibility icon
  // Look for the AI chat FAB
  const fabSelectors = [
    'button[class*="fixed"]',
    'button[class*="bottom"]',
    '[class*="ai-fab"]',
    'button:has(svg)',
  ];

  // Get all fixed-position elements
  const fixedButtons = await page.evaluate(() => {
    const elements = document.querySelectorAll('button, div[role="button"]');
    const fixed = [];
    elements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' && parseInt(style.bottom) < 100) {
        fixed.push({
          tag: el.tagName,
          class: el.className.substring(0, 100),
          text: el.textContent?.substring(0, 50),
          bottom: style.bottom,
          right: style.right,
        });
      }
    });
    return fixed;
  });
  console.log("  Fixed bottom elements:", JSON.stringify(fixedButtons, null, 2));

  // Click the accessibility/AI button (usually bottom-right circle)
  const floatingBtn = page.locator('button.fixed, div.fixed').locator('visible=true').last();
  if (await floatingBtn.count() > 0) {
    await floatingBtn.click();
    await page.waitForTimeout(2000);
    console.log("  Clicked floating button");
  } else {
    // Try clicking at known position (bottom-right corner)
    await page.click('body', { position: { x: 1400, y: 860 } });
    await page.waitForTimeout(2000);
    console.log("  Clicked at bottom-right position");
  }
  await save(page, "ai-assistant-panel");

  await browser.close();
  console.log("\nAll fixes done!");
}

run().catch(console.error);
