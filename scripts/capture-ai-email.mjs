import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { requireScreenshotAuth } from "./screenshot-auth-config.mjs";
import { requireDemoTenant, assertDemoTenant } from "./screenshot-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "marketing");
const { baseUrl: BASE, email: EMAIL, password: PASSWORD } = requireScreenshotAuth();
const DEMO_ORG = requireDemoTenant();

async function run() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  const page = await context.newPage();

  await context.addCookies([{
    name: "NEXT_LOCALE", value: "az",
    url: BASE,
  }]);

  // Login
  console.log("Logging in...");
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

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  if (page.url().includes("/login")) { console.error("Login failed!"); await browser.close(); return; }
  console.log("Logged in!");

  // Force light theme
  await page.evaluate(() => localStorage.setItem("theme", "light"));

  // Go to leads list
  console.log("Navigating to leads...");
  await page.goto(`${BASE}/leads`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Click first lead
  const leadLink = page.locator('a[href*="/leads/"]').first();
  if (await leadLink.count() > 0) {
    await leadLink.click();
    await page.waitForTimeout(3000);
    console.log("On lead detail:", page.url());
  }

  // Force light
  await page.evaluate(() => {
    localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    document.documentElement.style.colorScheme = "light";
  });

  // Find and click AI Text tab (Mail icon or tab with "Mətn" / "Text" / "Email")
  console.log("Looking for AI tabs...");
  const allButtons = await page.locator('button[role="tab"], [data-state]').all();
  for (const btn of allButtons) {
    const text = await btn.textContent().catch(() => "");
    console.log(`  Tab: "${text.trim()}"`);
  }

  // Click the AI Text tab
  const aiTextTab = page.locator('button:has-text("Mətn"), button:has-text("Text"), button:has-text("Email"), button:has-text("AI Mətn")').first();
  if (await aiTextTab.count() > 0) {
    await aiTextTab.click();
    await page.waitForTimeout(2000);
    console.log("Clicked AI Text tab");
  } else {
    // Try by index - AI Text is usually tab 3 or 4
    console.log("Trying tabs by order...");
    const tabs = page.locator('button[role="tab"]');
    const count = await tabs.count();
    console.log(`Found ${count} tabs`);
    for (let i = 0; i < count; i++) {
      const t = await tabs.nth(i).textContent();
      console.log(`  Tab ${i}: "${t.trim()}"`);
    }
    // Click tab that might be AI text (usually 5th or 6th)
    if (count >= 5) {
      await tabs.nth(4).click(); // 0-indexed, so 4 = 5th tab
      await page.waitForTimeout(2000);
      console.log("Clicked tab index 4");
    }
  }

  await page.waitForTimeout(2000);

  // Screenshot
  assertDemoTenant(await page.innerText("body"), DEMO_ORG, "ai-email-generation");
  await page.screenshot({ path: path.join(outDir, "ai-email-generation.png"), type: "png" });
  console.log("Saved ai-email-generation.png");

  // Also fix: deal detail - navigate to first deal
  console.log("\nFixing deal detail...");
  await page.goto(`${BASE}/deals`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  // Click first deal card link
  const dealLink = page.locator('a[href*="/deals/"]').first();
  if (await dealLink.count() > 0) {
    await dealLink.click();
    await page.waitForTimeout(3000);
    console.log("On deal detail:", page.url());
  } else {
    // Click deal card
    const card = page.locator('.cursor-grab, [draggable]').first();
    if (await card.count() > 0) {
      await card.click();
      await page.waitForTimeout(3000);
      console.log("Clicked deal card:", page.url());
    }
  }
  await page.evaluate(() => {
    localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  });
  await page.waitForTimeout(2000);
  assertDemoTenant(await page.innerText("body"), DEMO_ORG, "ai-deal-detail");
  await page.screenshot({ path: path.join(outDir, "ai-deal-detail.png"), type: "png" });
  console.log("Saved ai-deal-detail.png");

  await browser.close();
  console.log("\nDone!");
}

run().catch(console.error);
