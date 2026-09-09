import { describe, expect, it } from "vitest"
import {
  buildGoogleAlertsAddress,
  extractGoogleAlertsAddress,
  parseGoogleAlertsAddress,
} from "@/lib/social/google-alerts-address"
import {
  googleAlertQueryFromSubject,
  isAuthenticatedGoogleAlertSender,
  parseGoogleAlertEmail,
  unwrapGoogleAlertUrl,
} from "@/lib/social/google-alerts-email"
import {
  isAzerbaijanNewsHost,
  parseVerifiedWebNewsArticle,
} from "@/lib/social/web-news-article"

describe("Google Alerts tenant address", () => {
  it("round-trips a signed organization address and rejects tampering", () => {
    const address = buildGoogleAlertsAddress("org_azerbaijan")
    expect(parseGoogleAlertsAddress(address)).toEqual({
      ok: true,
      organizationId: "org_azerbaijan",
    })
    expect(extractGoogleAlertsAddress(`Alerts <${address}>, second@example.com`)).toEqual({
      ok: true,
      organizationId: "org_azerbaijan",
    })

    expect(parseGoogleAlertsAddress(address.replace("org_azerbaijan", "org_other"))).toEqual({
      ok: false,
      reason: "bad_hmac",
    })
  })
})

describe("Google Alerts email parser", () => {
  it("extracts the alert query and publisher links without retaining Google tracking", () => {
    const publisherUrl = "https://news.example.az/economy/baku-electronics-yeni-magaza?utm_source=google"
    const wrapped = `https://www.google.com/url?url=${encodeURIComponent(publisherUrl)}&usg=abc`
    const parsed = parseGoogleAlertEmail({
      subject: "Google Alert – Baku Electronics",
      html: `
        <div>
          <a href="${wrapped}"><b>Baku Electronics</b> yeni mağaza açdı</a>
          <div>Şirkət yeni mağazanın açılışını elan edib.</div>
          <a href="https://www.google.com/alerts/remove">Unsubscribe</a>
        </div>
      `,
    })

    expect(parsed?.query).toBe("Baku Electronics")
    expect(parsed?.candidates).toEqual([{
      title: "Baku Electronics yeni mağaza açdı",
      snippet: "Şirkət yeni mağazanın açılışını elan edib.",
      url: "https://news.example.az/economy/baku-electronics-yeni-magaza",
    }])
    expect(googleAlertQueryFromSubject("Other message")).toBeNull()
    expect(unwrapGoogleAlertUrl("https://google.com/alerts")).toBeNull()
  })

  it("requires the real Google Alerts sender and a passing google.com DKIM result", () => {
    expect(isAuthenticatedGoogleAlertSender({
      headerFrom: "Google Alerts <googlealerts-noreply@google.com>",
      authenticationResults: "mx.example; dkim=pass header.d=google.com; spf=pass",
    })).toBe(true)
    expect(isAuthenticatedGoogleAlertSender({
      headerFrom: "Google Alerts <googlealerts-noreply@google.com>",
      authenticationResults: "dkim=fail header.d=google.com",
    })).toBe(false)
    expect(isAuthenticatedGoogleAlertSender({
      headerFrom: "Attacker <googlealerts-noreply@google.com.evil.test>",
      authenticationResults: "dkim=pass header.d=google.com",
    })).toBe(false)
  })
})

describe("verified Azerbaijan web news", () => {
  const currentHtml = `
    <html>
      <head>
        <link href="/news/current-story" rel="canonical">
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            "headline": "Baku Electronics yeni mağaza açdı",
            "description": "Şirkət Bakıda yeni mağazasını təqdim edib.",
            "datePublished": "2026-07-26T09:30:00+04:00",
            "author": {"@type": "Person", "name": "Aysel Məmmədova"},
            "publisher": {"@type": "Organization", "name": "Example Xəbər"},
            "image": {"url": "/images/store.jpg"}
          }
        </script>
      </head>
    </html>
  `

  it("accepts a recent .az NewsArticle and normalizes its fields", () => {
    const article = parseVerifiedWebNewsArticle(
      currentHtml,
      "https://news.example.az/incoming?id=1",
      new Date("2026-07-27T00:00:00Z"),
    )
    expect(article).toMatchObject({
      url: "https://news.example.az/news/current-story",
      publisherName: "Example Xəbər",
      publisherDomain: "news.example.az",
      headline: "Baku Electronics yeni mağaza açdı",
      description: "Şirkət Bakıda yeni mağazasını təqdim edib.",
      authorName: "Aysel Məmmədova",
      imageUrl: "https://news.example.az/images/store.jpg",
    })
  })

  it("rejects 2024 content, non-news pages and sites outside Azerbaijan", () => {
    const old = currentHtml.replace("2026-07-26", "2024-07-26")
    expect(parseVerifiedWebNewsArticle(old, "https://example.az/old", new Date("2026-07-27T00:00:00Z"))).toBeNull()
    expect(parseVerifiedWebNewsArticle(
      currentHtml.replace("NewsArticle", "Product"),
      "https://example.az/catalog",
      new Date("2026-07-27T00:00:00Z"),
    )).toBeNull()
    expect(parseVerifiedWebNewsArticle(
      currentHtml,
      "https://example.com/news",
      new Date("2026-07-27T00:00:00Z"),
    )).toBeNull()
    expect(isAzerbaijanNewsHost("report.az")).toBe(true)
    expect(isAzerbaijanNewsHost("sub.example.az")).toBe(true)
    expect(isAzerbaijanNewsHost("example.com")).toBe(false)
  })
})
