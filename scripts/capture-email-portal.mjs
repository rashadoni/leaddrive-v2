import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { requireScreenshotAuth } from "./screenshot-auth-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "marketing");
const { baseUrl: BASE, email: EMAIL, password: PASSWORD } = requireScreenshotAuth();

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
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => {
    localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    document.documentElement.style.colorScheme = "light";
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.setAttribute("style", "color-scheme: light;");
  });
}

async function save(page, name) {
  await forceLight(page);
  await page.waitForTimeout(2000);
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

  await page.emulateMedia({ colorScheme: "light" });
  await login(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  if (page.url().includes("/login")) { console.error("Login failed!"); await browser.close(); return; }
  console.log("Logged in!\n");
  await forceLight(page);

  // === FIX: ai-email-generation ===
  console.log("[1] AI Email Generation — navigating to lead detail...");

  // Go to leads list first
  await page.goto(`${BASE}/leads`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await forceLight(page);
  await page.waitForTimeout(500);

  // Click first lead row to open detail
  const firstRow = page.locator('tr.cursor-pointer').first();
  if (await firstRow.count() > 0) {
    await firstRow.click();
    await page.waitForTimeout(4000);
    console.log("  On lead detail:", page.url());

    // Now click the "AI Mətn" tab
    const aiTextTab = page.locator('button:has-text("AI Mətn"), button:has-text("AI Text")').first();
    if (await aiTextTab.count() > 0) {
      await aiTextTab.click();
      await page.waitForTimeout(2000);
      console.log("  Clicked AI Mətn tab");

      // Click "Mətn yarat" (Generate Text) button
      const generateBtn = page.locator('button:has-text("Mətn yarat"), button:has-text("Generate Text")').first();
      if (await generateBtn.count() > 0) {
        await generateBtn.click();
        console.log("  Clicked Generate Text button, waiting for AI response...");
        await page.waitForTimeout(10000); // Wait for AI to generate

        // Scroll down to show generated text
        await page.evaluate(() => {
          const main = document.querySelector('main');
          if (main) main.scrollTop = main.scrollHeight;
        });
        await page.waitForTimeout(1000);
      }
    } else {
      console.log("  AI Mətn tab not found, listing buttons:");
      const btns = await page.locator('button').all();
      for (const btn of btns) {
        const text = (await btn.textContent().catch(() => "")).trim();
        if (text && text.length < 40) console.log(`    "${text}"`);
      }
    }
  }
  await save(page, "ai-email-generation");

  // === REPLACE: ai-portal-chat → ai-scoring-grades (portal needs separate auth)
  console.log("\n[2] AI Scoring Grades (replacing portal-chat)...");
  await page.goto(`${BASE}/ai-scoring`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  await forceLight(page);
  await page.waitForTimeout(1000);
  console.log("  AI Scoring URL:", page.url());
  await save(page, "ai-scoring-grades");

  await browser.close();
  console.log("\nDone!");
}

run().catch(console.error);
