export async function prepareSupportEvidenceScreenshot(page) {
  if ((process.env.SUPPORT_EVIDENCE_APP_MODE || "").trim() !== "development") {
    return { developmentChromeHosts: 0 }
  }

  const developmentChromeHosts = await page.locator("nextjs-portal").count()
  // The disposable tenant uses `next dev` because the evidence builder cannot
  // finish a production build inside the job budget. Hide only Next's own
  // shadow-DOM toolbar host so screenshots contain the product surface. Runtime
  // page, console and HTTP failures remain fail-closed in the evidence runners.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
  return { developmentChromeHosts }
}

export async function captureSupportEvidenceScreenshot(page, options) {
  const developmentChrome = await prepareSupportEvidenceScreenshot(page)
  await page.screenshot(options)
  return developmentChrome
}
