# Google Search Console — Reindex Plan

## Step 1: Request Reindexing of Updated Pages

After deploying all changes, request reindexing for each page via GSC > URL Inspection > Request Indexing:

1. `https://leaddrivecrm.org/home` — JSON-LD updated (author → LeadDrive Inc.)
2. `https://leaddrivecrm.org/about` — Organization schema updated + new "Our Story" section
3. `https://leaddrivecrm.org/legal/privacy` — Full rewrite, now i18n
4. `https://leaddrivecrm.org/legal/terms` — Full rewrite, now i18n
5. `https://leaddrivecrm.org/plans` — Check if any old references
6. `https://leaddrivecrm.org/contact` — Check if any old references
7. `https://leaddrivecrm.org/demo` — Check if any old references

## Step 2: Check Cached Versions

Search Google for these queries and check if cached/indexed versions still show old company name:

### Search Queries to Monitor

1. `"LeadDrive CRM" "Güvən Technology"` — should return 0 results after reindex
2. `"LeadDrive CRM" "Guven Technology"` — same
3. `"leaddrivecrm.org" "Güvən"` — same
4. `site:leaddrivecrm.org "Güvən"` — should return 0
5. `site:leaddrivecrm.org "Guven"` — should return 0
6. `"LeadDrive CRM" Azerbaijan` — check what comes up
7. `"LeadDrive CRM" Baku` — check what comes up
8. `LeadDrive CRM company` — verify new company info shows
9. `LeadDrive CRM who made` — verify AI answers correctly
10. `LeadDrive CRM owner` — verify AI answers correctly

### Expected New Results

After reindexing, Google should show:
- Company: LeadDrive Inc.
- Location: Warsaw, Poland
- Description: European AI-powered CRM built by Ukrainian engineers

## Step 3: URL Removal Tool (if needed)

If old cached versions persist after 2-4 weeks:
1. Go to GSC > Removals > New Request
2. Submit outdated cached URLs
3. This forces Google to re-fetch the page

## Step 4: Structured Data Testing

Validate updated JSON-LD:
1. Go to https://search.google.com/test/rich-results
2. Test these URLs:
   - `https://leaddrivecrm.org/home` — SoftwareApplication + FAQ + Breadcrumb
   - `https://leaddrivecrm.org/about` — Organization with foundingLocation

Verify:
- Organization name: "LeadDrive Inc."
- Address: Warsaw, PL
- foundingLocation: Kyiv, Ukraine
- No errors in structured data

## Step 5: Ongoing Monitoring

Set up Google Alerts for:
- `"LeadDrive CRM" "Güvən"`
- `"LeadDrive" "Guven Technology"`
- `"leaddrivecrm" "Azerbaijan"`

Check monthly until all old references are gone from search results.

## Step 6: Sitemap Update

Update `public/sitemap.xml` lastmod dates to today's date to signal freshness:
- All pages should have `<lastmod>2026-04-13</lastmod>`

## Timeline

- **Day 1** (today): Deploy + request reindexing
- **Week 1**: Check if pages are reindexed
- **Week 2-4**: Monitor search queries, use Removal tool if needed
- **Month 2**: Publish press release for additional SEO signal
- **Month 3**: Full audit of search results
