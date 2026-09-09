-- M3-1c: Add expoPushToken to MtmAgent for Expo push notifications
-- The mobile app registers its Expo push token via POST /api/v1/mtm/agents/push-token.
-- The server uses this token to send analysis-complete / rejected push notifications.
ALTER TABLE "mtm_agents" ADD COLUMN "expoPushToken" TEXT;
