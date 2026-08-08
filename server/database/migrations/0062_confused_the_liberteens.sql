ALTER TABLE "ai_usage_event" ADD COLUMN "credits_charged" integer;--> statement-breakpoint
CREATE INDEX "ai_usage_event_org_feature_created_idx" ON "ai_usage_event" USING btree ("organization_id","feature","created_at");--> statement-breakpoint
-- Backfill assistant turns recorded before credits existed. Without this every
-- historical turn charges 0, and orgs that already spent their allowance would
-- silently receive a fresh one.
--
-- The literals below intentionally duplicate MICROS_PER_CREDIT (2000) and
-- ESTIMATED_TURN_CREDITS (30) from server/utils/ai/credits.ts rather than
-- tracking them: a migration is a point-in-time record, and retuning either
-- constant later must not restate charges frozen here.
UPDATE "ai_usage_event"
SET "credits_charged" = CEIL("cost_usd_micros"::numeric / 2000)
WHERE "feature" = 'chatbot_message'
  AND "credits_charged" IS NULL
  AND "cost_usd_micros" IS NOT NULL;--> statement-breakpoint
-- Turns whose model had no price on file: charge the standard estimate rather
-- than nothing, so an unpriced past does not read as free usage.
UPDATE "ai_usage_event"
SET "credits_charged" = 30
WHERE "feature" = 'chatbot_message'
  AND "credits_charged" IS NULL;
