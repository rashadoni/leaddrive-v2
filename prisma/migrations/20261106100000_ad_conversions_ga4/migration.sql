-- Google Analytics 4 as a second ad-conversions destination (owner
-- 2026-10-26: «передача лидов и выигранных сделок в Google Analytics 4»).
ALTER TABLE "ad_conversion_destinations" DROP CONSTRAINT "ad_conversion_destinations_platform_check";
ALTER TABLE "ad_conversion_destinations" ADD CONSTRAINT "ad_conversion_destinations_platform_check" CHECK ("platform" IN ('meta', 'ga4'));
